import { z } from 'zod'

import {
  hashProtocolPayload,
  normalizeNimiqAddress,
  verifyNimiqMessageSignature,
} from '../../src/lib/crypto/nimiq-signature.js'
import {
  buildResolutionMessage,
  resolutionPayloadSchema,
  resolutionProofEnvelopeSchema,
} from '../../src/lib/protocol/resolution.js'

export const RESOLUTION_PROOF_VERIFIER_VERSION = 'nr1-resolution-proof-v1'

const challengeSchema = z.object({
  canonicalMessage: z.string().min(1).max(4_096),
  consumedAt: z.date().nullable(),
  expectedSignerAddress: z.string().min(1).max(64),
  expiresAt: z.date(),
  payload: resolutionPayloadSchema,
  payloadHash: z.string().regex(/^[0-9a-f]{64}$/u),
}).strict()

export type ResolutionProofFailureCode =
  | 'CHALLENGE_CONSUMED'
  | 'CHALLENGE_EXPIRED'
  | 'INVALID_CHALLENGE'
  | 'INVALID_PROOF'
  | 'INVALID_SIGNATURE'
  | 'MESSAGE_MISMATCH'
  | 'PAYLOAD_HASH_MISMATCH'
  | 'SIGNER_MISMATCH'

export type ResolutionProofVerification =
  | {
      actualSignerAddress: string
      payloadHash: string
      publicKey: string
      signature: string
      valid: true
      verifierVersion: typeof RESOLUTION_PROOF_VERIFIER_VERSION
    }
  | { code: ResolutionProofFailureCode; message: string; valid: false }

function failure(code: ResolutionProofFailureCode, message: string): ResolutionProofVerification {
  return { code, message, valid: false }
}

export function verifyResolutionProof(input: {
  challenge: unknown
  now?: Date
  proof: unknown
}): ResolutionProofVerification {
  const parsed = challengeSchema.safeParse(input.challenge)
  if (!parsed.success || (input.now && Number.isNaN(input.now.getTime()))) {
    return failure('INVALID_CHALLENGE', 'The stored resolution challenge is invalid.')
  }
  const challenge = parsed.data
  const now = input.now ?? new Date()
  if (challenge.consumedAt) return failure('CHALLENGE_CONSUMED', 'The challenge was already consumed.')
  if (now.getTime() >= challenge.expiresAt.getTime()) {
    return failure('CHALLENGE_EXPIRED', 'The challenge has expired.')
  }

  let expectedMessage: string
  let expectedSigner: string
  try {
    expectedMessage = buildResolutionMessage(challenge.payload)
    expectedSigner = normalizeNimiqAddress(challenge.expectedSignerAddress)
    if (expectedSigner !== challenge.expectedSignerAddress) throw new Error('non-canonical signer')
  } catch {
    return failure('INVALID_CHALLENGE', 'The stored resolution challenge is invalid.')
  }
  const expectedHash = hashProtocolPayload(expectedMessage)
  if (challenge.canonicalMessage !== expectedMessage || challenge.payloadHash !== expectedHash) {
    return failure('INVALID_CHALLENGE', 'The stored resolution evidence is inconsistent.')
  }
  const proofResult = resolutionProofEnvelopeSchema.safeParse(input.proof)
  if (!proofResult.success) return failure('INVALID_PROOF', 'The proof format is invalid.')
  const proof = proofResult.data
  if (proof.canonicalMessage !== expectedMessage) {
    return failure('MESSAGE_MISMATCH', 'The submitted message does not match the challenge.')
  }
  if (proof.payloadHash !== expectedHash) {
    return failure('PAYLOAD_HASH_MISMATCH', 'The submitted hash does not match the challenge.')
  }
  const verified = verifyNimiqMessageSignature({
    message: expectedMessage,
    publicKey: proof.publicKey,
    signature: proof.signature,
  })
  if (!verified.signatureValid || !verified.actualSignerAddress) {
    return failure('INVALID_SIGNATURE', 'The resolution signature is invalid.')
  }
  const actualSignerAddress = normalizeNimiqAddress(verified.actualSignerAddress)
  if (actualSignerAddress !== expectedSigner) {
    return failure('SIGNER_MISMATCH', 'The proof signer is not the established policy signer.')
  }
  if (verified.payloadHash !== expectedHash) {
    return failure('PAYLOAD_HASH_MISMATCH', 'The verified hash does not match the challenge.')
  }
  return {
    actualSignerAddress,
    payloadHash: expectedHash,
    publicKey: proof.publicKey,
    signature: proof.signature,
    valid: true,
    verifierVersion: RESOLUTION_PROOF_VERIFIER_VERSION,
  }
}
