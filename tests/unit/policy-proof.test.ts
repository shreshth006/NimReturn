import { Hash, KeyPair, PrivateKey } from '@nimiq/core'
import { describe, expect, it } from 'vitest'

import {
  POLICY_PROOF_VERIFIER_VERSION,
  verifyPolicyProof,
} from '../../server/domain/policy-proof.js'
import { hashProtocolPayload } from '../../src/lib/crypto/nimiq-signature.js'
import { buildPolicyMessage, type PolicyPayload } from '../../src/lib/protocol/policy.js'

const PRIVATE_KEY_A = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f'
const PRIVATE_KEY_B = '1f1e1d1c1b1a191817161514131211100f0e0d0c0b0a09080706050403020100'
const UTF8_ENCODER = new TextEncoder()
const SIGNED_MESSAGE_PREFIX = '\x16Nimiq Signed Message:\n'
const NOW = new Date('2026-09-15T00:00:00.000Z')

function signingDigest(message: string): Uint8Array {
  const messageBytes = UTF8_ENCODER.encode(message)
  const header = UTF8_ENCODER.encode(SIGNED_MESSAGE_PREFIX + messageBytes.byteLength.toString(10))
  const preimage = new Uint8Array(header.byteLength + messageBytes.byteLength)
  preimage.set(header)
  preimage.set(messageBytes, header.byteLength)
  return Hash.computeSha256(preimage)
}

function createSigner(privateKeyHex: string) {
  const privateKey = PrivateKey.fromHex(privateKeyHex)
  const keyPair = KeyPair.derive(privateKey)
  const address = keyPair.toAddress()
  try {
    return {
      address: address.toUserFriendlyAddress().replaceAll(' ', '').toUpperCase(),
      publicKey: keyPair.publicKey.toHex(),
      sign(message: string) {
        const signingPrivateKey = PrivateKey.fromHex(privateKeyHex)
        const signingKeyPair = KeyPair.derive(signingPrivateKey)
        const signature = signingKeyPair.sign(signingDigest(message))
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

const signer = createSigner(PRIVATE_KEY_A)
const otherSigner = createSigner(PRIVATE_KEY_B)
const payload: PolicyPayload = {
  createdAt: 1_789_335_000_000,
  merchantId: 'mL7n2psWQfTx9Vj3aBcDeA',
  nonce: 'q83Jqsl5-8Y4LtxjYOLmVA',
  policyId: 'YF4gIYhmXuGXNNDv2wO8nQ',
  priceLuna: 500_000,
  productId: 'uWzZJsbCx96gQkB6Mb0Xlg',
  productName: 'Wireless Mouse',
  protocol: 'NR1',
  returnWindowSeconds: 604_800,
  settlementAddress: otherSigner.address,
  type: 'POLICY',
  version: 1,
  warrantyTransferAllowed: false,
  warrantyWindowSeconds: 7_776_000,
}
const canonicalMessage = buildPolicyMessage(payload)
const payloadHash = hashProtocolPayload(canonicalMessage)
const proof = {
  canonicalMessage,
  payloadHash,
  publicKey: signer.publicKey,
  signature: signer.sign(canonicalMessage),
}

function challenge(expectedSignerAddress: string | null = null) {
  return {
    action: 'POLICY',
    canonicalMessage,
    consumedAt: null,
    expectedSignerAddress,
    expiresAt: new Date(NOW.getTime() + 60_000),
    payload,
    payloadHash,
  }
}

describe('policy proof verification', () => {
  it('derives a first-policy signer while preserving a distinct signed settlement address', () => {
    const result = verifyPolicyProof({ challenge: challenge(), now: NOW, proof })
    expect(payload.settlementAddress).not.toBe(signer.address)
    expect(result).toEqual({
      actualSignerAddress: signer.address,
      payloadHash,
      publicKey: signer.publicKey,
      signature: proof.signature,
      valid: true,
      verifierVersion: POLICY_PROOF_VERIFIER_VERSION,
    })
  })

  it('accepts only the established merchant signer', () => {
    expect(verifyPolicyProof({
      challenge: challenge(signer.address),
      now: NOW,
      proof,
    }).valid).toBe(true)

    const wrongProof = {
      ...proof,
      publicKey: otherSigner.publicKey,
      signature: otherSigner.sign(canonicalMessage),
    }
    expect(verifyPolicyProof({
      challenge: challenge(signer.address),
      now: NOW,
      proof: wrongProof,
    })).toMatchObject({ code: 'SIGNER_MISMATCH', valid: false })
  })

  it('rejects altered submitted message bytes before signature acceptance', () => {
    expect(verifyPolicyProof({
      challenge: challenge(),
      now: NOW,
      proof: { ...proof, canonicalMessage: `${canonicalMessage} ` },
    })).toMatchObject({ code: 'MESSAGE_MISMATCH', valid: false })
  })

  it('rejects a submitted payload hash that differs from the stored challenge', () => {
    expect(verifyPolicyProof({
      challenge: challenge(),
      now: NOW,
      proof: { ...proof, payloadHash: 'ab'.repeat(32) },
    })).toMatchObject({ code: 'PAYLOAD_HASH_MISMATCH', valid: false })
  })

  it('rejects an invalid signature without an unframed-message fallback', () => {
    const changedByte = proof.signature.startsWith('00') ? '01' : '00'
    expect(verifyPolicyProof({
      challenge: challenge(),
      now: NOW,
      proof: { ...proof, signature: changedByte + proof.signature.slice(2) },
    })).toMatchObject({ code: 'INVALID_SIGNATURE', valid: false })
  })

  it('fails closed when stored message or hash evidence is inconsistent', () => {
    expect(verifyPolicyProof({
      challenge: { ...challenge(), canonicalMessage: `${canonicalMessage} ` },
      now: NOW,
      proof,
    })).toMatchObject({ code: 'INVALID_CHALLENGE', valid: false })
    expect(verifyPolicyProof({
      challenge: { ...challenge(), payloadHash: 'cd'.repeat(32) },
      now: NOW,
      proof,
    })).toMatchObject({ code: 'INVALID_CHALLENGE', valid: false })
  })

  it('rejects consumed and expired challenges including the exact expiry boundary', () => {
    expect(verifyPolicyProof({
      challenge: { ...challenge(), consumedAt: new Date(NOW.getTime() - 1) },
      now: NOW,
      proof,
    })).toMatchObject({ code: 'CHALLENGE_CONSUMED', valid: false })
    expect(verifyPolicyProof({
      challenge: { ...challenge(), expiresAt: NOW },
      now: NOW,
      proof,
    })).toMatchObject({ code: 'CHALLENGE_EXPIRED', valid: false })
  })

  it('rejects malformed proof and non-canonical stored signer input', () => {
    expect(verifyPolicyProof({
      challenge: challenge(),
      now: NOW,
      proof: { ...proof, signature: '00' },
    })).toMatchObject({ code: 'INVALID_PROOF', valid: false })
    expect(verifyPolicyProof({
      challenge: challenge(signer.address.toLowerCase()),
      now: NOW,
      proof,
    })).toMatchObject({ code: 'INVALID_CHALLENGE', valid: false })
  })
})
