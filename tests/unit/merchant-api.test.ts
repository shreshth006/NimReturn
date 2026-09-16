import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createMerchant,
  getPublicProduct,
  MerchantApiError,
  requestMerchantSessionChallenge,
  restoreMerchantSession,
} from '../../src/lib/api/merchant.js'
import { hashProtocolPayload } from '../../src/lib/crypto/nimiq-signature.js'
import { buildMerchantSessionMessage } from '../../src/lib/protocol/merchant-session.js'

const PRODUCT_ID = 'AAAAAAAAAAAAAAAAAAAAAA'
const MERCHANT_ID = 'BBBBBBBBBBBBBBBBBBBBBB'
const ADDRESS = 'NQ46KLJE5TMF4Y1A1255CJHJYG1SH0NUT604'
const CREATED_AT = 1_789_335_000_000
const EXPIRES_AT = CREATED_AT + 300_000

const sessionPayload = {
  audience: 'https://staging.example.com',
  createdAt: CREATED_AT,
  expiresAt: EXPIRES_AT,
  merchantId: MERCHANT_ID,
  nonce: PRODUCT_ID,
  policySignerAddress: ADDRESS,
  type: 'MERCHANT_SESSION' as const,
  version: 1 as const,
}
const sessionMessage = buildMerchantSessionMessage(sessionPayload)

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
      defaultSettlementAddress: ADDRESS,
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

  it('requests a strict short-lived merchant-session challenge without existing credentials', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      canonicalMessage: sessionMessage,
      expectedSignerAddress: ADDRESS,
      expiresAt: new Date(EXPIRES_AT).toISOString(),
      nonce: PRODUCT_ID,
      payload: sessionPayload,
      payloadHash: hashProtocolPayload(sessionMessage),
    }), { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(requestMerchantSessionChallenge(MERCHANT_ID)).resolves.toMatchObject({
      expectedSignerAddress: ADDRESS,
      payload: { merchantId: MERCHANT_ID, type: 'MERCHANT_SESSION' },
    })
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(new RegExp(`/api/v1/merchants/${MERCHANT_ID}/session/challenges$`, 'u')),
      expect.objectContaining({
        body: '{}',
        credentials: 'include',
        method: 'POST',
      }),
    )
  })

  it('rejects a reconnect challenge whose redundant signer fields disagree', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      canonicalMessage: sessionMessage,
      expectedSignerAddress: 'NQ6616JYYPSEVGXT606D6YKEEURTHE0VARDR',
      expiresAt: new Date(EXPIRES_AT).toISOString(),
      nonce: PRODUCT_ID,
      payload: sessionPayload,
      payloadHash: hashProtocolPayload(sessionMessage),
    }), { status: 201 })))

    await expect(requestMerchantSessionChallenge(MERCHANT_ID)).rejects.toMatchObject({
      code: 'INVALID_API_RESPONSE',
    })
  })

  it('submits only the one-time nonce and exact public proof when restoring access', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      authenticated: true,
      expiresAt: new Date(EXPIRES_AT + 28_800_000).toISOString(),
      merchantPublicId: MERCHANT_ID,
      signerAddress: ADDRESS,
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const proof = {
      canonicalMessage: sessionMessage,
      payloadHash: hashProtocolPayload(sessionMessage),
      publicKey: 'ab'.repeat(32),
      signature: 'cd'.repeat(64),
    }

    await expect(restoreMerchantSession({
      challengeNonce: PRODUCT_ID,
      merchantPublicId: MERCHANT_ID,
      proof,
    })).resolves.toMatchObject({ authenticated: true, signerAddress: ADDRESS })
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(new RegExp(`/api/v1/merchants/${MERCHANT_ID}/session$`, 'u')),
      expect.objectContaining({
        body: JSON.stringify({ challengeNonce: PRODUCT_ID, proof }),
        credentials: 'include',
        method: 'POST',
      }),
    )
  })
})
