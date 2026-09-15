import { Hash, KeyPair, PrivateKey } from '@nimiq/core'
import { describe, expect, it } from 'vitest'

import { verifyResolutionProof } from '../../server/domain/resolution-proof.js'
import { hashProtocolPayload } from '../../src/lib/crypto/nimiq-signature.js'
import {
  buildResolutionMessage,
  resolutionPayloadSchema,
  type ResolutionPayload,
} from '../../src/lib/protocol/resolution.js'

const NOW = new Date('2026-09-15T14:00:00.000Z')
const PRIVATE_KEY_A = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f'
const PRIVATE_KEY_B = '1f1e1d1c1b1a191817161514131211100f0e0d0c0b0a09080706050403020100'
const UTF8_ENCODER = new TextEncoder()

function signer(privateKeyHex: string) {
  const privateKey = PrivateKey.fromHex(privateKeyHex)
  const keyPair = KeyPair.derive(privateKey)
  const address = keyPair.toAddress()
  try {
    return {
      address: address.toUserFriendlyAddress().replaceAll(' ', '').toUpperCase(),
      publicKey: keyPair.publicKey.toHex(),
      sign(message: string) {
        const bytes = UTF8_ENCODER.encode(message)
        const header = UTF8_ENCODER.encode(`\x16Nimiq Signed Message:\n${bytes.byteLength}`)
        const framed = new Uint8Array(header.byteLength + bytes.byteLength)
        framed.set(header)
        framed.set(bytes, header.byteLength)
        const key = PrivateKey.fromHex(privateKeyHex)
        const pair = KeyPair.derive(key)
        const signature = pair.sign(Hash.computeSha256(framed))
        try { return signature.toHex() } finally {
          signature.free()
          pair.free()
          key.free()
        }
      },
    }
  } finally {
    address.free()
    keyPair.free()
    privateKey.free()
  }
}

const merchant = signer(PRIVATE_KEY_A)
const other = signer(PRIVATE_KEY_B)
const payload: ResolutionPayload = {
  approvedRefundLuna: 500_000,
  claimId: 'bC2v2Ws4EkuJNV0ydOduaw',
  createdAt: NOW.getTime(),
  decision: 'APPROVED',
  nonce: '08EM9S-s91GdvhSUTkRr6w',
  note: 'Approved under return policy',
  policySignerAddress: merchant.address,
  protocol: 'NR1',
  reasonCode: 'POLICY_ACCEPTED',
  type: 'RESOLUTION',
}

describe('NR1 resolution protocol', () => {
  it('builds stable exact resolution bytes', () => {
    expect(buildResolutionMessage(payload)).toBe(
      `NIMRETURN/1/RESOLUTION\n{"approvedRefundLuna":500000,"claimId":"bC2v2Ws4EkuJNV0ydOduaw","createdAt":1789480800000,"decision":"APPROVED","nonce":"08EM9S-s91GdvhSUTkRr6w","note":"Approved under return policy","policySignerAddress":"${merchant.address}","protocol":"NR1","reasonCode":"POLICY_ACCEPTED","type":"RESOLUTION"}`,
    )
  })

  it('enforces approved/rejected refund shapes', () => {
    expect(() => resolutionPayloadSchema.parse({ ...payload, approvedRefundLuna: 0 })).toThrow(/positive/iu)
    expect(() => resolutionPayloadSchema.parse({
      ...payload,
      decision: 'REJECTED',
      approvedRefundLuna: 1,
    })).toThrow(/cannot approve/iu)
    expect(resolutionPayloadSchema.parse({
      ...payload,
      approvedRefundLuna: 0,
      decision: 'REJECTED',
      reasonCode: 'POLICY_NOT_APPLICABLE',
    })).toBeDefined()
  })

  it('accepts only the established policy signer and exact challenge', () => {
    const message = buildResolutionMessage(payload)
    const challenge = {
      canonicalMessage: message,
      consumedAt: null,
      expectedSignerAddress: merchant.address,
      expiresAt: new Date(NOW.getTime() + 60_000),
      payload,
      payloadHash: hashProtocolPayload(message),
    }
    const proof = (selected = merchant) => ({
      canonicalMessage: message,
      payloadHash: hashProtocolPayload(message),
      publicKey: selected.publicKey,
      signature: selected.sign(message),
    })
    expect(verifyResolutionProof({ challenge, now: NOW, proof: proof() }))
      .toMatchObject({ actualSignerAddress: merchant.address, valid: true })
    expect(verifyResolutionProof({ challenge, now: NOW, proof: proof(other) }))
      .toMatchObject({ code: 'SIGNER_MISMATCH', valid: false })
    expect(verifyResolutionProof({
      challenge,
      now: NOW,
      proof: { ...proof(), canonicalMessage: `${message} ` },
    })).toMatchObject({ code: 'MESSAGE_MISMATCH', valid: false })
  })
})
