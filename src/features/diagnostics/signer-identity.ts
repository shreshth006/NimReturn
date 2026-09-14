import type { SignatureResult } from '@nimiq/mini-app-sdk'

import {
  normalizeNimiqAddress,
  verifyNimiqMessageSignature,
  type NimiqMessageSignatureVerification,
} from '../../lib/crypto/nimiq-signature.js'

export interface DiagnosticSignerVerification extends NimiqMessageSignatureVerification {
  addressBindingValid: boolean
  expectedMatchesSigner: boolean
  signerIsListedAccount: boolean
  valid: boolean
}

function normalizedAddressMatches(first: string, second: string): boolean {
  try {
    return normalizeNimiqAddress(first) === normalizeNimiqAddress(second)
  } catch {
    return false
  }
}

export function verifyDiagnosticSigner(input: {
  expectedAccount: string
  listedAccounts: string[]
  message: string
  proof: SignatureResult
}): DiagnosticSignerVerification {
  const verification = verifyNimiqMessageSignature({
    message: input.message,
    publicKey: input.proof.publicKey,
    signature: input.proof.signature,
  })
  const actualSignerAddress = verification.actualSignerAddress
  const addressBindingValid = actualSignerAddress !== undefined
  const signerIsListedAccount =
    actualSignerAddress !== undefined &&
    input.listedAccounts.some((account) => normalizedAddressMatches(account, actualSignerAddress))
  const expectedMatchesSigner =
    actualSignerAddress !== undefined &&
    normalizedAddressMatches(input.expectedAccount, actualSignerAddress)

  return {
    ...verification,
    addressBindingValid,
    signerIsListedAccount,
    expectedMatchesSigner,
    valid: verification.signatureValid && signerIsListedAccount,
  }
}
