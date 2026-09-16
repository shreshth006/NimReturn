import { hashProtocolPayload, normalizeNimiqAddress, verifyNimiqMessageSignature } from '../../lib/crypto/nimiq-signature.js'
import { claimProofEnvelopeSchema, type ClaimProofEnvelope } from '../../lib/protocol/claim.js'

export interface LocallyVerifiedClaimProof {
  proof: ClaimProofEnvelope
  signerAddress: string
}

// The server derives the signer itself; the locally derived address is display-only
// and must stay outside the strict proof envelope.
export function buildClaimProof(
  message: string,
  result: { publicKey: string; signature: string },
): LocallyVerifiedClaimProof {
  const publicKey = result.publicKey.toLowerCase()
  const signature = result.signature.toLowerCase()
  const verified = verifyNimiqMessageSignature({ message, publicKey, signature })
  if (!verified.signatureValid || !verified.actualSignerAddress) {
    throw new Error(verified.error ?? 'The wallet signature did not verify locally.')
  }
  const payloadHash = hashProtocolPayload(message)
  if (verified.payloadHash !== payloadHash) throw new Error('The wallet proof did not bind the exact claim bytes.')
  return {
    proof: claimProofEnvelopeSchema.parse({ canonicalMessage: message, payloadHash, publicKey, signature }),
    signerAddress: normalizeNimiqAddress(verified.actualSignerAddress),
  }
}
