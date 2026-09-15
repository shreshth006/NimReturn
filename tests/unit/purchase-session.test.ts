import { describe, expect, it } from 'vitest'

import {
  clearPurchaseSession,
  loadPurchaseSession,
  savePurchaseSession,
} from '../../src/features/purchase/purchase-session.js'

const PRODUCT_ID = 'AAAAAAAAAAAAAAAAAAAAAA'
const ORDER_ID = 'BBBBBBBBBBBBBBBBBBBBBB'
const HASH = 'ab'.repeat(32)
const STORAGE_KEY = 'nimreturn.phase2.purchase.v1'

function memoryStorage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    removeItem: (key: string) => {
      values.delete(key)
    },
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
  }
}

describe('purchase reload recovery', () => {
  it('persists only public recovery identifiers before backend attachment', () => {
    const storage = memoryStorage()
    expect(savePurchaseSession({
      orderPublicId: ORDER_ID,
      productPublicId: PRODUCT_ID,
      transactionHash: HASH,
    }, storage)).toBe(true)

    expect(loadPurchaseSession(PRODUCT_ID, storage)).toEqual({
      orderPublicId: ORDER_ID,
      productPublicId: PRODUCT_ID,
      transactionHash: HASH,
    })
    const serialized = storage.getItem(STORAGE_KEY)
    expect(serialized).not.toContain('sender')
    expect(serialized).not.toContain('private')
    expect(serialized).not.toContain('seed')
  })

  it('rejects another product and any extra untrusted recovery fields', () => {
    const storage = memoryStorage()
    savePurchaseSession({ orderPublicId: ORDER_ID, productPublicId: PRODUCT_ID }, storage)
    expect(loadPurchaseSession('CCCCCCCCCCCCCCCCCCCCCC', storage)).toBeNull()

    storage.setItem(STORAGE_KEY, JSON.stringify({
      orderPublicId: ORDER_ID,
      productPublicId: PRODUCT_ID,
      sender: 'client-claimed',
    }))
    expect(loadPurchaseSession(PRODUCT_ID, storage)).toBeNull()
  })

  it('clears a completed or intentionally abandoned local recovery pointer', () => {
    const storage = memoryStorage()
    savePurchaseSession({ orderPublicId: ORDER_ID, productPublicId: PRODUCT_ID }, storage)
    expect(clearPurchaseSession(storage)).toBe(true)
    expect(loadPurchaseSession(PRODUCT_ID, storage)).toBeNull()
  })
})
