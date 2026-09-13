import { Address, Hash, PublicKey, Signature } from '@nimiq/core'

const PUBLIC_KEY_PATTERN = /^[0-9a-f]{64}$/u
const SIGNATURE_PATTERN = /^[0-9a-f]{128}$/u

export interface NimiqSignatureProof {
  address: string
  message: string
  publicKey: string
  signature: string
}

export interface NimiqSignatureVerification {
  addressMatches: boolean
  derivedAddress?: string
  error?: string
  payloadHash?: string
  signatureValid: boolean
  valid: boolean
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function normalizeNimiqAddress(value: string): string {
  const address = Address.fromString(value.trim())
  try {
    return address.toUserFriendlyAddress().replaceAll(' ', '').toUpperCase()
  } finally {
    address.free()
  }
}

export function hashSignedMessage(message: string): string {
  return toHex(Hash.computeBlake2b(new TextEncoder().encode(message)))
}

export function verifyNimiqSignature(
  proof: NimiqSignatureProof,
): NimiqSignatureVerification {
  const publicKeyHex = proof.publicKey.toLowerCase()
  const signatureHex = proof.signature.toLowerCase()

  if (!PUBLIC_KEY_PATTERN.test(publicKeyHex)) {
    return {
      valid: false,
      signatureValid: false,
      addressMatches: false,
      error: 'Public key must be exactly 32 bytes of hexadecimal data.',
    }
  }
  if (!SIGNATURE_PATTERN.test(signatureHex)) {
    return {
      valid: false,
      signatureValid: false,
      addressMatches: false,
      error: 'Signature must be exactly 64 bytes of hexadecimal data.',
    }
  }

  let publicKey: PublicKey | undefined
  let signature: Signature | undefined
  let claimedAddress: Address | undefined
  let derivedAddress: Address | undefined

  try {
    publicKey = PublicKey.fromHex(publicKeyHex)
    signature = Signature.fromHex(signatureHex)
    claimedAddress = Address.fromString(proof.address)
    derivedAddress = publicKey.toAddress()

    const bytes = new TextEncoder().encode(proof.message)
    const signatureValid = publicKey.verify(signature, bytes)
    const addressMatches = derivedAddress.equals(claimedAddress)

    return {
      valid: signatureValid && addressMatches,
      signatureValid,
      addressMatches,
      derivedAddress: derivedAddress.toUserFriendlyAddress(),
      payloadHash: toHex(Hash.computeBlake2b(bytes)),
    }
  } catch {
    return {
      valid: false,
      signatureValid: false,
      addressMatches: false,
      error: 'The signature proof contains an invalid Nimiq value.',
    }
  } finally {
    derivedAddress?.free()
    claimedAddress?.free()
    signature?.free()
    publicKey?.free()
  }
}
