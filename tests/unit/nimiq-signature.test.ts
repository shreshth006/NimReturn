import { Hash, KeyPair, PrivateKey } from '@nimiq/core'
import { describe, expect, it } from 'vitest'

import {
  buildNimiqSignedMessagePreimage,
  hashProtocolPayload,
  normalizeNimiqAddress,
  verifyNimiqSignature,
} from '../../src/lib/crypto/nimiq-signature.js'
import { buildProtocolMessage, type CanonicalJsonObject } from '../../src/lib/protocol/canonical-json.js'

const PRIVATE_KEY_A = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f'
const PRIVATE_KEY_B = '1f1e1d1c1b1a191817161514131211100f0e0d0c0b0a09080706050403020100'
const NIMIQ_SIGNED_MESSAGE_PREFIX = '\x16Nimiq Signed Message:\n'
const UTF8_ENCODER = new TextEncoder()

function concatenate(left: Uint8Array, right: Uint8Array): Uint8Array {
  const result = new Uint8Array(left.byteLength + right.byteLength)
  result.set(left)
  result.set(right, left.byteLength)
  return result
}

function signingDigest(message: string): Uint8Array {
  const messageBytes = UTF8_ENCODER.encode(message)
  const prefixAndLength = UTF8_ENCODER.encode(
    NIMIQ_SIGNED_MESSAGE_PREFIX + messageBytes.byteLength.toString(10),
  )
  return Hash.computeSha256(concatenate(prefixAndLength, messageBytes))
}

function createFixture(privateKeyHex: string, message: string, raw = false) {
  const privateKey = PrivateKey.fromHex(privateKeyHex)
  const keyPair = KeyPair.derive(privateKey)
  const signature = keyPair.sign(raw ? UTF8_ENCODER.encode(message) : signingDigest(message))
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

  it('verifies a framed message and its public-key/address binding', () => {
    const result = verifyNimiqSignature({ ...fixture, message })
    expect(result).toMatchObject({ valid: true, signatureValid: true, addressMatches: true })
    expect(result.payloadHash).toBe(hashProtocolPayload(message))
    expect(result.signedMessageDigest).toHaveLength(64)
    expect(normalizeNimiqAddress(fixture.address)).toMatch(/^NQ[A-Z0-9]{34}$/u)
  })

  it('rejects a different message', () => {
    const result = verifyNimiqSignature({ ...fixture, message: message + ' ' })
    expect(result.valid).toBe(false)
    expect(result.signatureValid).toBe(false)
    expect(result.addressMatches).toBe(true)
  })

  it('rejects a single-byte message mutation', () => {
    const mutatedMessage = message.replace('Wireless Mouse', 'Wireless Moure')
    expect(UTF8_ENCODER.encode(mutatedMessage)).toHaveLength(
      UTF8_ENCODER.encode(message).byteLength,
    )
    expect(verifyNimiqSignature({ ...fixture, message: mutatedMessage }).valid).toBe(false)
  })

  it('rejects a valid signature paired with the wrong public key', () => {
    const other = createFixture(PRIVATE_KEY_B, message)
    const result = verifyNimiqSignature({
      ...fixture,
      address: other.address,
      message,
      publicKey: other.publicKey,
    })
    expect(result).toMatchObject({ valid: false, signatureValid: false, addressMatches: true })
  })

  it('rejects a valid proof bound to a different claimed address', () => {
    const other = createFixture(PRIVATE_KEY_B, message)
    const result = verifyNimiqSignature({ ...fixture, address: other.address, message })
    expect(result.valid).toBe(false)
    expect(result.signatureValid).toBe(true)
    expect(result.addressMatches).toBe(false)
  })

  it('rejects malformed public keys and signatures without throwing', () => {
    expect(verifyNimiqSignature({ ...fixture, message, publicKey: '00' })).toMatchObject({
      valid: false,
      signatureValid: false,
    })
    expect(verifyNimiqSignature({ ...fixture, message, signature: 'gg' })).toMatchObject({
      valid: false,
      signatureValid: false,
    })

    const changedByte = fixture.signature.startsWith('00') ? '01' : '00'
    const tamperedSignature = changedByte + fixture.signature.slice(2)
    expect(verifyNimiqSignature({ ...fixture, message, signature: tamperedSignature }).valid)
      .toBe(false)
  })

  it('uses the UTF-8 byte length in the signed-message frame', () => {
    const unicodeMessage = 'NIMRETURN/1/DIAGNOSTIC\n{"value":"✓ café"}'
    const messageBytes = UTF8_ENCODER.encode(unicodeMessage)
    const preimage = buildNimiqSignedMessagePreimage(unicodeMessage)
    const expectedHeader = UTF8_ENCODER.encode(
      NIMIQ_SIGNED_MESSAGE_PREFIX + messageBytes.byteLength.toString(10),
    )

    expect(preimage.slice(0, expectedHeader.byteLength)).toEqual(expectedHeader)
    expect(preimage.slice(expectedHeader.byteLength)).toEqual(messageBytes)
    const unicodeFixture = createFixture(PRIVATE_KEY_A, unicodeMessage)
    expect(verifyNimiqSignature({ ...unicodeFixture, message: unicodeMessage }).valid).toBe(true)
  })

  it('does not accept a raw-message Ed25519 signature as a fallback', () => {
    const rawFixture = createFixture(PRIVATE_KEY_A, message, true)
    const result = verifyNimiqSignature({ ...rawFixture, message })
    expect(result).toMatchObject({ valid: false, signatureValid: false, addressMatches: true })
  })

  it('keeps the NR1 BLAKE2b payload hash unchanged', () => {
    const stableMessage = 'NIMRETURN/1/POLICY\n{"protocol":"NR1","type":"POLICY"}'
    expect(hashProtocolPayload(stableMessage)).toBe(
      '3c2bdfcdc42cff6de4c0fc2f17d392e0e15c04a2a6acc3915b825aa8ef6c5d4e',
    )
  })
})
