import { KeyPair, PrivateKey } from '@nimiq/core'
import { describe, expect, it } from 'vitest'

import {
  buildClaimAuthorizationMessage,
  buildClaimMessage,
  claimAuthorizationPayloadSchema,
  claimPayloadSchema,
  type ClaimAuthorizationPayload,
  type ClaimPayload,
} from '../../src/lib/protocol/claim.js'

function address(): string {
  const privateKey = PrivateKey.fromHex('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f')
  const keyPair = KeyPair.derive(privateKey)
  const derived = keyPair.toAddress()
  try {
    return derived.toUserFriendlyAddress().replaceAll(' ', '').toUpperCase()
  } finally {
    derived.free()
    keyPair.free()
    privateKey.free()
  }
}

const purchaseSenderAddress = address()
const claim: ClaimPayload = {
  claimId: 'bC2v2Ws4EkuJNV0ydOduaw',
  claimType: 'RETURN',
  createdAt: 1_789_336_000_000,
  nonce: 'L2tiVv4suxPEkzpW3QW8xw',
  note: 'Scroll wheel is intermittent',
  orderId: 'Nv2eFQ1dKby8j1h4PV4-4g',
  protocol: 'NR1',
  purchaseSenderAddress,
  reasonCode: 'DEFECTIVE',
  type: 'CLAIM',
}

const authorization: ClaimAuthorizationPayload = {
  authorizationId: '3vM8xK7JjqwYsHhd6b2yVQ',
  claimId: claim.claimId,
  claimPayloadHash: 'ab'.repeat(32),
  claimSignerAddress: purchaseSenderAddress,
  createdAt: 1_789_336_100_000,
  expiresAt: 1_789_336_700_000,
  nonce: 'Z2dT3L9Vj9Q3nUeM6u7x4A',
  protocol: 'NR1',
  purchaseSenderAddress,
  type: 'CLAIM_AUTHORIZATION',
}

describe('NR1 claim payloads', () => {
  it('builds stable domain-separated claim bytes', () => {
    expect(buildClaimMessage(claim)).toBe(
      `NIMRETURN/1/CLAIM\n{"claimId":"bC2v2Ws4EkuJNV0ydOduaw","claimType":"RETURN","createdAt":1789336000000,"nonce":"L2tiVv4suxPEkzpW3QW8xw","note":"Scroll wheel is intermittent","orderId":"Nv2eFQ1dKby8j1h4PV4-4g","protocol":"NR1","purchaseSenderAddress":"${purchaseSenderAddress}","reasonCode":"DEFECTIVE","type":"CLAIM"}`,
    )
  })

  it('builds stable exact-claim authorization bytes', () => {
    expect(buildClaimAuthorizationMessage(authorization)).toBe(
      `NIMRETURN/1/CLAIM_AUTHORIZATION\n{"authorizationId":"3vM8xK7JjqwYsHhd6b2yVQ","claimId":"bC2v2Ws4EkuJNV0ydOduaw","claimPayloadHash":"${'ab'.repeat(32)}","claimSignerAddress":"${purchaseSenderAddress}","createdAt":1789336100000,"expiresAt":1789336700000,"nonce":"Z2dT3L9Vj9Q3nUeM6u7x4A","protocol":"NR1","purchaseSenderAddress":"${purchaseSenderAddress}","type":"CLAIM_AUTHORIZATION"}`,
    )
  })

  it('rejects unbounded, non-normalized, and extra claim content', () => {
    expect(() => claimPayloadSchema.parse({ ...claim, note: ' x' })).toThrow(/trimmed/iu)
    expect(() => claimPayloadSchema.parse({ ...claim, note: 'x'.repeat(281) })).toThrow(/280/iu)
    expect(() => claimPayloadSchema.parse({ ...claim, reasonCode: 'FREE_TEXT' })).toThrow()
    expect(() => claimPayloadSchema.parse({ ...claim, sender: purchaseSenderAddress })).toThrow(/unrecognized key/iu)
  })

  it('requires a forward authorization expiry and canonical addresses', () => {
    expect(() => claimAuthorizationPayloadSchema.parse({
      ...authorization,
      expiresAt: authorization.createdAt,
    })).toThrow(/expiry/iu)
    expect(() => claimAuthorizationPayloadSchema.parse({
      ...authorization,
      purchaseSenderAddress: purchaseSenderAddress.toLowerCase(),
    })).toThrow(/canonical|valid Nimiq/iu)
  })
})
