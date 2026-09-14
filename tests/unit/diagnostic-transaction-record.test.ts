import { KeyPair, PrivateKey } from '@nimiq/core'
import { describe, expect, it } from 'vitest'

import {
  DEFAULT_DIAGNOSTIC_VALUE_LUNA,
  PHASE_ZERO_TRANSACTION_STORAGE_KEY,
  clearPhaseZeroPaymentRecord,
  createSubmittedTransaction,
  createUnknownSubmission,
  isDiagnosticPaymentLocked,
  loadPhaseZeroPaymentRecord,
  persistPhaseZeroPaymentRecord,
  requiresClearConfirmation,
  submittedTransactionFromRecord,
} from '../../src/features/diagnostics/transaction-record.js'

class MemoryStorage {
  readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  removeItem(key: string): void {
    this.values.delete(key)
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

function addressFromPrivateKey(hex: string): string {
  const privateKey = PrivateKey.fromHex(hex)
  const keyPair = KeyPair.derive(privateKey)
  const address = keyPair.toAddress()
  try {
    return address.toUserFriendlyAddress()
  } finally {
    address.free()
    keyPair.free()
    privateKey.free()
  }
}

const sender = addressFromPrivateKey('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f')
const recipient = addressFromPrivateKey('1f1e1d1c1b1a191817161514131211100f0e0d0c0b0a09080706050403020100')
const context = {
  data: 'NR1:P:AAAAAAAAAAAAAAAAAAAAAA',
  network: { blockNumber: 123, consensus: true } as const,
  recipient,
  submittedAtUtc: '2026-09-14T10:00:00.000Z',
  validityStartHeight: 123,
  valueLuna: DEFAULT_DIAGNOSTIC_VALUE_LUNA,
  walletAccounts: [sender],
}

describe('Phase 0 diagnostic transaction persistence', () => {
  it('uses the visible nonzero 1000-Luna diagnostic default without changing integer units', () => {
    expect(DEFAULT_DIAGNOSTIC_VALUE_LUNA).toBe(1_000)
    expect(Number.isSafeInteger(DEFAULT_DIAGNOSTIC_VALUE_LUNA)).toBe(true)
  })

  it('persists a returned hash and restores verification context after reload', () => {
    const storage = new MemoryStorage()
    const submitted = createSubmittedTransaction({ ...context, hash: 'ab'.repeat(32) })

    expect(persistPhaseZeroPaymentRecord(submitted, storage)).toBe(true)
    const restored = loadPhaseZeroPaymentRecord(storage)

    expect(restored).toEqual(submitted)
    expect(submittedTransactionFromRecord(restored)).toEqual(submitted)
    expect(restored).toMatchObject({ recipient, valueLuna: 1_000, data: context.data })
  })

  it('stores no private or recovery material', () => {
    const storage = new MemoryStorage()
    const submitted = createSubmittedTransaction({ ...context, hash: 'ab'.repeat(32) })
    persistPhaseZeroPaymentRecord(submitted, storage)

    const serialized = storage.values.get(PHASE_ZERO_TRANSACTION_STORAGE_KEY) ?? ''
    expect(serialized).not.toMatch(/private|secret|seed|mnemonic|recovery/iu)
    expect(serialized).not.toContain('selectedAccount')
  })

  it('locks another payment for both known and ambiguous submission outcomes', () => {
    const submitted = createSubmittedTransaction({ ...context, hash: 'ab'.repeat(32) })
    const unknown = createUnknownSubmission(context)

    expect(isDiagnosticPaymentLocked(submitted)).toBe(true)
    expect(isDiagnosticPaymentLocked(unknown)).toBe(true)
    expect(isDiagnosticPaymentLocked(null)).toBe(false)
  })

  it('requires confirmation before an unresolved or ambiguous record is cleared', () => {
    const submitted = createSubmittedTransaction({ ...context, hash: 'ab'.repeat(32) })
    const unknown = createUnknownSubmission(context)

    expect(requiresClearConfirmation(submitted, 'pending-finality')).toBe(true)
    expect(requiresClearConfirmation(submitted, 'inconclusive')).toBe(true)
    expect(requiresClearConfirmation(unknown, 'verified')).toBe(true)
    expect(requiresClearConfirmation(submitted, 'verified')).toBe(false)
  })

  it('only clears storage through the explicit clear operation', () => {
    const storage = new MemoryStorage()
    const submitted = createSubmittedTransaction({ ...context, hash: 'ab'.repeat(32) })
    persistPhaseZeroPaymentRecord(submitted, storage)

    expect(loadPhaseZeroPaymentRecord(storage)).toEqual(submitted)
    expect(clearPhaseZeroPaymentRecord(storage)).toBe(true)
    expect(loadPhaseZeroPaymentRecord(storage)).toBeNull()
  })

  it('fails closed on malformed persisted data', () => {
    const storage = new MemoryStorage()
    storage.setItem(PHASE_ZERO_TRANSACTION_STORAGE_KEY, JSON.stringify({
      ...context,
      hash: 'not-a-hash',
      status: 'submitted',
    }))

    expect(loadPhaseZeroPaymentRecord(storage)).toBeNull()
  })
})
