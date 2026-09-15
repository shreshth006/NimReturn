import type postgres from 'postgres'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { buildApp } from '../../server/app.js'
import type { ServerConfig } from '../../server/config.js'
import type { PromiseLedgerView } from '../../server/domain/get-promise-ledger.js'

const config: ServerConfig = {
  HOST: '127.0.0.1',
  NIMIQ_NETWORK: 'TestAlbatross',
  NODE_ENV: 'test',
  PORT: 3001,
}
const MERCHANT_ID = 'MMMMMMMMMMMMMMMMMMMMMM'

function ledger(): PromiseLedgerView {
  const count = (value: number, sampleSize: number) => ({
    definition: 'A sufficiently explicit verified-evidence metric definition.',
    sampleSize,
    value,
  })
  return {
    asOf: new Date('2026-09-15T15:00:00.000Z'),
    definitionsVersion: 'promise-ledger-v1',
    evidenceModel: {
      chainTransactions: 'Chain transactions are monetary evidence.',
      walletSignatures: 'Wallet signatures are attestations.',
    },
    merchant: {
      displayName: 'North Star',
      policySignerAddress: 'NQ15A4YFKG7PU2KLJ7R0K3HE36PLPCC9ND0F',
      publicId: MERCHANT_ID,
    },
    metrics: {
      approvedClaims: count(2, 3),
      claimsFiled: count(4, 3),
      eligibleClaims: count(3, 4),
      ineligibleClaims: count(1, 4),
      medianResolutionTime: {
        definition: 'Median verified response time.',
        sampleSize: 3,
        unit: 'milliseconds',
        value: 1_500,
      },
      refundPending: count(1, 2),
      rejectedClaims: count(1, 3),
      unresolvedCases: count(1, 4),
      verifiedPurchases: count(3, 3),
      verifiedRefunds: count(1, 2),
    },
    products: [],
  }
}

const apps: Awaited<ReturnType<typeof buildApp>>[] = []

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()))
})

describe('public Promise Ledger route', () => {
  it('returns only the read-only derived projection and serializes its as-of time', async () => {
    const readPromiseLedger = vi.fn().mockResolvedValue(ledger())
    const app = await buildApp(config, {
      database: {} as postgres.Sql,
      readPromiseLedger,
    })
    apps.push(app)

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/merchants/${MERCHANT_ID}/promise-ledger`,
    })

    expect(response.statusCode).toBe(200)
    expect(response.headers['cache-control']).toBe('public, max-age=15, stale-while-revalidate=60')
    expect(response.json()).toMatchObject({
      asOf: '2026-09-15T15:00:00.000Z',
      definitionsVersion: 'promise-ledger-v1',
      metrics: { verifiedPurchases: { value: 3 } },
    })
    expect(readPromiseLedger).toHaveBeenCalledWith(expect.anything(), MERCHANT_ID)
  })

  it('validates IDs, fails closed without storage, and has no mutation route', async () => {
    const readPromiseLedger = vi.fn()
    const app = await buildApp(config, {
      database: {} as postgres.Sql,
      readPromiseLedger,
    })
    apps.push(app)

    const invalid = await app.inject({ method: 'GET', url: '/api/v1/merchants/not-valid/promise-ledger' })
    expect(invalid.statusCode).toBe(400)
    expect(readPromiseLedger).not.toHaveBeenCalled()

    const mutation = await app.inject({
      method: 'POST',
      payload: { verifiedPurchases: 999 },
      url: `/api/v1/merchants/${MERCHANT_ID}/promise-ledger`,
    })
    expect(mutation.statusCode).toBe(404)
    expect(readPromiseLedger).not.toHaveBeenCalled()

    const unavailableApp = await buildApp(config)
    apps.push(unavailableApp)
    const unavailable = await unavailableApp.inject({
      method: 'GET',
      url: `/api/v1/merchants/${MERCHANT_ID}/promise-ledger`,
    })
    expect(unavailable.statusCode).toBe(503)
    expect(unavailable.json()).toMatchObject({ code: 'LEDGER_UNAVAILABLE' })
  })

  it('does not expose unverified merchants or integrity failures', async () => {
    const missingApp = await buildApp(config, {
      database: {} as postgres.Sql,
      readPromiseLedger: () => Promise.resolve(null),
    })
    apps.push(missingApp)
    const missing = await missingApp.inject({
      method: 'GET',
      url: `/api/v1/merchants/${MERCHANT_ID}/promise-ledger`,
    })
    expect(missing.statusCode).toBe(404)

    const failedApp = await buildApp(config, {
      database: {} as postgres.Sql,
      readPromiseLedger: () => Promise.reject(new Error('database detail must not escape')),
    })
    apps.push(failedApp)
    const failed = await failedApp.inject({
      method: 'GET',
      url: `/api/v1/merchants/${MERCHANT_ID}/promise-ledger`,
    })
    expect(failed.statusCode).toBe(503)
    expect(failed.json()).toEqual({
      code: 'LEDGER_EVIDENCE_UNAVAILABLE',
      message: 'The Promise Ledger could not be safely derived from verified evidence.',
    })
  })
})
