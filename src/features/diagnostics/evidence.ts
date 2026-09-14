import type { SignatureResult } from '@nimiq/mini-app-sdk'

import type { ProviderNetworkSnapshot } from '../../lib/nimiq/provider.js'
import {
  extractRpcObservedEvidence,
  type RpcVerificationState,
} from './rpc-verification.js'
import type { DiagnosticSignerVerification } from './signer-identity.js'
import type { PhaseZeroSentTransaction } from './transaction-record.js'

export interface PhaseZeroEvidenceInput {
  capturedAtUtc: string
  device: {
    nimiqPayVersion: string
    osVersion: string
    platform: string
    userAgent: string
  }
  listedAccounts: string[]
  network: ProviderNetworkSnapshot | null
  networkCheckedAtUtc: string | null
  providerAvailable: boolean
  rpcResult: unknown
  rpcVerification: RpcVerificationState
  expectedAccount: string
  signature: SignatureResult | null
  signatureMessage: string
  signatureVerification: DiagnosticSignerVerification | null
  transaction: PhaseZeroSentTransaction | null
}

function utf8ToHex(value: string): string {
  return Array.from(
    new TextEncoder().encode(value),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('')
}

export function buildPhaseZeroEvidence(input: PhaseZeroEvidenceInput): object {
  const rpc = extractRpcObservedEvidence(
    input.rpcResult,
    input.transaction?.walletAccounts ?? input.listedAccounts,
  )

  return {
    format: 'nimreturn.phase0.evidence.v2',
    capturedAtUtc: input.capturedAtUtc,
    versions: {
      miniAppSdk: '0.1.0',
      nimiqCore: '2.21.0',
      protocol: 'NR1-candidate',
    },
    device: {
      nimiqPayVersion: input.device.nimiqPayVersion || null,
      osVersion: input.device.osVersion || null,
      platform: input.device.platform || null,
      userAgent: input.device.userAgent,
    },
    provider: {
      available: input.providerAvailable,
    },
    wallet: {
      listedAccounts: input.listedAccounts,
    },
    network: input.network
      ? {
          blockNumber: input.network.blockNumber,
          consensus: input.network.consensus,
          lastCheckedAtUtc: input.networkCheckedAtUtc,
        }
      : null,
    signature: input.signature && input.signatureVerification
      ? {
          expectedAccount: input.expectedAccount || null,
          actualSignerAddress: input.signatureVerification.actualSignerAddress,
          signerIsListedAccount: input.signatureVerification.signerIsListedAccount,
          expectedMatchesSigner: input.signatureVerification.expectedMatchesSigner,
          message: input.signatureMessage,
          messageUtf8Hex: utf8ToHex(input.signatureMessage),
          publicKey: input.signature.publicKey,
          signature: input.signature.signature,
          signatureValid: input.signatureVerification.signatureValid,
          addressBindingValid: input.signatureVerification.addressBindingValid,
          signedMessageDigest: input.signatureVerification.signedMessageDigest,
          nr1PayloadHash: input.signatureVerification.payloadHash,
        }
      : null,
    transaction: input.transaction
      ? {
          hash: input.transaction.hash,
          recipient: input.transaction.recipient,
          valueLuna: input.transaction.valueLuna,
          data: input.transaction.data,
          submittedAtUtc: input.transaction.submittedAtUtc,
          validityStartHeight: input.transaction.validityStartHeight,
          networkSnapshot: input.transaction.network,
          walletAccountsAtSubmission: input.transaction.walletAccounts,
        }
      : null,
    rpc: {
      observedSender: rpc?.observedSender ?? null,
      senderIsListedWalletAccount: rpc?.senderIsListedWalletAccount ?? false,
      observedRecipient: rpc?.observedRecipient ?? null,
      observedValueLuna: rpc?.observedValueLuna ?? null,
      observedData: rpc?.observedData ?? null,
      executionResult: rpc?.executionResult ?? null,
      inclusionBlock: rpc?.inclusionBlock ?? null,
      finalizingMacroBlock: rpc?.finalizingMacroBlock ?? null,
      headBlock: rpc?.headBlock ?? null,
      finalityReached: rpc?.finalityReached ?? null,
      outcome: input.rpcVerification.outcome,
      lastCheckedAtUtc: input.rpcVerification.lastCheckedAtUtc,
    },
  }
}
