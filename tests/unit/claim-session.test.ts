import { describe, expect, it } from 'vitest'

import {
  clearClaimSession,
  loadClaimSession,
  saveClaimSession,
} from '../../src/features/claims/claim-session.js'

const PASSPORT_ID = 'AAAAAAAAAAAAAAAAAAAAAA'
const CLAIM_ID = 'BBBBBBBBBBBBBBBBBBBBBB'
const STORAGE_KEY = 'nimreturn.phase3.claim.v1'

function memoryStorage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    removeItem: (key: string) => { values.delete(key) },
    setItem: (key: string, value: string) => { values.set(key, value) },
  }
}

describe('claim reload recovery', () => {
  it('stores only opaque public recovery identifiers', () => {
    const storage = memoryStorage()
    expect(saveClaimSession({ claimPublicId: CLAIM_ID, passportPublicId: PASSPORT_ID }, storage)).toBe(true)
    expect(loadClaimSession(PASSPORT_ID, storage)).toEqual({
      claimPublicId: CLAIM_ID,
      passportPublicId: PASSPORT_ID,
    })
    const raw = storage.getItem(STORAGE_KEY)
    expect(raw).not.toContain('signature')
    expect(raw).not.toContain('sender')
    expect(raw).not.toContain('note')
  })

  it('fails closed for another passport or injected fields', () => {
    const storage = memoryStorage()
    saveClaimSession({ claimPublicId: CLAIM_ID, passportPublicId: PASSPORT_ID }, storage)
    expect(loadClaimSession('CCCCCCCCCCCCCCCCCCCCCC', storage)).toBeNull()
    storage.setItem(STORAGE_KEY, JSON.stringify({
      claimPublicId: CLAIM_ID,
      passportPublicId: PASSPORT_ID,
      signerAddress: 'client-claimed',
    }))
    expect(loadClaimSession(PASSPORT_ID, storage)).toBeNull()
  })

  it('clears the pointer without touching server evidence', () => {
    const storage = memoryStorage()
    saveClaimSession({ claimPublicId: CLAIM_ID, passportPublicId: PASSPORT_ID }, storage)
    expect(clearClaimSession(storage)).toBe(true)
    expect(loadClaimSession(PASSPORT_ID, storage)).toBeNull()
  })
})
