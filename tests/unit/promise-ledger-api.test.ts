import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  getPromiseLedger,
  PromiseLedgerApiError,
} from '../../src/lib/api/promise-ledger.js'

const MERCHANT_ID = 'MMMMMMMMMMMMMMMMMMMMMM'

function responseBody() {
  const count = (value: number, sampleSize: number) => ({
    definition: 'Derived only from independently verified protocol evidence.',
    sampleSize,
    value,
  })
  return {
    asOf: '2026-09-16T00:00:00.000Z',
    definitionsVersion: 'promise-ledger-v1',
    evidenceModel: {
      chainTransactions: 'Chain monetary evidence.',
      walletSignatures: 'Signature attestations.',
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
        definition: 'Median time from authorization to signed decision.',
        sampleSize: 3,
        unit: 'milliseconds',
        value: 1_000,
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

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Promise Ledger API client', () => {
  it('accepts a reconciled, strictly shaped public ledger', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(responseBody()), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(getPromiseLedger(MERCHANT_ID)).resolves.toMatchObject({
      metrics: { verifiedPurchases: { value: 3 } },
    })
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(new RegExp(`/api/v1/merchants/${MERCHANT_ID}/promise-ledger$`, 'u')),
      { headers: { accept: 'application/json' } },
    )
  })

  it('rejects inconsistent totals instead of rendering them', async () => {
    const body = responseBody()
    body.metrics.verifiedRefunds.value = 2
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 200 })))

    await expect(getPromiseLedger(MERCHANT_ID)).rejects.toMatchObject({
      code: 'INVALID_API_RESPONSE',
      name: 'PromiseLedgerApiError',
    })
  })

  it('preserves safe server errors without exposing malformed responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: 'LEDGER_EVIDENCE_UNAVAILABLE',
      message: 'The Promise Ledger could not be safely derived from verified evidence.',
    }), { status: 503 })))

    const result = getPromiseLedger(MERCHANT_ID)
    await expect(result).rejects.toBeInstanceOf(PromiseLedgerApiError)
    await expect(result).rejects.toMatchObject({
      code: 'LEDGER_EVIDENCE_UNAVAILABLE',
      status: 503,
    })
  })
})
