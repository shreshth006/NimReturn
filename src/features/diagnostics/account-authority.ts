import type { SignatureResult } from '@nimiq/mini-app-sdk'

import type { DiagnosticSignerVerification } from './signer-identity.js'

export interface AccountAuthorityState {
  accounts: string[]
  expectedAccount: string
  signature: SignatureResult | null
  signatureVerification: DiagnosticSignerVerification | null
}

export type AccountAuthorityAction =
  | { type: 'expectation-changed'; expectedAccount: string }
  | { type: 'permission-failed' | 'permission-requested' }
  | { type: 'permission-granted'; accounts: string[] }
  | {
      type: 'signature-received'
      signature: SignatureResult
      verification: DiagnosticSignerVerification
    }
  | { type: 'signature-cleared' }

export function emptyAccountAuthority(): AccountAuthorityState {
  return {
    accounts: [],
    expectedAccount: '',
    signature: null,
    signatureVerification: null,
  }
}

export function accountAuthorityReducer(
  state: AccountAuthorityState,
  action: AccountAuthorityAction,
): AccountAuthorityState {
  switch (action.type) {
    case 'permission-requested':
    case 'permission-failed':
      return emptyAccountAuthority()
    case 'permission-granted':
      return {
        accounts: [...action.accounts],
        expectedAccount: action.accounts[0] ?? '',
        signature: null,
        signatureVerification: null,
      }
    case 'expectation-changed':
      return {
        ...state,
        expectedAccount: action.expectedAccount,
        signature: null,
        signatureVerification: null,
      }
    case 'signature-received':
      return {
        ...state,
        signature: action.signature,
        signatureVerification: action.verification,
      }
    case 'signature-cleared':
      return {
        ...state,
        signature: null,
        signatureVerification: null,
      }
  }
}

export function hasAccountAuthority(state: AccountAuthorityState): boolean {
  return state.accounts.length > 0 && state.expectedAccount.length > 0
}
