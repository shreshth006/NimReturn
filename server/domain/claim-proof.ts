import { z } from 'zod'

import {
  hashProtocolPayload,
  normalizeNimiqAddress,
  verifyNimiqMessageSignature,
} from '../../src/lib/crypto/nimiq-signature.js'
import {
  buildClaimAuthorizationMessage,
  buildClaimMessage,
  claimAuthorizationPayloadSchema,
  claimPayloadSchema,
  claimProofEnvelopeSchema,
} from '../../src/lib/protocol/claim.js'

export const CLAIM_PROOF_VERIFIER_VERSION = 'nr1-claim-proof-v1'

const storedChallengeSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('CLAIM'),
    canonicalMessage: z.string().min(1).max(4_096),
    consumedAt: z.date().nullable(),
    expectedSignerAddress: z.null(),
    expiresAt: z.date(),
    payload: claimPayloadSchema,
    payloadHash: z.string().regex(/^[0-9a-f]{64}$/u),
  }).strict(),
  z.object({
    action: z.literal('CLAIM_AUTHORIZATION'),
    canonicalMessage: z.string().min(1).max(4_096),
    consumedAt: z.date().nullable(),
    expectedSignerAddress: z.string().min(1).max(64),
    expiresAt: z.date(),
    payload: claimAuthorizationPayloadSchema,
    payloadHash: z.string().regex(/^[0-9a-f]{64}$/u),
  }).strict(),
])

export type ClaimProofFailureCode =
  | 'CHALLENGE_CONSUMED'
  | 'CHALLENGE_EXPIRED'
  | 'INVALID_CHALLENGE'
  | 'INVALID_PROOF'
  | 'INVALID_SIGNATURE'
  | 'MESSAGE_MISMATCH'
  | 'PAYLOAD_HASH_MISMATCH'
  | 'SIGNER_MISMATCH'

export type ClaimProofVerification =
  | {
      actualSignerAddress: string
      payloadHash: string
      publicKey: string
      signature: string
      valid: true
      verifierVersion: typeof CLAIM_PROOF_VERIFIER_VERSION
    }
  | { code: ClaimProofFailureCode; message: string; valid: false }

function failure(code: ClaimProofFailureCode, message: string): ClaimProofVerification {
  return { code, message, valid: false }
}

export function verifyClaimProof(input: {
  challenge: unknown
  now?: Date
  proof: unknown
}): ClaimProofVerification {
  const parsed = storedChallengeSchema.safeParse(input.challenge)
  if (!parsed.success || (input.now && Number.isNaN(input.now.getTime()))) {
    return failure('INVALID_CHALLENGE', 'The stored claim challenge is invalid.')
  }
  const challenge = parsed.data
  const now = input.now ?? new Date()
  if (challenge.consumedAt) return failure('CHALLENGE_CONSUMED', 'The challenge was already consumed.')
  if (now.getTime() >= challenge.expiresAt.getTime()) {
    return failure('CHALLENGE_EXPIRED', 'The challenge has expired.')
  }

  let expectedMessage: string
  let expectedSignerAddress: string | null = null
  try {
    expectedMessage = challenge.action === 'CLAIM'
      ? buildClaimMessage(challenge.payload)
      : buildClaimAuthorizationMessage(challenge.payload)
    if (challenge.expectedSignerAddress) {
      expectedSignerAddress = normalizeNimiqAddress(challenge.expectedSignerAddress)
      if (expectedSignerAddress !== challenge.expectedSignerAddress) {
        return failure('INVALID_CHALLENGE', 'The expected signer is not canonical.')
      }
    }
  } catch {
    return failure('INVALID_CHALLENGE', 'The stored claim challenge is invalid.')
  }
  if (challenge.canonicalMessage !== expectedMessage) {
    return failure('INVALID_CHALLENGE', 'The stored message does not match its payload.')
  }
  const expectedPayloadHash = hashProtocolPayload(expectedMessage)
  if (challenge.payloadHash !== expectedPayloadHash) {
    return failure('INVALID_CHALLENGE', 'The stored hash does not match its message.')
  }

  const proofResult = claimProofEnvelopeSchema.safeParse(input.proof)
  if (!proofResult.success) return failure('INVALID_PROOF', 'The proof format is invalid.')
  const proof = proofResult.data
  if (proof.canonicalMessage !== expectedMessage) {
    return failure('MESSAGE_MISMATCH', 'The submitted message does not match the challenge.')
  }
  if (proof.payloadHash !== expectedPayloadHash) {
    return failure('PAYLOAD_HASH_MISMATCH', 'The submitted hash does not match the challenge.')
  }

  const verified = verifyNimiqMessageSignature({
    message: expectedMessage,
    publicKey: proof.publicKey,
    signature: proof.signature,
  })
  if (!verified.signatureValid || !verified.actualSignerAddress) {
    return failure('INVALID_SIGNATURE', 'The signature is invalid.')
  }
  if (verified.payloadHash !== expectedPayloadHash) {
    return failure('PAYLOAD_HASH_MISMATCH', 'The verified message hash does not match the challenge.')
  }

  let actualSignerAddress: string
  try {
    actualSignerAddress = normalizeNimiqAddress(verified.actualSignerAddress)
  } catch {
    return failure('INVALID_SIGNATURE', 'The proof did not derive a valid signer.')
  }
  if (expectedSignerAddress && actualSignerAddress !== expectedSignerAddress) {
    return failure('SIGNER_MISMATCH', 'The authorization signer is not the verified purchase sender.')
  }

  return {
    actualSignerAddress,
    payloadHash: expectedPayloadHash,
    publicKey: proof.publicKey,
    signature: proof.signature,
    valid: true,
    verifierVersion: CLAIM_PROOF_VERIFIER_VERSION,
  }
}
