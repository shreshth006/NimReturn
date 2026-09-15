import { describe, expect, it } from 'vitest'

import {
  clearRefundSession,
  loadRefundSession,
  saveRefundSession,
} from '../../src/features/refunds/refund-session.js'

const CLAIM_ID = 'AAAAAAAAAAAAAAAAAAAAAA'
const ATTEMPT_ID = 'BBBBBBBBBBBBBBBBBBBBBB'
const HASH = 'ab'.repeat(32)
const KEY = 'nimreturn.phase4.refund.v1'

function memoryStorage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    removeItem: (key: string) => { values.delete(key) },
    setItem: (key: string, value: string) => { values.set(key, value) },
  }
}

describe('refund reload recovery', () => {
  it('stores only public attempt/claim identifiers and an optional public hash', () => {
    const storage = memoryStorage()
    expect(saveRefundSession({ attemptPublicId: ATTEMPT_ID, claimPublicId: CLAIM_ID, transactionHash: HASH }, storage)).toBe(true)
    expect(loadRefundSession(CLAIM_ID, storage)).toEqual({ attemptPublicId: ATTEMPT_ID, claimPublicId: CLAIM_ID, transactionHash: HASH })
    const raw = storage.getItem(KEY)
    expect(raw).not.toContain('sender')
    expect(raw).not.toContain('seed')
    expect(raw).not.toContain('signature')
  })

  it('rejects cross-claim and injected recovery state', () => {
    const storage = memoryStorage()
    saveRefundSession({ attemptPublicId: ATTEMPT_ID, claimPublicId: CLAIM_ID }, storage)
    expect(loadRefundSession('CCCCCCCCCCCCCCCCCCCCCC', storage)).toBeNull()
    storage.setItem(KEY, JSON.stringify({ attemptPublicId: ATTEMPT_ID, claimPublicId: CLAIM_ID, sender: 'claimed' }))
    expect(loadRefundSession(CLAIM_ID, storage)).toBeNull()
  })

  it('clears the pointer without changing server evidence', () => {
    const storage = memoryStorage()
    saveRefundSession({ attemptPublicId: ATTEMPT_ID, claimPublicId: CLAIM_ID }, storage)
    expect(clearRefundSession(storage)).toBe(true)
    expect(loadRefundSession(CLAIM_ID, storage)).toBeNull()
  })
})
