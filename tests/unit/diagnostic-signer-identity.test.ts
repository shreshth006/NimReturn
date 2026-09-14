import { Hash, KeyPair, PrivateKey } from '@nimiq/core'
import { describe, expect, it } from 'vitest'

import { verifyDiagnosticSigner } from '../../src/features/diagnostics/signer-identity.js'

const PRIVATE_KEY_A = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f'
const PRIVATE_KEY_B = '1f1e1d1c1b1a191817161514131211100f0e0d0c0b0a09080706050403020100'
const MESSAGE_PREFIX = new TextEncoder().encode('\x16Nimiq Signed Message:\n')
const ENCODER = new TextEncoder()

function fixture(privateKeyHex: string, message: string) {
  const privateKey = PrivateKey.fromHex(privateKeyHex)
  const keyPair = KeyPair.derive(privateKey)
  const messageBytes = ENCODER.encode(message)
  const lengthBytes = ENCODER.encode(messageBytes.byteLength.toString(10))
  const framed = new Uint8Array(MESSAGE_PREFIX.byteLength + lengthBytes.byteLength + messageBytes.byteLength)
  framed.set(MESSAGE_PREFIX)
  framed.set(lengthBytes, MESSAGE_PREFIX.byteLength)
  framed.set(messageBytes, MESSAGE_PREFIX.byteLength + lengthBytes.byteLength)
  const signature = keyPair.sign(Hash.computeSha256(framed))
  const address = keyPair.toAddress()

  try {
    return {
      address: address.toUserFriendlyAddress(),
      proof: {
        publicKey: keyPair.publicKey.toHex(),
        signature: signature.toHex(),
      },
    }
  } finally {
    address.free()
    signature.free()
    keyPair.free()
    privateKey.free()
  }
}

describe('Phase 0 diagnostic signer identity', () => {
  const message = 'NIMRETURN/P0/DIAGNOSTIC\n{"expectedSigner":"NQ...","nonce":"test"}'
  const signer = fixture(PRIVATE_KEY_A, message)
  const other = fixture(PRIVATE_KEY_B, message)

  it('derives the actual signer and accepts it when the wallet listed it', () => {
    const result = verifyDiagnosticSigner({
      expectedAccount: signer.address,
      listedAccounts: [signer.address, other.address],
      message,
      proof: signer.proof,
    })
    expect(result).toMatchObject({
      actualSignerAddress: signer.address,
      addressBindingValid: true,
      expectedMatchesSigner: true,
      signatureValid: true,
      signerIsListedAccount: true,
      valid: true,
    })
  })

  it('keeps a signature valid when the diagnostic expectation differs', () => {
    const result = verifyDiagnosticSigner({
      expectedAccount: other.address,
      listedAccounts: [signer.address, other.address],
      message,
      proof: signer.proof,
    })
    expect(result).toMatchObject({
      actualSignerAddress: signer.address,
      expectedMatchesSigner: false,
      signatureValid: true,
      signerIsListedAccount: true,
      valid: true,
    })
  })

  it('flags a valid signer that is absent from the approved account list', () => {
    const result = verifyDiagnosticSigner({
      expectedAccount: other.address,
      listedAccounts: [other.address],
      message,
      proof: signer.proof,
    })
    expect(result).toMatchObject({
      expectedMatchesSigner: false,
      signatureValid: true,
      signerIsListedAccount: false,
      valid: false,
    })
  })

  it('rejects a malformed signature', () => {
    const result = verifyDiagnosticSigner({
      expectedAccount: signer.address,
      listedAccounts: [signer.address],
      message,
      proof: { ...signer.proof, signature: '00' },
    })
    expect(result).toMatchObject({
      addressBindingValid: false,
      signatureValid: false,
      signerIsListedAccount: false,
      valid: false,
    })
  })
})
