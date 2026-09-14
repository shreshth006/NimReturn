import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createMerchant,
  getPublicProduct,
  MerchantApiError,
} from '../../src/lib/api/merchant.js'

const PRODUCT_ID = 'AAAAAAAAAAAAAAAAAAAAAA'
const MERCHANT_ID = 'BBBBBBBBBBBBBBBBBBBBBB'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('merchant API client', () => {
  it('creates a merchant with cookie credentials without accepting a bootstrap in JSON', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      bootstrapExpiresAt: '2026-09-15T12:05:00.000Z',
      merchant: { displayName: 'North Star', publicId: MERCHANT_ID },
      product: { name: 'Trail cup', publicId: PRODUCT_ID },
    }), { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(createMerchant({
      defaultSettlementAddress: 'NQ15A4YFKG7PU2KLJ7R0K3HE36PLPCC9ND0F',
      displayName: 'North Star',
      productName: 'Trail cup',
    })).resolves.toMatchObject({ product: { publicId: PRODUCT_ID } })
    expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/api\/v1\/merchants$/u), expect.objectContaining({
      credentials: 'include',
      method: 'POST',
    }))
  })

  it('rejects a malformed successful policy projection', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      policy: { verified: true },
    }), { status: 200 })))

    await expect(getPublicProduct(PRODUCT_ID)).rejects.toMatchObject({
      code: 'INVALID_API_RESPONSE',
      name: 'MerchantApiError',
    })
  })

  it('preserves a stable server error code and status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: 'MERCHANT_AUTH_REQUIRED',
      message: 'Merchant authorization is missing or expired.',
    }), { status: 401 })))

    const result = getPublicProduct(PRODUCT_ID)
    await expect(result).rejects.toBeInstanceOf(MerchantApiError)
    await expect(result).rejects.toMatchObject({
      code: 'MERCHANT_AUTH_REQUIRED',
      status: 401,
    })
  })
})
