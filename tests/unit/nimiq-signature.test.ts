import { KeyPair, PrivateKey } from '@nimiq/core'
import { describe, expect, it } from 'vitest'

import {
  hashSignedMessage,
  normalizeNimiqAddress,
  verifyNimiqSignature,
} from '../../src/lib/crypto/nimiq-signature.js'
import { buildProtocolMessage, type CanonicalJsonObject } from '../../src/lib/protocol/canonical-json.js'

const PRIVATE_KEY_A = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f'
const PRIVATE_KEY_B = '1f1e1d1c1b1a191817161514131211100f0e0d0c0b0a09080706050403020100'

function createFixture(privateKeyHex: string, message: string) {
  const privateKey = PrivateKey.fromHex(privateKeyHex)
  const keyPair = KeyPair.derive(privateKey)
  const signature = keyPair.sign(new TextEncoder().encode(message))
  const address = keyPair.toAddress()

  try {
    return {
      address: address.toUserFriendlyAddress(),
      publicKey: keyPair.publicKey.toHex(),
      signature: signature.toHex(),
    }
  } finally {
    address.free()
    signature.free()
    keyPair.free()
    privateKey.free()
  }
}

describe('Nimiq signature verification', () => {
  const payload: CanonicalJsonObject = {
    createdAt: 1_789_335_000_000,
    merchantAddress: 'NQTESTFIXTURE',
    nonce: 'AAAAAAAAAAAAAAAAAAAAAA',
    policyId: 'BBBBBBBBBBBBBBBBBBBBBB',
    priceLuna: 500_000,
    productId: 'CCCCCCCCCCCCCCCCCCCCCC',
    productName: 'Wireless Mouse',
    protocol: 'NR1',
    returnWindowSeconds: 604_800,
    type: 'POLICY',
    version: 1,
    warrantyTransferAllowed: false,
    warrantyWindowSeconds: 7_776_000,
  }
  const message = buildProtocolMessage('POLICY', payload)
  const fixture = createFixture(PRIVATE_KEY_A, message)

  it('verifies a known exact message and its public-key/address binding', () => {
    const result = verifyNimiqSignature({ ...fixture, message })
    expect(result).toMatchObject({ valid: true, signatureValid: true, addressMatches: true })
    expect(result.payloadHash).toBe(hashSignedMessage(message))
    expect(normalizeNimiqAddress(fixture.address)).toMatch(/^NQ[A-Z0-9]{34}$/u)
  })

  it('rejects a tampered message', () => {
    const result = verifyNimiqSignature({ ...fixture, message: `${message} ` })
    expect(result.valid).toBe(false)
    expect(result.signatureValid).toBe(false)
    expect(result.addressMatches).toBe(true)
  })

  it('rejects a valid proof bound to a different claimed address', () => {
    const other = createFixture(PRIVATE_KEY_B, message)
    const result = verifyNimiqSignature({ ...fixture, address: other.address, message })
    expect(result.valid).toBe(false)
    expect(result.signatureValid).toBe(true)
    expect(result.addressMatches).toBe(false)
  })

  it('rejects malformed or tampered signature bytes without throwing', () => {
    expect(verifyNimiqSignature({ ...fixture, message, publicKey: '00' }).valid).toBe(false)
    const tamperedSignature = `${fixture.signature.slice(0, -2)}00`
    expect(verifyNimiqSignature({ ...fixture, message, signature: tamperedSignature }).valid).toBe(false)
  })
})
