import { KeyPair, PrivateKey } from '@nimiq/core'
import { describe, expect, it } from 'vitest'

import {
  buildPolicyMessage,
  MAX_POLICY_WINDOW_SECONDS,
  parsePolicyPayload,
  policyProofEnvelopeSchema,
  type PolicyPayload,
} from '../../src/lib/protocol/policy.js'

const PRIVATE_KEY = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f'

function fixtureAddress(): { canonical: string; formatted: string } {
  const privateKey = PrivateKey.fromHex(PRIVATE_KEY)
  const keyPair = KeyPair.derive(privateKey)
  const address = keyPair.toAddress()
  try {
    return {
      canonical: address.toUserFriendlyAddress().replaceAll(' ', '').toUpperCase(),
      formatted: address.toUserFriendlyAddress(),
    }
  } finally {
    address.free()
    keyPair.free()
    privateKey.free()
  }
}

const address = fixtureAddress()
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
  settlementAddress: address.canonical,
  type: 'POLICY',
  version: 1,
  warrantyTransferAllowed: false,
  warrantyWindowSeconds: 7_776_000,
}

describe('NR1 policy payload', () => {
  it('builds the exact domain-separated canonical policy message', () => {
    expect(buildPolicyMessage(payload)).toBe(
      `NIMRETURN/1/POLICY\n{"createdAt":1789335000000,"merchantId":"mL7n2psWQfTx9Vj3aBcDeA","nonce":"q83Jqsl5-8Y4LtxjYOLmVA","policyId":"YF4gIYhmXuGXNNDv2wO8nQ","priceLuna":500000,"productId":"uWzZJsbCx96gQkB6Mb0Xlg","productName":"Wireless Mouse","protocol":"NR1","returnWindowSeconds":604800,"settlementAddress":"${address.canonical}","type":"POLICY","version":1,"warrantyTransferAllowed":false,"warrantyWindowSeconds":7776000}`,
    )
  })

  it('accepts a canonical settlement address without requiring a signer field', () => {
    expect(parsePolicyPayload(payload).settlementAddress).toBe(address.canonical)
    expect(() => parsePolicyPayload({ ...payload, policySignerAddress: address.canonical }))
      .toThrow(/unrecognized key/iu)
  })

  it('rejects non-canonical or invalid settlement addresses', () => {
    expect(() => parsePolicyPayload({ ...payload, settlementAddress: address.formatted }))
      .toThrow(/canonical no-space uppercase/u)
    expect(() => parsePolicyPayload({ ...payload, settlementAddress: 'NQINVALID' }))
      .toThrow(/valid Nimiq address/u)
  })

  it.each([
    ['zero', 0],
    ['negative', -1],
    ['fractional', 1.5],
    ['unsafe', Number.MAX_SAFE_INTEGER + 1],
  ])('rejects %s Luna values', (_label, priceLuna) => {
    expect(() => parsePolicyPayload({ ...payload, priceLuna })).toThrow()
  })

  it('enforces policy-window integer boundaries', () => {
    expect(parsePolicyPayload({
      ...payload,
      returnWindowSeconds: 0,
      warrantyWindowSeconds: MAX_POLICY_WINDOW_SECONDS,
    })).toBeDefined()
    expect(() => parsePolicyPayload({
      ...payload,
      returnWindowSeconds: MAX_POLICY_WINDOW_SECONDS + 1,
    })).toThrow()
    expect(() => parsePolicyPayload({ ...payload, returnWindowSeconds: 0.5 })).toThrow()
  })

  it.each([
    ['leading whitespace', ' Wireless Mouse'],
    ['decomposed Unicode', 'Cafe\u0301'],
    ['control character', 'Wireless\nMouse'],
    ['too many code points', 'x'.repeat(101)],
    ['too many UTF-8 bytes', '😀'.repeat(65)],
  ])('rejects product names with %s', (_label, productName) => {
    expect(() => parsePolicyPayload({ ...payload, productName })).toThrow()
  })

  it('rejects malformed identifiers and extra properties', () => {
    expect(() => parsePolicyPayload({ ...payload, nonce: 'short' })).toThrow()
    expect(() => parsePolicyPayload({ ...payload, surprise: true })).toThrow(/unrecognized key/iu)
  })

  it('strictly validates the public proof envelope', () => {
    const proof = {
      canonicalMessage: buildPolicyMessage(payload),
      payloadHash: 'ab'.repeat(32),
      publicKey: 'cd'.repeat(32),
      signature: 'ef'.repeat(64),
    }
    expect(policyProofEnvelopeSchema.parse(proof)).toEqual(proof)
    expect(() => policyProofEnvelopeSchema.parse({ ...proof, payloadHash: 'AB'.repeat(32) }))
      .toThrow()
    expect(() => policyProofEnvelopeSchema.parse({ ...proof, address: address.canonical }))
      .toThrow(/unrecognized key/iu)
  })
})
