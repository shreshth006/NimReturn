import { Address, Hash, PublicKey, Signature } from '@nimiq/core'

const PUBLIC_KEY_PATTERN = /^[0-9a-f]{64}$/u
const SIGNATURE_PATTERN = /^[0-9a-f]{128}$/u
const NIMIQ_SIGNED_MESSAGE_PREFIX = '\x16Nimiq Signed Message:\n'
const UTF8_ENCODER = new TextEncoder()

export interface NimiqSignatureProof {
  address: string
  message: string
  publicKey: string
  signature: string
}

export interface NimiqMessageSignatureProof {
  message: string
  publicKey: string
  signature: string
}

export interface NimiqMessageSignatureVerification {
  actualSignerAddress?: string
  error?: string
  payloadHash?: string
  signedMessageDigest?: string
  signatureValid: boolean
}

export interface NimiqSignatureVerification extends NimiqMessageSignatureVerification {
  addressMatches: boolean
  derivedAddress?: string
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

export function buildNimiqSignedMessagePreimage(message: string): Uint8Array {
  const messageBytes = UTF8_ENCODER.encode(message)
  const prefixAndLength = UTF8_ENCODER.encode(
    NIMIQ_SIGNED_MESSAGE_PREFIX + messageBytes.byteLength.toString(10),
  )
  const preimage = new Uint8Array(prefixAndLength.byteLength + messageBytes.byteLength)
  preimage.set(prefixAndLength)
  preimage.set(messageBytes, prefixAndLength.byteLength)
  return preimage
}

export function hashNimiqSignedMessage(message: string): Uint8Array {
  return Hash.computeSha256(buildNimiqSignedMessagePreimage(message))
}

export function hashProtocolPayload(message: string): string {
  return toHex(Hash.computeBlake2b(UTF8_ENCODER.encode(message)))
}

export function verifyNimiqMessageSignature(
  proof: NimiqMessageSignatureProof,
): NimiqMessageSignatureVerification {
  const publicKeyHex = proof.publicKey.toLowerCase()
  const signatureHex = proof.signature.toLowerCase()

  if (!PUBLIC_KEY_PATTERN.test(publicKeyHex)) {
    return {
      signatureValid: false,
      error: 'Public key must be exactly 32 bytes of hexadecimal data.',
    }
  }
  if (!SIGNATURE_PATTERN.test(signatureHex)) {
    return {
      signatureValid: false,
      error: 'Signature must be exactly 64 bytes of hexadecimal data.',
    }
  }

  let publicKey: PublicKey | undefined
  let signature: Signature | undefined
  let derivedAddress: Address | undefined

  try {
    publicKey = PublicKey.fromHex(publicKeyHex)
    signature = Signature.fromHex(signatureHex)
    derivedAddress = publicKey.toAddress()

    const messageBytes = UTF8_ENCODER.encode(proof.message)
    const signedMessageDigest = hashNimiqSignedMessage(proof.message)
    const signatureValid = publicKey.verify(signature, signedMessageDigest)

    return {
      signatureValid,
      actualSignerAddress: derivedAddress.toUserFriendlyAddress(),
      payloadHash: toHex(Hash.computeBlake2b(messageBytes)),
      signedMessageDigest: toHex(signedMessageDigest),
    }
  } catch {
    return {
      signatureValid: false,
      error: 'The signature proof contains an invalid Nimiq value.',
    }
  } finally {
    derivedAddress?.free()
    signature?.free()
    publicKey?.free()
  }
}

export function verifyNimiqSignature(
  proof: NimiqSignatureProof,
): NimiqSignatureVerification {
  const messageVerification = verifyNimiqMessageSignature(proof)
  if (!messageVerification.actualSignerAddress) {
    return {
      ...messageVerification,
      valid: false,
      signatureValid: false,
      addressMatches: false,
    }
  }

  let claimedAddress: Address | undefined
  let derivedAddress: Address | undefined

  try {
    claimedAddress = Address.fromString(proof.address)
    derivedAddress = Address.fromString(messageVerification.actualSignerAddress)
    const addressMatches = derivedAddress.equals(claimedAddress)
    return {
      ...messageVerification,
      valid: messageVerification.signatureValid && addressMatches,
      addressMatches,
      derivedAddress: messageVerification.actualSignerAddress,
    }
  } catch {
    return {
      ...messageVerification,
      valid: false,
      addressMatches: false,
      error: 'The signature proof contains an invalid Nimiq value.',
    }
  } finally {
    derivedAddress?.free()
    claimedAddress?.free()
  }
}
