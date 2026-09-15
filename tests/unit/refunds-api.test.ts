import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  attachRefundTransaction,
  createRefund,
  getRefund,
} from '../../src/lib/api/refunds.js'

const MERCHANT_ID = 'AAAAAAAAAAAAAAAAAAAAAA'
const CLAIM_ID = 'BBBBBBBBBBBBBBBBBBBBBB'
const ATTEMPT_ID = 'CCCCCCCCCCCCCCCCCCCCCC'
const PASSPORT_ID = 'DDDDDDDDDDDDDDDDDDDDDD'
const RESOLUTION_ID = 'EEEEEEEEEEEEEEEEEEEEEE'
const HASH = 'ab'.repeat(32)
const ADDRESS_A = 'NQ46KLJE5TMF4Y1A1255CJHJYG1SH0NUT604'
const ADDRESS_B = 'NQ6616JYYPSEVGXT606D6YKEEURTHE0VARDR'

function response() {
  return {
    attempt: {
      createdAt: '2026-09-15T12:00:00.000Z',
      expectedPayment: {
        data: `NR1:R:${CLAIM_ID}`,
        network: 'TestAlbatross',
        recipient: ADDRESS_A,
        sender: ADDRESS_B,
        valueLuna: 1_000,
      },
      failureCode: null,
      publicId: ATTEMPT_ID,
      rowVersion: 1,
      state: 'payment_requested',
      transaction: null,
      updatedAt: '2026-09-15T12:00:00.000Z',
    },
    claimPublicId: CLAIM_ID,
    decision: 'APPROVED',
    passportPublicId: PASSPORT_ID,
    refund: null,
    resolutionPublicId: RESOLUTION_ID,
  }
}

afterEach(() => { vi.unstubAllGlobals() })

describe('refund API client', () => {
  it('creates only an empty server-derived refund request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(response()), { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(createRefund(MERCHANT_ID, CLAIM_ID)).resolves.toMatchObject({ attempt: { publicId: ATTEMPT_ID } })
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(init.body).toBe('{}')
    expect(init.credentials).toBe('include')
  })

  it('attaches only a normalized hash and never a client sender/recipient/value', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(response()), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await attachRefundTransaction(MERCHANT_ID, CLAIM_ID, ATTEMPT_ID, HASH)
    const raw = (fetchMock.mock.calls[0]?.[1] as RequestInit).body
    if (typeof raw !== 'string') throw new Error('Expected JSON body.')
    expect(JSON.parse(raw)).toEqual({ hash: HASH })
  })

  it('rejects a malformed or expanded refund projection', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...response(), privateKey: 'leak' }), { status: 200 })))
    await expect(getRefund(CLAIM_ID)).rejects.toMatchObject({ code: 'INVALID_API_RESPONSE' })
  })
})
