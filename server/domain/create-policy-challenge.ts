import { randomBytes } from 'node:crypto'
import type postgres from 'postgres'
import { z } from 'zod'

import { hashProtocolPayload, normalizeNimiqAddress } from '../../src/lib/crypto/nimiq-signature.js'
import {
  buildPolicyMessage,
  MAX_POLICY_WINDOW_SECONDS,
  type PolicyPayload,
} from '../../src/lib/protocol/policy.js'
import {
  merchantBootstrapCapabilityMatches,
  merchantBootstrapCapabilitySchema,
} from './merchant-bootstrap.js'

const CHALLENGE_TTL_MS = 5 * 60 * 1000
const PUBLIC_TOKEN_PATTERN = /^[A-Za-z0-9_-]{22}$/u

const createPolicyChallengeInputSchema = z.object({
  bootstrapCapability: merchantBootstrapCapabilitySchema.optional(),
  merchantPublicId: z.string().regex(PUBLIC_TOKEN_PATTERN),
  priceLuna: z.number().int().safe().positive(),
  productPublicId: z.string().regex(PUBLIC_TOKEN_PATTERN),
  returnWindowSeconds: z.number().int().safe().min(0).max(MAX_POLICY_WINDOW_SECONDS),
  settlementAddress: z.string().min(1).max(64),
  warrantyTransferAllowed: z.boolean(),
  warrantyWindowSeconds: z.number().int().safe().min(0).max(MAX_POLICY_WINDOW_SECONDS),
}).strict()

interface ResourceLocatorRow {
  merchant_id: string
  product_id: string
}

interface MerchantRow {
  policy_signer_address: string | null
  status: 'active' | 'disabled'
}

interface ProductRow {
  name: string
  status: 'active' | 'archived' | 'draft'
}

interface BootstrapRow {
  capability_hash: string
  expires_at: Date
  id: string
}

interface DatabaseNowRow {
  now: Date
}

interface NextVersionRow {
  version: number
}

export type PolicyChallengeCreationErrorCode =
  | 'BOOTSTRAP_MISMATCH'
  | 'BOOTSTRAP_REQUIRED'
  | 'INVALID_REQUEST'
  | 'RESOURCE_NOT_FOUND'
  | 'RESOURCE_STATE_CONFLICT'

export interface CreatedPolicyChallenge {
  canonicalMessage: string
  expiresAt: Date
  merchantId: string
  nonce: string
  payload: PolicyPayload
  payloadHash: string
  policyVersionId: string
  productId: string
}

export class PolicyChallengeCreationError extends Error {
  readonly code: PolicyChallengeCreationErrorCode

  constructor(code: PolicyChallengeCreationErrorCode, message: string) {
    super(message)
    this.name = 'PolicyChallengeCreationError'
    this.code = code
  }
}

function fail(code: PolicyChallengeCreationErrorCode, message: string): never {
  throw new PolicyChallengeCreationError(code, message)
}

function requireOne<T>(rows: T[], code: PolicyChallengeCreationErrorCode, message: string): T {
  const row = rows[0]
  if (!row) fail(code, message)
  return row
}

function generatePublicToken(): string {
  return randomBytes(16).toString('base64url')
}

export async function createPolicyChallenge(
  client: postgres.Sql,
  rawInput: unknown,
): Promise<CreatedPolicyChallenge> {
  const inputResult = createPolicyChallengeInputSchema.safeParse(rawInput)
  if (!inputResult.success) fail('INVALID_REQUEST', 'The policy terms are invalid.')
  const input = inputResult.data

  let settlementAddress: string
  try {
    settlementAddress = normalizeNimiqAddress(input.settlementAddress)
  } catch {
    fail('INVALID_REQUEST', 'The settlement address is invalid.')
  }

  return client.begin(async (transaction) => {
    const locator = requireOne(
      await transaction<ResourceLocatorRow[]>`
        select merchants.id as merchant_id, products.id as product_id
        from products
        join merchants on merchants.id = products.merchant_id
        where merchants.public_id = ${input.merchantPublicId}
          and products.public_id = ${input.productPublicId}
      `,
      'RESOURCE_NOT_FOUND',
      'The merchant product was not found.',
    )

    const merchant = requireOne(
      await transaction<MerchantRow[]>`
        select policy_signer_address, status
        from merchants
        where id = ${locator.merchant_id}
        for update
      `,
      'RESOURCE_NOT_FOUND',
      'The merchant was not found.',
    )
    const product = requireOne(
      await transaction<ProductRow[]>`
        select name, status
        from products
        where id = ${locator.product_id} and merchant_id = ${locator.merchant_id}
        for update
      `,
      'RESOURCE_NOT_FOUND',
      'The merchant product was not found.',
    )
    if (merchant.status !== 'active' || product.status === 'archived') {
      fail('RESOURCE_STATE_CONFLICT', 'The merchant product cannot accept a new policy.')
    }

    const databaseNow = requireOne(
      await transaction<DatabaseNowRow[]>`select clock_timestamp() as now`,
      'RESOURCE_STATE_CONFLICT',
      'The database clock was unavailable.',
    ).now
    let bootstrap: BootstrapRow | undefined

    if (merchant.policy_signer_address === null) {
      if (!input.bootstrapCapability) {
        fail('BOOTSTRAP_REQUIRED', 'A valid merchant bootstrap is required for the first policy.')
      }
      bootstrap = requireOne(
        await transaction<BootstrapRow[]>`
          select id, capability_hash, expires_at
          from merchant_bootstrap_sessions
          where merchant_id = ${locator.merchant_id}
            and consumed_at is null
          for update
        `,
        'BOOTSTRAP_MISMATCH',
        'The merchant bootstrap does not authorize this policy.',
      )
      if (
        databaseNow.getTime() >= bootstrap.expires_at.getTime()
        || !merchantBootstrapCapabilityMatches(
          input.bootstrapCapability,
          bootstrap.capability_hash,
        )
      ) {
        fail('BOOTSTRAP_MISMATCH', 'The merchant bootstrap does not authorize this policy.')
      }
    } else if (input.bootstrapCapability) {
      fail('BOOTSTRAP_MISMATCH', 'An established merchant requires its authenticated session.')
    }

    const version = requireOne(
      await transaction<NextVersionRow[]>`
        select coalesce(max(version), 0)::integer + 1 as version
        from policy_versions
        where product_id = ${locator.product_id}
      `,
      'RESOURCE_STATE_CONFLICT',
      'The next policy version could not be allocated.',
    ).version
    const policyPublicId = generatePublicToken()
    const nonce = generatePublicToken()
    const payload: PolicyPayload = {
      createdAt: databaseNow.getTime(),
      merchantId: input.merchantPublicId,
      nonce,
      policyId: policyPublicId,
      priceLuna: input.priceLuna,
      productId: input.productPublicId,
      productName: product.name,
      protocol: 'NR1',
      returnWindowSeconds: input.returnWindowSeconds,
      settlementAddress,
      type: 'POLICY',
      version,
      warrantyTransferAllowed: input.warrantyTransferAllowed,
      warrantyWindowSeconds: input.warrantyWindowSeconds,
    }

    let canonicalMessage: string
    try {
      canonicalMessage = buildPolicyMessage(payload)
    } catch {
      fail('RESOURCE_STATE_CONFLICT', 'Stored product data cannot form a canonical policy.')
    }
    const payloadHash = hashProtocolPayload(canonicalMessage)
    const policyRows = await transaction<{ id: string }[]>`
      insert into policy_versions (
        public_id, product_id, merchant_id, version, product_name, price_luna,
        return_window_seconds, warranty_window_seconds, warranty_transfer_allowed,
        protocol_version, challenge_nonce, payload, canonical_message, payload_hash,
        settlement_address
      ) values (
        ${policyPublicId}, ${locator.product_id}, ${locator.merchant_id}, ${version},
        ${payload.productName}, ${payload.priceLuna}, ${payload.returnWindowSeconds},
        ${payload.warrantyWindowSeconds}, ${payload.warrantyTransferAllowed}, ${payload.protocol},
        ${nonce}, ${transaction.json(payload)}, ${canonicalMessage}, ${payloadHash},
        ${settlementAddress}
      )
      returning id
    `
    const policyVersionId = requireOne(
      policyRows,
      'RESOURCE_STATE_CONFLICT',
      'The policy candidate could not be stored.',
    ).id

    const requestedExpiry = new Date(databaseNow.getTime() + CHALLENGE_TTL_MS)
    const expiresAt = bootstrap && bootstrap.expires_at < requestedExpiry
      ? bootstrap.expires_at
      : requestedExpiry
    await transaction`
      insert into signing_challenges (
        nonce, action, merchant_id, policy_version_id, bootstrap_session_id,
        expected_signer_address, canonical_message, payload_hash, expires_at,
        created_at
      ) values (
        ${nonce}, 'POLICY', ${locator.merchant_id}, ${policyVersionId},
        ${bootstrap?.id ?? null}, ${merchant.policy_signer_address}, ${canonicalMessage},
        ${payloadHash}, ${expiresAt}, ${databaseNow}
      )
    `

    return {
      canonicalMessage,
      expiresAt,
      merchantId: locator.merchant_id,
      nonce,
      payload,
      payloadHash,
      policyVersionId,
      productId: locator.product_id,
    }
  })
}
