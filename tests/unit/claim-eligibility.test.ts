import { describe, expect, it } from 'vitest'

import {
  CLAIM_ELIGIBILITY_EVALUATOR_VERSION,
  evaluateClaimEligibility,
} from '../../src/lib/protocol/claim-eligibility.js'

const PURCHASE_TIME = 1_789_336_000_000

function input(overrides: Record<string, unknown> = {}) {
  return {
    authorizationVerified: true,
    claimTimeMs: PURCHASE_TIME + 7 * 86_400_000,
    claimType: 'RETURN',
    evaluatedAtMs: PURCHASE_TIME + 100,
    passportActive: true,
    purchaseTimeMs: PURCHASE_TIME,
    purchaseVerified: true,
    returnWindowSeconds: 7 * 86_400,
    warrantyWindowSeconds: 90 * 86_400,
    ...overrides,
  }
}

describe('claim eligibility', () => {
  it('accepts the exact inclusive deadline and records every rule', () => {
    expect(evaluateClaimEligibility(input())).toEqual({
      deadlineMs: PURCHASE_TIME + 7 * 86_400_000,
      eligible: true,
      evaluatedAtMs: PURCHASE_TIME + 100,
      evaluatorVersion: CLAIM_ELIGIBILITY_EVALUATOR_VERSION,
      rules: {
        authorizationVerified: true,
        chronologyValid: true,
        passportActive: true,
        purchaseVerified: true,
        withinInclusiveDeadline: true,
        windowAvailable: true,
      },
      selectedWindowSeconds: 7 * 86_400,
    })
  })

  it('rejects one millisecond after the deadline', () => {
    expect(evaluateClaimEligibility(input({
      claimTimeMs: PURCHASE_TIME + 7 * 86_400_000 + 1,
    }))).toMatchObject({ eligible: false, rules: { withinInclusiveDeadline: false } })
  })

  it('selects the warranty window independently', () => {
    expect(evaluateClaimEligibility(input({
      claimTimeMs: PURCHASE_TIME + 8 * 86_400_000,
      claimType: 'WARRANTY',
    }))).toMatchObject({ eligible: true, selectedWindowSeconds: 90 * 86_400 })
  })

  it('fails closed for chronology, zero windows, invalid purchase state, and unsafe arithmetic', () => {
    expect(evaluateClaimEligibility(input({ claimTimeMs: PURCHASE_TIME - 1 })))
      .toMatchObject({ eligible: false, rules: { chronologyValid: false } })
    expect(evaluateClaimEligibility(input({ returnWindowSeconds: 0 })))
      .toMatchObject({ deadlineMs: null, eligible: false, rules: { windowAvailable: false } })
    expect(evaluateClaimEligibility(input({ passportActive: false }))).toMatchObject({ eligible: false })
    expect(() => evaluateClaimEligibility(input({ purchaseTimeMs: Number.MAX_SAFE_INTEGER })))
      .toThrow(/safe/iu)
  })
})
