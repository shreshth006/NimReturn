import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createClaim,
  getClaim,
  getMerchantClaims,
  getMerchantResolution,
  listPassportClaims,
  requestResolution,
} from '../../src/lib/api/claims.js'

const CLAIM_ID = 'AAAAAAAAAAAAAAAAAAAAAA'
const PASSPORT_ID = 'BBBBBBBBBBBBBBBBBBBBBB'
const MERCHANT_ID = 'CCCCCCCCCCCCCCCCCCCCCC'
const ORDER_ID = 'DDDDDDDDDDDDDDDDDDDDDD'
const HASH = 'ab'.repeat(32)
const ISO = '2026-09-15T12:00:00.000Z'
const ADDRESS = 'NQ15A4YFKG7PU2KLJ7R0K3HE36PLPCC9ND0F'

function claimResponse() {
  return {
    authorization: null,
    challenge: { canonicalMessage: 'NR1\nCLAIM\n{}', expiresAt: ISO, nonce: 'EEEEEEEEEEEEEEEEEEEEEE' },
    claimSignerAddress: null,
    claimTime: ISO,
    claimType: 'RETURN',
    createdAt: ISO,
    eligibility: null,
    merchantPublicId: MERCHANT_ID,
    orderPublicId: ORDER_ID,
    passportPublicId: PASSPORT_ID,
    payloadHash: HASH,
    policyVersion: 1,
    publicId: CLAIM_ID,
    purchaseSenderAddress: ADDRESS,
    reasonCode: 'DEFECTIVE',
    signatureStatus: 'pending',
    workflowState: 'signature_requested',
  }
}

afterEach(() => { vi.unstubAllGlobals() })

describe('claims API client', () => {
  it('creates a claim without accepting a client-asserted purchaser or timestamp', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(claimResponse()), { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(createClaim({
      claimType: 'RETURN',
      note: 'Handle cracked',
      passportPublicId: PASSPORT_ID,
      reasonCode: 'DEFECTIVE',
    })).resolves.toMatchObject({ publicId: CLAIM_ID })

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(typeof init.body).toBe('string')
    if (typeof init.body !== 'string') throw new Error('Expected a JSON request body.')
    const body = JSON.parse(init.body) as Record<string, unknown>
    expect(body).toEqual({ claimType: 'RETURN', note: 'Handle cracked', reasonCode: 'DEFECTIVE' })
    expect(body).not.toHaveProperty('claimTime')
    expect(body).not.toHaveProperty('purchaseSenderAddress')
    expect(init.credentials).toBe('include')
  })

  it('builds a decision request without accepting a client refund amount or signer', async () => {
    const response = {
      approvedRefundLuna: 1_500_000,
      canonicalMessage: 'NR1\nRESOLUTION\n{}',
      claimPublicId: CLAIM_ID,
      createdAt: ISO,
      decision: 'APPROVED',
      expiresAt: ISO,
      note: '',
      payloadHash: HASH,
      policySignerAddress: ADDRESS,
      publicId: 'EEEEEEEEEEEEEEEEEEEEEE',
      reasonCode: 'POLICY_ACCEPTED',
      resolutionTime: ISO,
      signerAddress: null,
      status: 'pending',
      verifiedAt: null,
    }
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(response), { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)
    await requestResolution({
      claimPublicId: CLAIM_ID,
      decision: 'APPROVED',
      merchantPublicId: MERCHANT_ID,
      reasonCode: 'POLICY_ACCEPTED',
    })
    const rawBody = (fetchMock.mock.calls[0]?.[1] as RequestInit).body
    expect(typeof rawBody).toBe('string')
    if (typeof rawBody !== 'string') throw new Error('Expected a JSON request body.')
    const body = JSON.parse(rawBody) as Record<string, unknown>
    expect(body).toEqual({ decision: 'APPROVED', reasonCode: 'POLICY_ACCEPTED' })
    expect(body).not.toHaveProperty('approvedRefundLuna')
    expect(body).not.toHaveProperty('policySignerAddress')
  })

  it('rejects malformed public claim and queue projections', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...claimResponse(), privateKey: 'leak' }), { status: 200 })))
    await expect(getClaim(CLAIM_ID)).rejects.toMatchObject({ code: 'INVALID_API_RESPONSE' })

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ claims: [{ unexpected: true }] }), { status: 200 })))
    await expect(getMerchantClaims(MERCHANT_ID)).rejects.toMatchObject({ code: 'INVALID_API_RESPONSE' })
  })

  it('recovers pending decision bytes only through the protected merchant path', async () => {
    const response = {
      approvedRefundLuna: 0,
      canonicalMessage: 'NR1\nRESOLUTION\n{}',
      claimPublicId: CLAIM_ID,
      createdAt: ISO,
      decision: 'REJECTED',
      expiresAt: ISO,
      note: '',
      payloadHash: HASH,
      policySignerAddress: ADDRESS,
      publicId: 'EEEEEEEEEEEEEEEEEEEEEE',
      reasonCode: 'POLICY_NOT_APPLICABLE',
      resolutionTime: ISO,
      signerAddress: null,
      status: 'pending',
      verifiedAt: null,
    }
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(response), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(getMerchantResolution(CLAIM_ID, MERCHANT_ID)).resolves.toMatchObject({ status: 'pending' })
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(new RegExp(`/api/v1/merchants/${MERCHANT_ID}/claims/${CLAIM_ID}/resolution$`, 'u')),
      expect.objectContaining({ credentials: 'include' }),
    )
  })

  it('strictly parses the public verified claim history for one Passport', async () => {
    const accepted = {
      authorization: {
        mode: 'purchase_key',
        status: 'verified',
      },
      claimSignerAddress: ADDRESS,
      claimTime: '2026-09-17T00:00:00.000Z',
      claimType: 'RETURN',
      eligibility: {
        deadlineMs: 1_800_000_000_000,
        eligible: true,
        evaluatedAtMs: 1_700_000_000_000,
        evaluatorVersion: 'claim-eligibility-v1',
        rules: {
          authorizationVerified: true,
          chronologyValid: true,
          passportActive: true,
          purchaseVerified: true,
          windowAvailable: true,
          withinInclusiveDeadline: true,
        },
        selectedWindowSeconds: 86_400,
      },
      payloadHash: 'a'.repeat(64),
      publicId: CLAIM_ID,
      purchaseSenderAddress: ADDRESS,
      reasonCode: 'CHANGED_MIND',
      signatureStatus: 'verified',
      workflowState: 'eligible',
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ claims: [accepted] }), { status: 200 }),
    ))
    await expect(listPassportClaims(PASSPORT_ID)).resolves.toMatchObject([
      { authorization: { mode: 'purchase_key' }, publicId: CLAIM_ID },
    ])

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ claims: [{ ...accepted, note: 'not in public projection' }] }), { status: 200 }),
    ))
    await expect(listPassportClaims(PASSPORT_ID)).rejects.toMatchObject({ code: 'INVALID_API_RESPONSE' })
  })
})
