import { randomUUID } from 'node:crypto'
import type postgres from 'postgres'
import { z } from 'zod'

import {
  merchantBootstrapCapabilityMatches,
  merchantBootstrapCapabilitySchema,
} from './merchant-bootstrap.js'
import {
  type PolicyProofFailureCode,
  type PolicyProofVerification,
  verifyPolicyProof,
} from './policy-proof.js'

const PUBLIC_TOKEN_PATTERN = /^[A-Za-z0-9_-]{22}$/u

const publishPolicyInputSchema = z.object({
  bootstrapCapability: merchantBootstrapCapabilitySchema.optional(),
  challengeNonce: z.string().regex(PUBLIC_TOKEN_PATTERN),
  proof: z.unknown(),
}).strict()

type PolicyPublishErrorCode =
  | PolicyProofFailureCode
  | 'BOOTSTRAP_MISMATCH'
  | 'BOOTSTRAP_REQUIRED'
  | 'INVALID_REQUEST'
  | 'POLICY_NOT_FOUND'
  | 'POLICY_STATE_CONFLICT'

interface ChallengeLocatorRow {
  merchant_id: string
}

interface MerchantRow {
  policy_signer_address: string | null
}

interface PolicyChallengeRow {
  action: 'POLICY'
  bootstrap_session_id: string | null
  canonical_message: string
  consumed_at: Date | null
  expected_signer_address: string | null
  expires_at: Date
  merchant_id: string
  nonce: string
  payload: unknown
  payload_hash: string
  policy_version_id: string
  product_id: string
  verification_status: 'expired' | 'invalid' | 'pending' | 'verified'
  version: number
}

interface BootstrapRow {
  capability_hash: string
  consumed_at: Date | null
  expires_at: Date
}

interface DatabaseNowRow {
  now: Date
}

export interface PublishedPolicy {
  actualSignerAddress: string
  firstPolicyForMerchant: boolean
  merchantId: string
  policyVersionId: string
  productId: string
  protocolEventId: string
}

export class PolicyPublishError extends Error {
  readonly code: PolicyPublishErrorCode

  constructor(code: PolicyPublishErrorCode, message: string) {
    super(message)
    this.name = 'PolicyPublishError'
    this.code = code
  }
}

function fail(code: PolicyPublishErrorCode, message: string): never {
  throw new PolicyPublishError(code, message)
}

function requireOne<T>(rows: T[], code: PolicyPublishErrorCode, message: string): T {
  const row = rows[0]
  if (!row) fail(code, message)
  return row
}

function requireValidProof(
  result: PolicyProofVerification,
): Extract<PolicyProofVerification, { valid: true }> {
  if (!result.valid) fail(result.code, result.message)
  return result
}

export async function publishVerifiedPolicy(
  client: postgres.Sql,
  rawInput: unknown,
): Promise<PublishedPolicy> {
  const inputResult = publishPolicyInputSchema.safeParse(rawInput)
  if (!inputResult.success) fail('INVALID_REQUEST', 'The policy submission is invalid.')
  const input = inputResult.data

  return client.begin(async (transaction) => {
    const locator = requireOne(
      await transaction<ChallengeLocatorRow[]>`
        select merchant_id from signing_challenges where nonce = ${input.challengeNonce}
      `,
      'POLICY_NOT_FOUND',
      'The policy signing challenge was not found.',
    )

    const merchant = requireOne(
      await transaction<MerchantRow[]>`
        select policy_signer_address
        from merchants
        where id = ${locator.merchant_id}
        for update
      `,
      'POLICY_NOT_FOUND',
      'The policy merchant was not found.',
    )

    const challenge = requireOne(
      await transaction<PolicyChallengeRow[]>`
        select
          signing_challenges.action,
          signing_challenges.bootstrap_session_id,
          signing_challenges.canonical_message,
          signing_challenges.consumed_at,
          signing_challenges.expected_signer_address,
          signing_challenges.expires_at,
          signing_challenges.merchant_id,
          signing_challenges.nonce,
          signing_challenges.payload_hash,
          signing_challenges.policy_version_id,
          policy_versions.payload,
          policy_versions.product_id,
          policy_versions.verification_status,
          policy_versions.version
        from signing_challenges
        join policy_versions on policy_versions.id = signing_challenges.policy_version_id
        where signing_challenges.nonce = ${input.challengeNonce}
          and signing_challenges.merchant_id = ${locator.merchant_id}
        for update of signing_challenges, policy_versions
      `,
      'POLICY_NOT_FOUND',
      'The policy signing challenge was not found.',
    )

    const databaseNow = requireOne(
      await transaction<DatabaseNowRow[]>`select clock_timestamp() as now`,
      'POLICY_STATE_CONFLICT',
      'The database clock was unavailable.',
    ).now
    if (challenge.consumed_at) {
      fail('CHALLENGE_CONSUMED', 'The policy signing challenge was already consumed.')
    }
    if (databaseNow.getTime() >= challenge.expires_at.getTime()) {
      fail('CHALLENGE_EXPIRED', 'The policy signing challenge has expired.')
    }
    if (challenge.verification_status !== 'pending') {
      fail('POLICY_STATE_CONFLICT', 'The policy version is no longer pending verification.')
    }
    if (challenge.expected_signer_address !== merchant.policy_signer_address) {
      fail('POLICY_STATE_CONFLICT', 'The challenge signer no longer matches merchant authority.')
    }
    const firstPolicyForMerchant = merchant.policy_signer_address === null
    let bootstrap: BootstrapRow | undefined

    if (firstPolicyForMerchant) {
      if (!challenge.bootstrap_session_id || !input.bootstrapCapability) {
        fail('BOOTSTRAP_REQUIRED', 'A valid merchant bootstrap is required for the first policy.')
      }
      bootstrap = requireOne(
        await transaction<BootstrapRow[]>`
          select capability_hash, consumed_at, expires_at
          from merchant_bootstrap_sessions
          where id = ${challenge.bootstrap_session_id}
            and merchant_id = ${challenge.merchant_id}
          for update
        `,
        'BOOTSTRAP_MISMATCH',
        'The merchant bootstrap does not match this policy challenge.',
      )
      if (
        bootstrap.consumed_at
        || databaseNow.getTime() >= bootstrap.expires_at.getTime()
        || !merchantBootstrapCapabilityMatches(
          input.bootstrapCapability,
          bootstrap.capability_hash,
        )
      ) {
        fail('BOOTSTRAP_MISMATCH', 'The merchant bootstrap does not match this policy challenge.')
      }
    } else if (challenge.bootstrap_session_id) {
      fail('POLICY_STATE_CONFLICT', 'An established merchant cannot use a bootstrap challenge.')
    }

    const proof = requireValidProof(verifyPolicyProof({
      challenge: {
        action: challenge.action,
        canonicalMessage: challenge.canonical_message,
        consumedAt: challenge.consumed_at,
        expectedSignerAddress: merchant.policy_signer_address,
        expiresAt: challenge.expires_at,
        payload: challenge.payload,
        payloadHash: challenge.payload_hash,
      },
      now: databaseNow,
      proof: input.proof,
    }))

    if (firstPolicyForMerchant) {
      const establishedRows = await transaction<{ id: string }[]>`
        update merchants
        set policy_signer_address = ${proof.actualSignerAddress}, updated_at = ${databaseNow}
        where id = ${challenge.merchant_id} and policy_signer_address is null
        returning id
      `
      if (establishedRows.length !== 1) {
        fail('POLICY_STATE_CONFLICT', 'Merchant signer establishment lost a concurrent race.')
      }
    }

    const verifiedRows = await transaction<{ id: string }[]>`
      update policy_versions
      set
        signer_address = ${proof.actualSignerAddress},
        public_key = ${proof.publicKey},
        signature = ${proof.signature},
        verification_status = 'verified',
        verified_at = ${databaseNow},
        verifier_version = ${proof.verifierVersion}
      where id = ${challenge.policy_version_id} and verification_status = 'pending'
      returning id
    `
    if (verifiedRows.length !== 1) {
      fail('POLICY_STATE_CONFLICT', 'The policy version changed during verification.')
    }

    const consumedChallengeRows = await transaction<{ id: string }[]>`
      update signing_challenges
      set consumed_at = ${databaseNow}
      where nonce = ${challenge.nonce} and consumed_at is null and expires_at > ${databaseNow}
      returning id
    `
    if (consumedChallengeRows.length !== 1) {
      fail('POLICY_STATE_CONFLICT', 'The policy signing challenge could not be consumed.')
    }

    if (bootstrap && challenge.bootstrap_session_id) {
      const consumedBootstrapRows = await transaction<{ id: string }[]>`
        update merchant_bootstrap_sessions
        set consumed_at = ${databaseNow}
        where id = ${challenge.bootstrap_session_id}
          and consumed_at is null
          and expires_at > ${databaseNow}
        returning id
      `
      if (consumedBootstrapRows.length !== 1) {
        fail('POLICY_STATE_CONFLICT', 'The merchant bootstrap could not be consumed.')
      }
    }

    const activatedRows = await transaction<{ id: string }[]>`
      update products
      set active_policy_version_id = ${challenge.policy_version_id}, status = 'active'
      where id = ${challenge.product_id} and merchant_id = ${challenge.merchant_id}
        and status in ('draft', 'active')
      returning id
    `
    if (activatedRows.length !== 1) {
      fail('POLICY_STATE_CONFLICT', 'The product cannot activate this policy version.')
    }

    const correlationId = randomUUID()
    const eventRows = await transaction<{ event_id: string }[]>`
      insert into protocol_events (
        aggregate_type, aggregate_id, event_type, protocol_version, occurred_at,
        actor_address, correlation_id, evidence_type, evidence_id, payload
      ) values (
        'policy', ${challenge.policy_version_id}, 'policy.verified', 'NR1', ${databaseNow},
        ${proof.actualSignerAddress}, ${correlationId}, 'signature',
        ${challenge.policy_version_id},
        ${transaction.json({
          firstPolicyForMerchant,
          productId: challenge.product_id,
          version: challenge.version,
        })}
      )
      returning event_id
    `
    const event = requireOne(
      eventRows,
      'POLICY_STATE_CONFLICT',
      'The policy verification event could not be recorded.',
    )

    return {
      actualSignerAddress: proof.actualSignerAddress,
      firstPolicyForMerchant,
      merchantId: challenge.merchant_id,
      policyVersionId: challenge.policy_version_id,
      productId: challenge.product_id,
      protocolEventId: event.event_id,
    }
  })
}
