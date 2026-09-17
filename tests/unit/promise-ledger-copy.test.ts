import { describe, expect, it } from 'vitest'

import {
  CLAIM_AUTHORITY_DESCRIPTION,
  PROOF_STEPS,
} from '../../src/features/ledger/promise-ledger-copy.js'

describe('Promise Ledger protocol explanations', () => {
  it('describes the current claim-key refund rule without erasing the legacy path', () => {
    const refundStep = PROOF_STEPS.find(([title]) => title === 'Refund verified')

    expect(refundStep?.[2]).toContain('pre-payment claim key determines the refund destination')
    expect(refundStep?.[2]).toContain('legacy purchases retain the settlement-sender rule')
    expect(refundStep?.[2]).toContain('observed sender is recorded')
    expect(refundStep?.[2]).not.toContain('exact settlement-sender, buyer-recipient')
  })

  it('does not reduce current claim authority to the purchase transaction sender', () => {
    expect(CLAIM_AUTHORITY_DESCRIPTION).toContain('purchase-bound claim key')
    expect(CLAIM_AUTHORITY_DESCRIPTION).toContain('legacy purchaser-authorization path')
    expect(CLAIM_AUTHORITY_DESCRIPTION).not.toContain('exact equality with')
  })
})
