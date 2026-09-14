import type { SignatureResult } from '@nimiq/mini-app-sdk'

import type { NimiqSignatureVerification } from '../../lib/crypto/nimiq-signature.js'
import type { ProviderNetworkSnapshot } from '../../lib/nimiq/provider.js'

export interface PhaseZeroSentTransaction {
  data: string
  hash: string
  recipient: string
  sender: string
  valueLuna: number
}

export interface PhaseZeroEvidenceInput {
  capturedAtUtc: string
  network: ProviderNetworkSnapshot | null
  rpcResult: unknown
  selectedAccount: string
  signature: SignatureResult | null
  signatureMessage: string
  signatureVerification: NimiqSignatureVerification | null
  transaction: PhaseZeroSentTransaction | null
}

function utf8ToHex(value: string): string {
  return Array.from(
    new TextEncoder().encode(value),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('')
}

export function buildPhaseZeroEvidence(input: PhaseZeroEvidenceInput): object {
  return {
    format: 'nimreturn.phase0.evidence.v1',
    capturedAtUtc: input.capturedAtUtc,
    versions: {
      miniAppSdk: '0.1.0',
      nimiqCore: '2.21.0',
      protocol: 'NR1-candidate',
    },
    wallet: {
      selectedAccount: input.selectedAccount || null,
      network: input.network,
    },
    signature: input.signature && input.signatureVerification
      ? {
          message: input.signatureMessage,
          messageUtf8Hex: utf8ToHex(input.signatureMessage),
          publicKey: input.signature.publicKey,
          signature: input.signature.signature,
          verification: input.signatureVerification,
        }
      : null,
    transaction: input.transaction,
    independentRpcResult: input.rpcResult,
  }
}
