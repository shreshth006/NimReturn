import type postgres from 'postgres'
import { afterEach, describe, expect, it } from 'vitest'

import { buildApp } from '../../server/app.js'
import type { ServerConfig } from '../../server/config.js'
import type { RefundView } from '../../server/domain/refund-lifecycle.js'
import { createMerchantSessionToken } from '../../server/http/merchant-session.js'

const config: ServerConfig = {
  HOST: '127.0.0.1',
  NIMIQ_NETWORK: 'TestAlbatross',
  NODE_ENV: 'test',
  PORT: 3001,
  SESSION_SECRET: 'refund-routes-test-secret-that-is-at-least-32-bytes',
}
const MERCHANT_ID = 'AAAAAAAAAAAAAAAAAAAAAA'
const CLAIM_ID = 'BBBBBBBBBBBBBBBBBBBBBB'
const ATTEMPT_ID = 'CCCCCCCCCCCCCCCCCCCCCC'
const PASSPORT_ID = 'DDDDDDDDDDDDDDDDDDDDDD'
const RESOLUTION_ID = 'EEEEEEEEEEEEEEEEEEEEEE'
const HASH = 'ab'.repeat(32)
const ADDRESS_A = 'NQ46KLJE5TMF4Y1A1255CJHJYG1SH0NUT604'
const ADDRESS_B = 'NQ6616JYYPSEVGXT606D6YKEEURTHE0VARDR'

function refundView(overrides: Partial<RefundView> = {}): RefundView {
  return {
    attempt: {
      createdAt: new Date('2026-09-15T12:00:00.000Z'),
      expectedPayment: {
        data: `NR1:R:${CLAIM_ID}`,
        network: 'TestAlbatross',
        recipient: ADDRESS_A,
        sender: ADDRESS_B,
        valueLuna: 1_000,
      },
      failureCode: null,
      outcome: { referenceHeight: null, ruledOutAt: null, ruledOutHeight: null, safeAfterHeight: null },
      publicId: ATTEMPT_ID,
      recipientRule: 'purchase-sender-v1',
      rowVersion: 1,
      state: 'payment_requested',
      transaction: null,
      updatedAt: new Date('2026-09-15T12:00:00.000Z'),
    },
    claimPublicId: CLAIM_ID,
    decision: 'APPROVED',
    passportPublicId: PASSPORT_ID,
    refund: null,
    resolutionPublicId: RESOLUTION_ID,
    ...overrides,
  }
}

const apps: Awaited<ReturnType<typeof buildApp>>[] = []
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())) })

describe('refund routes', () => {
  it('exposes an approved refund projection publicly', async () => {
    const app = await buildApp(config, {
      database: {} as postgres.Sql,
      readRefund: () => Promise.resolve(refundView()),
    })
    apps.push(app)
    const response = await app.inject({ method: 'GET', url: `/api/v1/claims/${CLAIM_ID}/refund` })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      attempt: { expectedPayment: { sender: ADDRESS_B }, state: 'payment_requested' },
      refund: null,
    })
  })

  it('protects every refund mutation with the merchant session and strict path bindings', async () => {
    const createInputs: unknown[] = []
    const stateInputs: unknown[] = []
    const verifyInputs: unknown[] = []
    const recheckInputs: unknown[] = []
    const app = await buildApp(config, {
      createRefund: (_database, input) => { createInputs.push(input); return Promise.resolve(refundView()) },
      database: {} as postgres.Sql,
      recheckRefund: (_database, _reader, input) => { recheckInputs.push(input); return Promise.resolve(refundView()) },
      recordRefundState: (_database, input) => { stateInputs.push(input); return Promise.resolve(refundView()) },
      verifyRefund: (_database, _reader, input) => { verifyInputs.push(input); return Promise.resolve(refundView()) },
    })
    apps.push(app)
    const createUrl = `/api/v1/merchants/${MERCHANT_ID}/claims/${CLAIM_ID}/refunds`
    expect((await app.inject({ method: 'POST', url: createUrl })).statusCode).toBe(401)

    const token = createMerchantSessionToken({ merchantPublicId: MERCHANT_ID, secret: config.SESSION_SECRET ?? '' }).token
    const cookies = { nimreturn_merchant_session: token }
    expect((await app.inject({ cookies, method: 'POST', url: createUrl })).statusCode).toBe(201)
    expect(createInputs).toEqual([{ claimPublicId: CLAIM_ID, merchantPublicId: MERCHANT_ID, network: 'TestAlbatross' }])

    const base = `${createUrl}/${ATTEMPT_ID}`
    expect((await app.inject({
      cookies,
      method: 'POST',
      payload: { event: 'wallet-request-started' },
      url: `${base}/wallet-state`,
    })).statusCode).toBe(200)
    expect(stateInputs).toEqual([{
      attemptPublicId: ATTEMPT_ID,
      claimPublicId: CLAIM_ID,
      event: 'wallet-request-started',
      merchantPublicId: MERCHANT_ID,
    }])

    expect((await app.inject({ cookies, method: 'POST', payload: { hash: HASH }, url: `${base}/transactions` })).statusCode).toBe(200)
    expect(verifyInputs).toEqual([{
      attemptPublicId: ATTEMPT_ID,
      claimPublicId: CLAIM_ID,
      hash: HASH,
      merchantPublicId: MERCHANT_ID,
    }])
    expect((await app.inject({ cookies, method: 'POST', url: `${base}/recheck` })).statusCode).toBe(200)
    expect(recheckInputs).toEqual([{
      attemptPublicId: ATTEMPT_ID,
      claimPublicId: CLAIM_ID,
      merchantPublicId: MERCHANT_ID,
    }])
  })

  it('reconciles unknown outcomes only for the merchant session with server-read chain height', async () => {
    const reconcileInputs: unknown[] = []
    const stateInputs: unknown[] = []
    const search = {
      getHead: () => Promise.resolve({ blockNumber: 12_345, network: 'TestAlbatross' }),
      listTransactionsByAddress: () => Promise.resolve([]),
    }
    const app = await buildApp(config, {
      database: {} as postgres.Sql,
      reconcileRefund: (_database, _reader, _search, input) => {
        reconcileInputs.push(input)
        return Promise.resolve({ headBlockNumber: 12_345, refund: refundView(), result: 'waiting', safeAfterHeight: 20_145 })
      },
      recordRefundState: (_database, input) => { stateInputs.push(input); return Promise.resolve(refundView()) },
      refundSearch: search,
    })
    apps.push(app)
    const base = `/api/v1/merchants/${MERCHANT_ID}/claims/${CLAIM_ID}/refunds/${ATTEMPT_ID}`
    expect((await app.inject({ method: 'POST', url: `${base}/reconcile` })).statusCode).toBe(401)

    const token = createMerchantSessionToken({ merchantPublicId: MERCHANT_ID, secret: config.SESSION_SECRET ?? '' }).token
    const cookies = { nimreturn_merchant_session: token }
    const response = await app.inject({ cookies, method: 'POST', url: `${base}/reconcile` })
    expect(response.statusCode).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.json()).toMatchObject({ result: 'waiting', safeAfterHeight: 20_145 })
    expect(reconcileInputs).toEqual([{ attemptPublicId: ATTEMPT_ID, claimPublicId: CLAIM_ID, merchantPublicId: MERCHANT_ID }])
    expect((await app.inject({
      cookies,
      method: 'POST',
      payload: { referenceHeight: 1 },
      url: `${base}/reconcile`,
    })).statusCode).toBe(400)

    await app.inject({ cookies, method: 'POST', payload: { event: 'wallet-request-started' }, url: `${base}/wallet-state` })
    expect(stateInputs).toEqual([{
      attemptPublicId: ATTEMPT_ID,
      claimPublicId: CLAIM_ID,
      event: 'wallet-request-started',
      merchantPublicId: MERCHANT_ID,
      referenceHeight: 12_345,
    }])
    expect((await app.inject({
      cookies,
      method: 'POST',
      payload: { event: 'wallet-request-started', referenceHeight: 1 },
      url: `${base}/wallet-state`,
    })).statusCode).toBe(400)

    const offline = await buildApp(config, { database: {} as postgres.Sql })
    apps.push(offline)
    expect((await offline.inject({ cookies, method: 'POST', url: `${base}/reconcile` })).statusCode).toBe(503)
  })

  it('rejects client-supplied refund authority fields', async () => {
    const app = await buildApp(config, { database: {} as postgres.Sql })
    apps.push(app)
    const token = createMerchantSessionToken({ merchantPublicId: MERCHANT_ID, secret: config.SESSION_SECRET ?? '' }).token
    const response = await app.inject({
      cookies: { nimreturn_merchant_session: token },
      method: 'POST',
      payload: { recipient: ADDRESS_A, sender: ADDRESS_B, valueLuna: 1 },
      url: `/api/v1/merchants/${MERCHANT_ID}/claims/${CLAIM_ID}/refunds`,
    })
    expect(response.statusCode).toBe(400)
  })
})
