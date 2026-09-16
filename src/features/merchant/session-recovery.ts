import type { SignatureResult } from '@nimiq/mini-app-sdk'

import type { MerchantSessionChallenge } from '../../lib/api/merchant.js'
import {
  hashProtocolPayload,
  normalizeNimiqAddress,
  verifyNimiqMessageSignature,
} from '../../lib/crypto/nimiq-signature.js'
import { buildMerchantSessionMessage } from '../../lib/protocol/merchant-session.js'

export interface VerifiedMerchantSessionProof {
  proof: {
    canonicalMessage: string
    payloadHash: string
    publicKey: string
    signature: string
  }
  signedMessageDigest: string
  signerAddress: string
}

interface MerchantSessionChallengeExpectation {
  challenge: MerchantSessionChallenge
  expectedAudience: string
  immutablePolicySignerAddress: string
  merchantPublicId: string
  now?: number
}

export function validateMerchantSessionChallenge(
  input: MerchantSessionChallengeExpectation,
): { canonicalMessage: string; payloadHash: string; signerAddress: string } {
  const now = input.now ?? Date.now()
  const expectedOrigin = new URL(input.expectedAudience).origin
  const challengeOrigin = new URL(input.challenge.payload.audience).origin
  if (
    input.challenge.payload.audience !== challengeOrigin
    || challengeOrigin !== expectedOrigin
  ) {
    throw new Error('The reconnect challenge was issued for a different application origin.')
  }
  if (input.challenge.payload.merchantId !== input.merchantPublicId) {
    throw new Error('The reconnect challenge belongs to a different merchant.')
  }
  if (input.challenge.payload.expiresAt <= now) {
    throw new Error('The reconnect challenge expired. Request a fresh challenge before signing.')
  }

  const immutableSigner = normalizeNimiqAddress(input.immutablePolicySignerAddress)
  const challengeSigner = normalizeNimiqAddress(input.challenge.expectedSignerAddress)
  const payloadSigner = normalizeNimiqAddress(input.challenge.payload.policySignerAddress)
  if (challengeSigner !== immutableSigner || payloadSigner !== immutableSigner) {
    throw new Error('The reconnect challenge does not match the immutable policy signer.')
  }

  const rebuiltMessage = buildMerchantSessionMessage(input.challenge.payload)
  if (rebuiltMessage !== input.challenge.canonicalMessage) {
    throw new Error('The reconnect challenge does not contain the exact canonical payload bytes.')
  }
  const rebuiltHash = hashProtocolPayload(rebuiltMessage)
  if (rebuiltHash !== input.challenge.payloadHash) {
    throw new Error('The reconnect challenge payload hash does not match its canonical bytes.')
  }

  return {
    canonicalMessage: rebuiltMessage,
    payloadHash: rebuiltHash,
    signerAddress: immutableSigner,
  }
}

export function verifyMerchantSessionWalletProof(
  input: MerchantSessionChallengeExpectation & { walletProof: SignatureResult },
): VerifiedMerchantSessionProof {
  const validated = validateMerchantSessionChallenge(input)

  const publicKey = input.walletProof.publicKey.toLowerCase()
  const signature = input.walletProof.signature.toLowerCase()
  const verification = verifyNimiqMessageSignature({
    message: validated.canonicalMessage,
    publicKey,
    signature,
  })
  if (
    !verification.signatureValid
    || !verification.actualSignerAddress
    || !verification.signedMessageDigest
  ) {
    throw new Error(verification.error ?? 'The wallet reconnect signature did not verify locally.')
  }
  if (verification.payloadHash !== validated.payloadHash) {
    throw new Error('The wallet proof did not bind the exact reconnect challenge bytes.')
  }
  const signerAddress = normalizeNimiqAddress(verification.actualSignerAddress)
  if (signerAddress !== validated.signerAddress) {
    throw new Error(
      `This wallet signed as ${signerAddress}; merchant access requires policy signer ${validated.signerAddress}.`,
    )
  }

  return {
    proof: {
      canonicalMessage: validated.canonicalMessage,
      payloadHash: validated.payloadHash,
      publicKey,
      signature,
    },
    signedMessageDigest: verification.signedMessageDigest,
    signerAddress,
  }
}
