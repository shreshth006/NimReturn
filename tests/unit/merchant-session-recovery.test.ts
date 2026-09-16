import { Hash, KeyPair, PrivateKey } from '@nimiq/core'
import { describe, expect, it } from 'vitest'

import {
  MERCHANT_SESSION_PROOF_VERIFIER_VERSION,
  verifyMerchantSessionProof,
} from '../../server/domain/merchant-session-recovery.js'
import {
  validateMerchantSessionChallenge,
  verifyMerchantSessionWalletProof,
} from '../../src/features/merchant/session-recovery.js'
import { hashProtocolPayload } from '../../src/lib/crypto/nimiq-signature.js'
import {
  buildMerchantSessionMessage,
  merchantSessionPayloadSchema,
  type MerchantSessionPayload,
} from '../../src/lib/protocol/merchant-session.js'

const PRIVATE_KEY_A = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f'
const PRIVATE_KEY_B = '1f1e1d1c1b1a191817161514131211100f0e0d0c0b0a09080706050403020100'
const UTF8_ENCODER = new TextEncoder()
const NOW = new Date('2026-09-16T12:00:00.000Z')

function signer(privateKeyHex: string) {
  const privateKey = PrivateKey.fromHex(privateKeyHex)
  const keyPair = KeyPair.derive(privateKey)
  const address = keyPair.toAddress()
  try {
    return {
      address: address.toUserFriendlyAddress().replaceAll(' ', '').toUpperCase(),
      publicKey: keyPair.publicKey.toHex(),
      sign(message: string) {
        const messageBytes = UTF8_ENCODER.encode(message)
        const header = UTF8_ENCODER.encode(
          `\x16Nimiq Signed Message:\n${messageBytes.byteLength}`,
        )
        const framed = new Uint8Array(header.byteLength + messageBytes.byteLength)
        framed.set(header)
        framed.set(messageBytes, header.byteLength)

        const signingPrivateKey = PrivateKey.fromHex(privateKeyHex)
        const signingKeyPair = KeyPair.derive(signingPrivateKey)
        const signature = signingKeyPair.sign(Hash.computeSha256(framed))
        try {
          return signature.toHex()
        } finally {
          signature.free()
          signingKeyPair.free()
          signingPrivateKey.free()
        }
      },
    }
  } finally {
    address.free()
    keyPair.free()
    privateKey.free()
  }
}

const merchantSigner = signer(PRIVATE_KEY_A)
const otherSigner = signer(PRIVATE_KEY_B)
const payload: MerchantSessionPayload = {
  audience: 'https://staging.example.test',
  createdAt: NOW.getTime(),
  expiresAt: NOW.getTime() + (5 * 60 * 1_000),
  merchantId: 'mL7n2psWQfTx9Vj3aBcDeA',
  nonce: 'q83Jqsl5-8Y4LtxjYOLmVA',
  policySignerAddress: merchantSigner.address,
  type: 'MERCHANT_SESSION',
  version: 1,
}
const canonicalMessage = buildMerchantSessionMessage(payload)
const payloadHash = hashProtocolPayload(canonicalMessage)
const proof = {
  canonicalMessage,
  payloadHash,
  publicKey: merchantSigner.publicKey,
  signature: merchantSigner.sign(canonicalMessage),
}

function challenge() {
  return {
    audience: payload.audience,
    canonicalMessage,
    consumedAt: null,
    createdAt: NOW,
    expectedSignerAddress: merchantSigner.address,
    expiresAt: new Date(payload.expiresAt),
    merchantPublicId: payload.merchantId,
    nonce: payload.nonce,
    payload,
    payloadHash,
  }
}

describe('merchant session recovery protocol', () => {
  it('builds stable origin-bound authentication bytes outside the commercial NR1 domain', () => {
    expect(canonicalMessage).toBe(
      `NIMRETURN/AUTH/1/MERCHANT_SESSION\n{"audience":"https://staging.example.test","createdAt":1789560000000,"expiresAt":1789560300000,"merchantId":"mL7n2psWQfTx9Vj3aBcDeA","nonce":"q83Jqsl5-8Y4LtxjYOLmVA","policySignerAddress":"${merchantSigner.address}","type":"MERCHANT_SESSION","version":1}`,
    )
    expect(canonicalMessage).not.toContain('"protocol"')
  })

  it('requires an exact HTTP(S) origin and a lifetime no longer than five minutes', () => {
    expect(() => merchantSessionPayloadSchema.parse({
      ...payload,
      audience: 'https://staging.example.test/path',
    })).toThrow(/origin/iu)
    expect(() => merchantSessionPayloadSchema.parse({
      ...payload,
      expiresAt: payload.createdAt + (5 * 60 * 1_000) + 1,
    })).toThrow(/five minutes/iu)
    expect(() => merchantSessionPayloadSchema.parse({
      ...payload,
      protocol: 'NR1',
    })).toThrow()
  })

  it('verifies exact bytes and derives the established policy signer', () => {
    expect(verifyMerchantSessionProof({ challenge: challenge(), now: NOW, proof })).toEqual({
      actualSignerAddress: merchantSigner.address,
      payloadHash,
      publicKey: merchantSigner.publicKey,
      signature: proof.signature,
      valid: true,
      verifierVersion: MERCHANT_SESSION_PROOF_VERIFIER_VERSION,
    })
  })

  it('rejects another valid signer instead of treating address discovery as authority', () => {
    const wrongProof = {
      ...proof,
      publicKey: otherSigner.publicKey,
      signature: otherSigner.sign(canonicalMessage),
    }
    expect(verifyMerchantSessionProof({
      challenge: challenge(),
      now: NOW,
      proof: wrongProof,
    })).toMatchObject({ code: 'SIGNER_MISMATCH', valid: false })
  })

  it('rejects tampered submitted and stored evidence', () => {
    expect(verifyMerchantSessionProof({
      challenge: challenge(),
      now: NOW,
      proof: { ...proof, canonicalMessage: `${canonicalMessage} ` },
    })).toMatchObject({ code: 'MESSAGE_MISMATCH', valid: false })
    expect(verifyMerchantSessionProof({
      challenge: challenge(),
      now: NOW,
      proof: { ...proof, payloadHash: 'ab'.repeat(32) },
    })).toMatchObject({ code: 'PAYLOAD_HASH_MISMATCH', valid: false })
    expect(verifyMerchantSessionProof({
      challenge: { ...challenge(), audience: 'https://other.example.test' },
      now: NOW,
      proof,
    })).toMatchObject({ code: 'INVALID_CHALLENGE', valid: false })
    expect(verifyMerchantSessionProof({
      challenge: { ...challenge(), payloadHash: 'cd'.repeat(32) },
      now: NOW,
      proof,
    })).toMatchObject({ code: 'INVALID_CHALLENGE', valid: false })
  })

  it('rejects expired and consumed challenges, including the expiry boundary', () => {
    expect(verifyMerchantSessionProof({
      challenge: { ...challenge(), consumedAt: new Date(NOW.getTime() + 1) },
      now: NOW,
      proof,
    })).toMatchObject({ code: 'CHALLENGE_CONSUMED', valid: false })
    expect(verifyMerchantSessionProof({
      challenge: { ...challenge(), expiresAt: NOW },
      now: NOW,
      proof,
    })).toMatchObject({ code: 'CHALLENGE_EXPIRED', valid: false })
  })

  describe('client reconnect verification', () => {
    const apiChallenge = {
      canonicalMessage,
      expectedSignerAddress: merchantSigner.address,
      expiresAt: new Date(payload.expiresAt).toISOString(),
      nonce: payload.nonce,
      payload,
      payloadHash,
    }
    const expectation = {
      challenge: apiChallenge,
      expectedAudience: payload.audience,
      immutablePolicySignerAddress: merchantSigner.address,
      merchantPublicId: payload.merchantId,
      now: NOW.getTime(),
    }

    it('accepts only the immutable policy signer over the exact challenge bytes', () => {
      expect(verifyMerchantSessionWalletProof({
        ...expectation,
        walletProof: { publicKey: proof.publicKey, signature: proof.signature },
      })).toMatchObject({ proof, signerAddress: merchantSigner.address })

      expect(() => verifyMerchantSessionWalletProof({
        ...expectation,
        walletProof: {
          publicKey: otherSigner.publicKey,
          signature: otherSigner.sign(canonicalMessage),
        },
      })).toThrow(/requires policy signer/u)
      expect(() => verifyMerchantSessionWalletProof({
        ...expectation,
        walletProof: {
          publicKey: merchantSigner.publicKey,
          signature: merchantSigner.sign(`${canonicalMessage} `),
        },
      })).toThrow()
    })

    it('refuses challenges for another origin, merchant, signer, or expired window', () => {
      expect(() => validateMerchantSessionChallenge({
        ...expectation,
        expectedAudience: 'https://other.example.test',
      })).toThrow(/different application origin/u)
      expect(() => validateMerchantSessionChallenge({
        ...expectation,
        merchantPublicId: 'zzzzzzzzzzzzzzzzzzzzzz',
      })).toThrow(/different merchant/u)
      expect(() => validateMerchantSessionChallenge({
        ...expectation,
        immutablePolicySignerAddress: otherSigner.address,
      })).toThrow(/immutable policy signer/u)
      expect(() => validateMerchantSessionChallenge({
        ...expectation,
        now: payload.expiresAt,
      })).toThrow(/expired/u)
      expect(() => validateMerchantSessionChallenge({
        ...expectation,
        challenge: { ...apiChallenge, canonicalMessage: `${canonicalMessage} ` },
      })).toThrow(/exact canonical payload bytes/u)
    })
  })
})
