import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  attachTransaction,
  createOrder,
  getFeaturedExample,
  getPassport,
  PurchaseApiError,
  submitClaimKey,
} from '../../src/lib/api/purchase.js'

const PRODUCT_ID = 'AAAAAAAAAAAAAAAAAAAAAA'
const ORDER_ID = 'BBBBBBBBBBBBBBBBBBBBBB'
const POLICY_ID = 'CCCCCCCCCCCCCCCCCCCCCC'
const PASSPORT_ID = 'DDDDDDDDDDDDDDDDDDDDDD'
const HASH = 'ab'.repeat(32)
const ADDRESS = 'NQ6616JYYPSEVGXT606D6YKEEURTHE0VARDR'

function orderResponse() {
  return {
    buyerAddress: null,
    claimKey: null,
    createdAt: '2026-09-15T12:00:00.000Z',
    expectedPayment: {
      data: `NR1:P:${ORDER_ID}`,
      network: 'TestAlbatross',
      recipient: ADDRESS,
      valueLuna: 500_000,
    },
    expiresAt: '2026-09-15T12:20:00.000Z',
    failureCode: null,
    merchant: { displayName: 'North Star', publicId: 'EEEEEEEEEEEEEEEEEEEEEE' },
    passport: null,
    paymentState: 'payment_requested',
    policy: { payloadHash: 'cd'.repeat(32), publicId: POLICY_ID, version: 1 },
    product: { description: 'A mouse.', name: 'Wireless Mouse', publicId: PRODUCT_ID },
    publicId: ORDER_ID,
    rowVersion: 1,
    transaction: null,
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('purchase API client', () => {
  it('creates an order without accepting client-authored payment terms', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(orderResponse()), { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(createOrder(PRODUCT_ID)).resolves.toMatchObject({ publicId: ORDER_ID })
    const call = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(call[0]).toMatch(`/api/v1/products/${PRODUCT_ID}/orders`)
    expect(call[1]).toMatchObject({ body: '{}', credentials: 'include', method: 'POST' })
  })

  it('submits only the claim key nonce and strict proof envelope', async () => {
    const canonicalMessage = 'NIMRETURN/1/PURCHASE_CLAIM_KEY\n{}'
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ...orderResponse(),
      claimKey: {
        canonicalMessage,
        expiresAt: '2026-09-15T12:10:00.000Z',
        nonce: POLICY_ID,
        payloadHash: 'ef'.repeat(32),
        signerAddress: ADDRESS,
        status: 'verified',
        verifiedAt: '2026-09-15T12:01:00.000Z',
      },
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const proof = {
      canonicalMessage,
      payloadHash: 'ef'.repeat(32),
      publicKey: 'ab'.repeat(32),
      signature: 'cd'.repeat(64),
    }

    await expect(submitClaimKey(ORDER_ID, POLICY_ID, proof))
      .resolves.toMatchObject({ claimKey: { signerAddress: ADDRESS, status: 'verified' } })
    const call = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(call[0]).toMatch(`/api/v1/orders/${ORDER_ID}/claim-key/submit`)
    expect(JSON.parse(call[1].body as string)).toEqual({ nonce: POLICY_ID, proof })
    expect(() => submitClaimKey(ORDER_ID, POLICY_ID, { ...proof, signerAddress: ADDRESS }))
      .toThrow()
  })

  it('attaches only the wallet-returned hash with no sender claim', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ...orderResponse(),
      paymentState: 'payment_pending',
      rowVersion: 3,
      transaction: {
        blockNumber: null,
        blockTimestamp: null,
        executionResult: null,
        finalizingBlockNumber: null,
        hash: HASH,
        headBlockNumber: null,
        observedState: 'absent',
        reason: 'Not found yet.',
        reconciliation: null,
        sender: null,
      },
    }), { status: 202 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(attachTransaction(ORDER_ID, HASH)).resolves.toMatchObject({ paymentState: 'payment_pending' })
    const call = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = call[1].body
    if (typeof body !== 'string') throw new Error('Expected a JSON request body.')
    expect(JSON.parse(body)).toEqual({ hash: HASH })
  })

  it('fails closed when a successful order response contains unsafe money', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ...orderResponse(),
      expectedPayment: { ...orderResponse().expectedPayment, valueLuna: Number.MAX_SAFE_INTEGER + 1 },
    }), { status: 200 })))

    const result = createOrder(PRODUCT_ID)
    await expect(result).rejects.toBeInstanceOf(PurchaseApiError)
    await expect(result).rejects.toMatchObject({ code: 'INVALID_API_RESPONSE' })
  })

  it('rejects a Passport missing independently verified finality evidence', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      publicId: PASSPORT_ID,
      status: 'active',
    }), { status: 200 })))

    await expect(getPassport(PASSPORT_ID)).rejects.toMatchObject({ code: 'INVALID_API_RESPONSE' })
  })

  it('accepts only strict public identifiers for the server-reverified example', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        passportPublicId: PASSPORT_ID,
        productPublicId: PRODUCT_ID,
        products: [{ name: 'Cap', network: 'TestAlbatross', priceLuna: 1_000, publicId: PRODUCT_ID }],
      }), { status: 200 }),
    ))
    await expect(getFeaturedExample()).resolves.toEqual({
      passportPublicId: PASSPORT_ID,
      productPublicId: PRODUCT_ID,
      products: [{ name: 'Cap', network: 'TestAlbatross', priceLuna: 1_000, publicId: PRODUCT_ID }],
    })

    // An older server that lists no products still yields a usable example.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ passportPublicId: PASSPORT_ID, productPublicId: PRODUCT_ID }), { status: 200 }),
    ))
    await expect(getFeaturedExample()).resolves.toMatchObject({ products: [] })

    // The product is required: without it a visitor cannot repeat the purchase.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ passportPublicId: PASSPORT_ID }), { status: 200 }),
    ))
    await expect(getFeaturedExample()).rejects.toMatchObject({ code: 'INVALID_API_RESPONSE' })

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        passportPublicId: PASSPORT_ID, productPublicId: PRODUCT_ID, trusted: true,
      }), { status: 200 }),
    ))
    await expect(getFeaturedExample()).rejects.toMatchObject({ code: 'INVALID_API_RESPONSE' })

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 404 })))
    await expect(getFeaturedExample()).resolves.toBeNull()
  })
})
