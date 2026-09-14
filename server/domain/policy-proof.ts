import { z } from 'zod'

import {
  hashProtocolPayload,
  normalizeNimiqAddress,
  verifyNimiqMessageSignature,
} from '../../src/lib/crypto/nimiq-signature.js'
import {
  buildPolicyMessage,
  policyPayloadSchema,
  policyProofEnvelopeSchema,
} from '../../src/lib/protocol/policy.js'

export const POLICY_PROOF_VERIFIER_VERSION = 'nr1-policy-proof-v1'

const storedPolicyChallengeSchema = z.object({
  action: z.literal('POLICY'),
  canonicalMessage: z.string().min(1).max(4096),
  consumedAt: z.date().nullable(),
  expectedSignerAddress: z.string().min(1).max(64).nullable(),
  expiresAt: z.date(),
  payload: policyPayloadSchema,
  payloadHash: z.string().regex(/^[0-9a-f]{64}$/u),
}).strict()

export type PolicyProofFailureCode =
  | 'CHALLENGE_CONSUMED'
  | 'CHALLENGE_EXPIRED'
  | 'INVALID_CHALLENGE'
  | 'INVALID_PROOF'
  | 'INVALID_SIGNATURE'
  | 'MESSAGE_MISMATCH'
  | 'PAYLOAD_HASH_MISMATCH'
  | 'SIGNER_MISMATCH'

export type PolicyProofVerification =
  | {
      actualSignerAddress: string
      payloadHash: string
      publicKey: string
      signature: string
      valid: true
      verifierVersion: typeof POLICY_PROOF_VERIFIER_VERSION
    }
  | {
      code: PolicyProofFailureCode
      message: string
      valid: false
    }

function failure(code: PolicyProofFailureCode, message: string): PolicyProofVerification {
  return { code, message, valid: false }
}

export function verifyPolicyProof(input: {
  challenge: unknown
  now?: Date
  proof: unknown
}): PolicyProofVerification {
  const challengeResult = storedPolicyChallengeSchema.safeParse(input.challenge)
  if (!challengeResult.success || (input.now && Number.isNaN(input.now.getTime()))) {
    return failure('INVALID_CHALLENGE', 'The stored policy challenge is invalid.')
  }
  const challenge = challengeResult.data
  const now = input.now ?? new Date()

  if (challenge.consumedAt) {
    return failure('CHALLENGE_CONSUMED', 'The policy signing challenge was already consumed.')
  }
  if (now.getTime() >= challenge.expiresAt.getTime()) {
    return failure('CHALLENGE_EXPIRED', 'The policy signing challenge has expired.')
  }

  let expectedMessage: string
  let expectedSignerAddress: string | null = null
  try {
    expectedMessage = buildPolicyMessage(challenge.payload)
    if (challenge.expectedSignerAddress) {
      expectedSignerAddress = normalizeNimiqAddress(challenge.expectedSignerAddress)
      if (expectedSignerAddress !== challenge.expectedSignerAddress) {
        return failure('INVALID_CHALLENGE', 'The stored policy challenge is invalid.')
      }
    }
  } catch {
    return failure('INVALID_CHALLENGE', 'The stored policy challenge is invalid.')
  }

  if (challenge.canonicalMessage !== expectedMessage) {
    return failure('INVALID_CHALLENGE', 'The stored policy message does not match its payload.')
  }
  const expectedPayloadHash = hashProtocolPayload(expectedMessage)
  if (challenge.payloadHash !== expectedPayloadHash) {
    return failure('INVALID_CHALLENGE', 'The stored policy hash does not match its message.')
  }

  const proofResult = policyProofEnvelopeSchema.safeParse(input.proof)
  if (!proofResult.success) {
    return failure('INVALID_PROOF', 'The policy signature proof format is invalid.')
  }
  const proof = proofResult.data

  if (proof.canonicalMessage !== expectedMessage) {
    return failure('MESSAGE_MISMATCH', 'The submitted message does not match the stored challenge.')
  }
  if (proof.payloadHash !== expectedPayloadHash) {
    return failure('PAYLOAD_HASH_MISMATCH', 'The submitted hash does not match the stored challenge.')
  }

  const signatureVerification = verifyNimiqMessageSignature({
    message: expectedMessage,
    publicKey: proof.publicKey,
    signature: proof.signature,
  })
  if (!signatureVerification.signatureValid || !signatureVerification.actualSignerAddress) {
    return failure('INVALID_SIGNATURE', 'The policy signature is invalid.')
  }
  if (signatureVerification.payloadHash !== expectedPayloadHash) {
    return failure('PAYLOAD_HASH_MISMATCH', 'The verified message hash does not match the challenge.')
  }

  let actualSignerAddress: string
  try {
    actualSignerAddress = normalizeNimiqAddress(signatureVerification.actualSignerAddress)
  } catch {
    return failure('INVALID_SIGNATURE', 'The proof public key did not derive a valid signer.')
  }
  if (expectedSignerAddress && actualSignerAddress !== expectedSignerAddress) {
    return failure('SIGNER_MISMATCH', 'The proof signer does not match the merchant policy signer.')
  }

  return {
    actualSignerAddress,
    payloadHash: expectedPayloadHash,
    publicKey: proof.publicKey,
    signature: proof.signature,
    valid: true,
    verifierVersion: POLICY_PROOF_VERIFIER_VERSION,
  }
}
