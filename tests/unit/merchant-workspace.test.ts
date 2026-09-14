import { describe, expect, it } from 'vitest'

import {
  loadMerchantWorkspace,
  saveMerchantWorkspace,
  savePendingChallenge,
} from '../../src/features/merchant/merchant-workspace.js'

function memoryStorage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    removeItem: (key: string) => values.delete(key),
    setItem: (key: string, value: string) => values.set(key, value),
  }
}

const workspace = {
  displayName: 'North Star',
  merchantPublicId: 'AAAAAAAAAAAAAAAAAAAAAA',
  productName: 'Trail cup',
  productPublicId: 'BBBBBBBBBBBBBBBBBBBBBB',
}

describe('merchant workspace recovery', () => {
  it('restores public resource identifiers without storing authorization secrets', () => {
    const storage = memoryStorage()
    expect(saveMerchantWorkspace(workspace, storage)).toBe(true)

    expect(loadMerchantWorkspace(storage)).toEqual(workspace)
    expect(storage.getItem('nimreturn.phase1.merchant-workspace.v1')).not.toContain('capability')
  })

  it('restores a live signing challenge and drops it exactly at expiry', () => {
    const storage = memoryStorage()
    const expiresAt = '2026-09-15T12:05:00.000Z'
    const pendingChallenge = {
      canonicalMessage: 'NIMRETURN/1/POLICY\n{}',
      expiresAt,
      nonce: 'CCCCCCCCCCCCCCCCCCCCCC',
      payload: {
        createdAt: 1_789_469_400_000,
        merchantId: workspace.merchantPublicId,
        nonce: 'CCCCCCCCCCCCCCCCCCCCCC',
        policyId: 'DDDDDDDDDDDDDDDDDDDDDD',
        priceLuna: 1_000,
        productId: workspace.productPublicId,
        productName: workspace.productName,
        protocol: 'NR1' as const,
        returnWindowSeconds: 86_400,
        settlementAddress: 'NQ6616JYYPSEVGXT606D6YKEEURTHE0VARDR',
        type: 'POLICY' as const,
        version: 1,
        warrantyTransferAllowed: false,
        warrantyWindowSeconds: 2_592_000,
      },
      payloadHash: 'a'.repeat(64),
    }
    saveMerchantWorkspace(savePendingChallenge(workspace, pendingChallenge), storage)

    expect(loadMerchantWorkspace(storage, new Date('2026-09-15T12:04:59.999Z')))
      .toMatchObject({ pendingChallenge })
    expect(loadMerchantWorkspace(storage, new Date(expiresAt))).toEqual(workspace)
  })
})
