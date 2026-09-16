import { randomBytes } from 'node:crypto'
import type postgres from 'postgres'
import { z } from 'zod'

import {
  hashProtocolPayload,
  normalizeNimiqAddress,
  verifyNimiqMessageSignature,
} from '../../src/lib/crypto/nimiq-signature.js'
import {
  buildMerchantSessionMessage,
  MERCHANT_SESSION_CHALLENGE_TTL_MS,
  merchantSessionPayloadSchema,
  merchantSessionProofEnvelopeSchema,
  type MerchantSessionPayload,
} from '../../src/lib/protocol/merchant-session.js'

const PUBLIC_TOKEN_PATTERN = /^[A-Za-z0-9_-]{22}$/u
// Reissue instead of returning a challenge too close to expiry to be signed on a phone.
const MERCHANT_SESSION_CHALLENGE_MIN_REUSE_MS = 60 * 1000

const exactOriginSchema = z.string().min(1).max(2_048).superRefine((value, context) => {
  try {
    const parsed = new URL(value)
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== value) {
      context.addIssue({ code: 'custom', message: 'Audience must be an exact HTTP(S) origin.' })
    }
  } catch {
    context.addIssue({ code: 'custom', message: 'Audience must be a valid origin.' })
  }
})

const createInputSchema = z.object({
  audience: exactOriginSchema,
  merchantPublicId: z.string().regex(PUBLIC_TOKEN_PATTERN),
}).strict()

const restoreInputSchema = z.object({
  challengeNonce: z.string().regex(PUBLIC_TOKEN_PATTERN),
  merchantPublicId: z.string().regex(PUBLIC_TOKEN_PATTERN),
  proof: z.unknown(),
}).strict()

const storedChallengeSchema = z.object({
  audience: exactOriginSchema,
  canonicalMessage: z.string().min(1).max(4_096),
  consumedAt: z.date().nullable(),
  createdAt: z.date(),
  expectedSignerAddress: z.string().min(1).max(64),
  expiresAt: z.date(),
  merchantPublicId: z.string().regex(PUBLIC_TOKEN_PATTERN),
  nonce: z.string().regex(PUBLIC_TOKEN_PATTERN),
  payload: merchantSessionPayloadSchema,
  payloadHash: z.string().regex(/^[0-9a-f]{64}$/u),
}).strict()

interface MerchantRow {
  id: string
  policy_signer_address: string | null
  public_id: string
  status: 'active' | 'disabled'
}

interface DatabaseNowRow {
  now: Date
}

interface StoredChallengeRow {
  audience: string
  canonical_message: string
  consumed_at: Date | null
  created_at: Date
  expected_signer_address: string
  expires_at: Date
  merchant_id: string
  merchant_public_id: string
  nonce: string
  payload: unknown
  payload_hash: string
}

export type MerchantSessionRecoveryErrorCode =
  | 'CHALLENGE_CONSUMED'
  | 'CHALLENGE_EXPIRED'
  | 'INVALID_CHALLENGE'
  | 'INVALID_PROOF'
  | 'INVALID_REQUEST'
  | 'INVALID_SIGNATURE'
  | 'MERCHANT_NOT_FOUND'
  | 'MERCHANT_STATE_CONFLICT'
  | 'MESSAGE_MISMATCH'
  | 'PAYLOAD_HASH_MISMATCH'
  | 'SIGNER_MISMATCH'

export interface CreatedMerchantSessionChallenge {
  canonicalMessage: string
  expiresAt: Date
  expectedSignerAddress: string
  merchantId: string
  nonce: string
  payload: MerchantSessionPayload
  payloadHash: string
}

export interface RestoredMerchantSession {
  merchantId: string
  merchantPublicId: string
  signerAddress: string
}

export type MerchantSessionProofVerification =
  | {
      actualSignerAddress: string
      payloadHash: string
      publicKey: string
      signature: string
      valid: true
      verifierVersion: typeof MERCHANT_SESSION_PROOF_VERIFIER_VERSION
    }
  | {
      code: Exclude<
        MerchantSessionRecoveryErrorCode,
        'INVALID_REQUEST' | 'MERCHANT_NOT_FOUND' | 'MERCHANT_STATE_CONFLICT'
      >
      message: string
      valid: false
    }

export const MERCHANT_SESSION_PROOF_VERIFIER_VERSION = 'merchant-session-auth-v1'

export class MerchantSessionRecoveryError extends Error {
  readonly code: MerchantSessionRecoveryErrorCode

  constructor(code: MerchantSessionRecoveryErrorCode, message: string) {
    super(message)
    this.name = 'MerchantSessionRecoveryError'
    this.code = code
  }
}

function fail(code: MerchantSessionRecoveryErrorCode, message: string): never {
  throw new MerchantSessionRecoveryError(code, message)
}

function failure(
  code: Extract<MerchantSessionProofVerification, { valid: false }>['code'],
  message: string,
): MerchantSessionProofVerification {
  return { code, message, valid: false }
}

function requireOne<T>(
  rows: T[],
  code: MerchantSessionRecoveryErrorCode,
  message: string,
): T {
  const row = rows[0]
  if (!row) fail(code, message)
  return row
}

function generatePublicToken(): string {
  return randomBytes(16).toString('base64url')
}

function storedChallenge(row: StoredChallengeRow) {
  return {
    audience: row.audience,
    canonicalMessage: row.canonical_message,
    consumedAt: row.consumed_at,
    createdAt: row.created_at,
    expectedSignerAddress: row.expected_signer_address,
    expiresAt: row.expires_at,
    merchantPublicId: row.merchant_public_id,
    nonce: row.nonce,
    payload: row.payload,
    payloadHash: row.payload_hash,
  }
}

function requireValidProof(
  result: MerchantSessionProofVerification,
): Extract<MerchantSessionProofVerification, { valid: true }> {
  if (!result.valid) fail(result.code, result.message)
  return result
}

export function verifyMerchantSessionProof(input: {
  challenge: unknown
  now?: Date
  proof: unknown
}): MerchantSessionProofVerification {
  const challengeResult = storedChallengeSchema.safeParse(input.challenge)
  if (!challengeResult.success || (input.now && Number.isNaN(input.now.getTime()))) {
    return failure('INVALID_CHALLENGE', 'The stored merchant session challenge is invalid.')
  }
  const challenge = challengeResult.data
  const now = input.now ?? new Date()

  if (challenge.consumedAt) {
    return failure('CHALLENGE_CONSUMED', 'The merchant session challenge was already consumed.')
  }
  if (now.getTime() >= challenge.expiresAt.getTime()) {
    return failure('CHALLENGE_EXPIRED', 'The merchant session challenge has expired.')
  }

  let expectedMessage: string
  let expectedSignerAddress: string
  try {
    expectedMessage = buildMerchantSessionMessage(challenge.payload)
    expectedSignerAddress = normalizeNimiqAddress(challenge.expectedSignerAddress)
    if (
      expectedSignerAddress !== challenge.expectedSignerAddress
      || challenge.payload.policySignerAddress !== expectedSignerAddress
      || challenge.payload.merchantId !== challenge.merchantPublicId
      || challenge.payload.nonce !== challenge.nonce
      || challenge.payload.audience !== challenge.audience
      || challenge.payload.createdAt !== challenge.createdAt.getTime()
      || challenge.payload.expiresAt !== challenge.expiresAt.getTime()
    ) {
      return failure('INVALID_CHALLENGE', 'The stored merchant session challenge is inconsistent.')
    }
  } catch {
    return failure('INVALID_CHALLENGE', 'The stored merchant session challenge is invalid.')
  }

  const expectedPayloadHash = hashProtocolPayload(expectedMessage)
  if (
    challenge.canonicalMessage !== expectedMessage
    || challenge.payloadHash !== expectedPayloadHash
  ) {
    return failure('INVALID_CHALLENGE', 'The stored merchant session evidence is inconsistent.')
  }

  const proofResult = merchantSessionProofEnvelopeSchema.safeParse(input.proof)
  if (!proofResult.success) {
    return failure('INVALID_PROOF', 'The merchant session proof format is invalid.')
  }
  const proof = proofResult.data
  if (proof.canonicalMessage !== expectedMessage) {
    return failure('MESSAGE_MISMATCH', 'The submitted message does not match the challenge.')
  }
  if (proof.payloadHash !== expectedPayloadHash) {
    return failure('PAYLOAD_HASH_MISMATCH', 'The submitted hash does not match the challenge.')
  }

  const signatureVerification = verifyNimiqMessageSignature({
    message: expectedMessage,
    publicKey: proof.publicKey,
    signature: proof.signature,
  })
  if (!signatureVerification.signatureValid || !signatureVerification.actualSignerAddress) {
    return failure('INVALID_SIGNATURE', 'The merchant session signature is invalid.')
  }
  if (signatureVerification.payloadHash !== expectedPayloadHash) {
    return failure('PAYLOAD_HASH_MISMATCH', 'The verified message hash does not match the challenge.')
  }

  let actualSignerAddress: string
  try {
    actualSignerAddress = normalizeNimiqAddress(signatureVerification.actualSignerAddress)
  } catch {
    return failure('INVALID_SIGNATURE', 'The proof did not derive a valid signer.')
  }
  if (actualSignerAddress !== expectedSignerAddress) {
    return failure('SIGNER_MISMATCH', 'The proof signer is not the merchant policy signer.')
  }

  return {
    actualSignerAddress,
    payloadHash: expectedPayloadHash,
    publicKey: proof.publicKey,
    signature: proof.signature,
    valid: true,
    verifierVersion: MERCHANT_SESSION_PROOF_VERIFIER_VERSION,
  }
}

export async function createMerchantSessionChallenge(
  client: postgres.Sql,
  rawInput: unknown,
): Promise<CreatedMerchantSessionChallenge> {
  const inputResult = createInputSchema.safeParse(rawInput)
  if (!inputResult.success) fail('INVALID_REQUEST', 'The merchant session request is invalid.')
  const input = inputResult.data

  return client.begin(async (transaction) => {
    const merchant = requireOne(
      await transaction<MerchantRow[]>`
        select id, public_id, policy_signer_address, status
        from merchants
        where public_id = ${input.merchantPublicId}
        for update
      `,
      'MERCHANT_NOT_FOUND',
      'The merchant was not found.',
    )
    if (merchant.status !== 'active' || merchant.policy_signer_address === null) {
      fail('MERCHANT_STATE_CONFLICT', 'The merchant cannot restore an established session.')
    }

    const databaseNow = requireOne(
      await transaction<DatabaseNowRow[]>`select clock_timestamp() as now`,
      'MERCHANT_STATE_CONFLICT',
      'The database clock was unavailable.',
    ).now
    const reusableUntil = new Date(databaseNow.getTime() + MERCHANT_SESSION_CHALLENGE_MIN_REUSE_MS)

    const existingRows = await transaction<StoredChallengeRow[]>`
      select
        merchant_session_challenges.audience,
        merchant_session_challenges.canonical_message,
        merchant_session_challenges.consumed_at,
        merchant_session_challenges.created_at,
        merchant_session_challenges.expected_signer_address,
        merchant_session_challenges.expires_at,
        merchant_session_challenges.merchant_id,
        merchants.public_id as merchant_public_id,
        merchant_session_challenges.nonce,
        merchant_session_challenges.payload,
        merchant_session_challenges.payload_hash
      from merchant_session_challenges
      join merchants on merchants.id = merchant_session_challenges.merchant_id
      where merchant_session_challenges.merchant_id = ${merchant.id}
        and merchant_session_challenges.expected_signer_address = ${merchant.policy_signer_address}
        and merchant_session_challenges.audience = ${input.audience}
        and merchant_session_challenges.consumed_at is null
        and merchant_session_challenges.expires_at > ${reusableUntil}
      order by merchant_session_challenges.created_at desc
      limit 1
      for update of merchant_session_challenges
    `
    const existing = existingRows[0]
    if (existing) {
      const parsed = storedChallengeSchema.safeParse(storedChallenge(existing))
      if (!parsed.success) {
        fail('MERCHANT_STATE_CONFLICT', 'The stored merchant session challenge is invalid.')
      }
      const canonicalMessage = buildMerchantSessionMessage(parsed.data.payload)
      const payloadHash = hashProtocolPayload(canonicalMessage)
      if (
        canonicalMessage !== parsed.data.canonicalMessage
        || payloadHash !== parsed.data.payloadHash
        || parsed.data.payload.merchantId !== merchant.public_id
        || parsed.data.payload.nonce !== parsed.data.nonce
        || parsed.data.payload.policySignerAddress !== merchant.policy_signer_address
        || parsed.data.payload.audience !== input.audience
        || parsed.data.payload.createdAt !== parsed.data.createdAt.getTime()
        || parsed.data.payload.expiresAt !== parsed.data.expiresAt.getTime()
      ) {
        fail('MERCHANT_STATE_CONFLICT', 'The stored merchant session challenge is inconsistent.')
      }
      return {
        canonicalMessage,
        expiresAt: parsed.data.expiresAt,
        expectedSignerAddress: merchant.policy_signer_address,
        merchantId: merchant.id,
        nonce: existing.nonce,
        payload: parsed.data.payload,
        payloadHash,
      }
    }

    const nonce = generatePublicToken()
    const expiresAt = new Date(databaseNow.getTime() + MERCHANT_SESSION_CHALLENGE_TTL_MS)
    const payload: MerchantSessionPayload = {
      audience: input.audience,
      createdAt: databaseNow.getTime(),
      expiresAt: expiresAt.getTime(),
      merchantId: merchant.public_id,
      nonce,
      policySignerAddress: merchant.policy_signer_address,
      type: 'MERCHANT_SESSION',
      version: 1,
    }
    const canonicalMessage = buildMerchantSessionMessage(payload)
    const payloadHash = hashProtocolPayload(canonicalMessage)

    await transaction`
      insert into merchant_session_challenges (
        nonce, merchant_id, expected_signer_address, audience, payload,
        canonical_message, payload_hash, expires_at, created_at
      ) values (
        ${nonce}, ${merchant.id}, ${merchant.policy_signer_address}, ${input.audience},
        ${transaction.json(payload)}, ${canonicalMessage}, ${payloadHash}, ${expiresAt},
        ${databaseNow}
      )
    `

    return {
      canonicalMessage,
      expiresAt,
      expectedSignerAddress: merchant.policy_signer_address,
      merchantId: merchant.id,
      nonce,
      payload,
      payloadHash,
    }
  })
}

export async function restoreMerchantSession(
  client: postgres.Sql,
  rawInput: unknown,
): Promise<RestoredMerchantSession> {
  const inputResult = restoreInputSchema.safeParse(rawInput)
  if (!inputResult.success) fail('INVALID_REQUEST', 'The merchant session proof is invalid.')
  const input = inputResult.data

  return client.begin(async (transaction) => {
    const merchant = requireOne(
      await transaction<MerchantRow[]>`
        select id, public_id, policy_signer_address, status
        from merchants
        where public_id = ${input.merchantPublicId}
        for update
      `,
      'MERCHANT_NOT_FOUND',
      'The merchant was not found.',
    )
    if (merchant.status !== 'active' || merchant.policy_signer_address === null) {
      fail('MERCHANT_STATE_CONFLICT', 'The merchant policy signer is unavailable.')
    }

    const challenge = requireOne(
      await transaction<StoredChallengeRow[]>`
        select
          merchant_session_challenges.audience,
          merchant_session_challenges.canonical_message,
          merchant_session_challenges.consumed_at,
          merchant_session_challenges.created_at,
          merchant_session_challenges.expected_signer_address,
          merchant_session_challenges.expires_at,
          merchant_session_challenges.merchant_id,
          merchants.public_id as merchant_public_id,
          merchant_session_challenges.nonce,
          merchant_session_challenges.payload,
          merchant_session_challenges.payload_hash
        from merchant_session_challenges
        join merchants on merchants.id = merchant_session_challenges.merchant_id
        where merchant_session_challenges.nonce = ${input.challengeNonce}
          and merchant_session_challenges.merchant_id = ${merchant.id}
        for update of merchant_session_challenges
      `,
      'MERCHANT_NOT_FOUND',
      'The merchant session challenge was not found.',
    )
    if (
      challenge.expected_signer_address !== merchant.policy_signer_address
    ) {
      fail('MERCHANT_STATE_CONFLICT', 'The merchant policy signer is unavailable or changed.')
    }

    const databaseNow = requireOne(
      await transaction<DatabaseNowRow[]>`select clock_timestamp() as now`,
      'MERCHANT_STATE_CONFLICT',
      'The database clock was unavailable.',
    ).now
    const proof = requireValidProof(verifyMerchantSessionProof({
      challenge: storedChallenge(challenge),
      now: databaseNow,
      proof: input.proof,
    }))

    const consumedRows = await transaction<{ id: string }[]>`
      update merchant_session_challenges
      set consumed_at = ${databaseNow}
      where nonce = ${challenge.nonce}
        and consumed_at is null
        and expires_at > ${databaseNow}
      returning id
    `
    if (consumedRows.length !== 1) {
      fail('MERCHANT_STATE_CONFLICT', 'The merchant session challenge could not be consumed.')
    }

    return {
      merchantId: merchant.id,
      merchantPublicId: merchant.public_id,
      signerAddress: proof.actualSignerAddress,
    }
  })
}
