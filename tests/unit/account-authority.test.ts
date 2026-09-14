import { describe, expect, it } from 'vitest'

import {
  accountAuthorityReducer,
  emptyAccountAuthority,
  hasAccountAuthority,
} from '../../src/features/diagnostics/account-authority.js'
import type { DiagnosticSignerVerification } from '../../src/features/diagnostics/signer-identity.js'

const firstAccount = 'NQ07 FIRST'
const secondAccount = 'NQ15 SECOND'
const accounts = [firstAccount, secondAccount]
const signature = { publicKey: 'ab'.repeat(32), signature: 'cd'.repeat(64) }
const verification: DiagnosticSignerVerification = {
  actualSignerAddress: firstAccount,
  addressBindingValid: true,
  expectedMatchesSigner: true,
  payloadHash: 'ef'.repeat(32),
  signedMessageDigest: '12'.repeat(32),
  signatureValid: true,
  signerIsListedAccount: true,
  valid: true,
}

function staleAuthority() {
  const connected = accountAuthorityReducer(emptyAccountAuthority(), {
    type: 'permission-granted',
    accounts,
  })
  return accountAuthorityReducer(connected, {
    type: 'signature-received',
    signature,
    verification,
  })
}

describe('diagnostic account authority state', () => {
  it('clears stale account and signature authority as soon as permission is requested again', () => {
    const state = accountAuthorityReducer(staleAuthority(), { type: 'permission-requested' })

    expect(state).toEqual(emptyAccountAuthority())
    expect(hasAccountAuthority(state)).toBe(false)
  })

  it('does not retain stale account or signature authority after rejection', () => {
    const state = accountAuthorityReducer(staleAuthority(), { type: 'permission-failed' })

    expect(state.accounts).toEqual([])
    expect(state.expectedAccount).toBe('')
    expect(state.signature).toBeNull()
    expect(state.signatureVerification).toBeNull()
    expect(hasAccountAuthority(state)).toBe(false)
  })

  it('allows a successful retry to repopulate accounts without restoring an old proof', () => {
    const cancelled = accountAuthorityReducer(staleAuthority(), { type: 'permission-failed' })
    const retried = accountAuthorityReducer(cancelled, { type: 'permission-granted', accounts })

    expect(retried).toEqual({
      accounts,
      expectedAccount: firstAccount,
      signature: null,
      signatureVerification: null,
    })
    expect(hasAccountAuthority(retried)).toBe(true)
  })

  it('changing only the expectation clears its proof without changing account authority', () => {
    const changed = accountAuthorityReducer(staleAuthority(), {
      type: 'expectation-changed',
      expectedAccount: secondAccount,
    })

    expect(changed.accounts).toEqual(accounts)
    expect(changed.expectedAccount).toBe(secondAccount)
    expect(changed.signature).toBeNull()
    expect(changed.signatureVerification).toBeNull()
    expect(hasAccountAuthority(changed)).toBe(true)
  })
})
