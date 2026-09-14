import { describe, expect, it } from 'vitest'

import {
  classifyRpcVerification,
  extractRpcObservedEvidence,
  isRpcRetryDisabled,
  rpcFailureState,
  rpcOutcomeLabel,
  rpcRetryLabel,
} from '../../src/features/diagnostics/rpc-verification.js'

const checkedAtUtc = '2026-09-14T10:00:00.000Z'

describe('Phase 0 RPC verification state', () => {
  it.each([
    ['pending-inclusion', 'Check again'],
    ['pending-finality', 'Recheck finality'],
    ['inconclusive', 'Retry independent lookup'],
    ['verified', 'Verify through server RPC'],
    ['invalid', 'Verify through server RPC'],
  ] as const)('keeps %s retryable after the request completes', (outcome, label) => {
    expect(isRpcRetryDisabled(true, false)).toBe(false)
    expect(rpcRetryLabel(outcome, false)).toBe(label)
  })

  it('disables retry only while the HTTP request is executing', () => {
    expect(isRpcRetryDisabled(true, true)).toBe(true)
    expect(rpcRetryLabel('pending-finality', true)).toBe('Checking…')
    expect(isRpcRetryDisabled(false, false)).toBe(true)
  })

  it('labels chain outcomes independently from request execution', () => {
    expect(rpcOutcomeLabel('pending-finality')).toBe('Waiting for finality')
    expect(rpcOutcomeLabel('pending-inclusion')).toBe('Waiting for inclusion')
    expect(rpcOutcomeLabel('inconclusive')).toBe('Inconclusive')
    expect(rpcOutcomeLabel('invalid')).toBe('Invalid')
    expect(rpcOutcomeLabel('verified')).toBeUndefined()
  })

  it.each([
    'pending-inclusion',
    'pending-finality',
    'verified',
    'invalid',
    'inconclusive',
  ] as const)('classifies a %s server outcome', (outcome) => {
    expect(classifyRpcVerification({
      body: { verification: { outcome, reason: `Result: ${outcome}` } },
      ok: true,
      status: 200,
    }, checkedAtUtc)).toEqual({
      detail: `Result: ${outcome}`,
      lastCheckedAtUtc: checkedAtUtc,
      outcome,
    })
  })

  it('makes an RPC transport failure inconclusive and retryable', () => {
    expect(rpcFailureState(checkedAtUtc)).toMatchObject({
      outcome: 'inconclusive',
      lastCheckedAtUtc: checkedAtUtc,
    })
    expect(isRpcRetryDisabled(true, false)).toBe(false)
  })

  it('reports observed sender membership only after the chain lookup', () => {
    const sender = 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000'
    const result = extractRpcObservedEvidence({
      observed: {
        blockNumber: 123,
        data: 'NR1:P:AAAAAAAAAAAAAAAAAAAAAA',
        executionResult: true,
        finality: {
          finalizingBlockNumber: 180,
          headBlockNumber: 179,
          reached: false,
        },
        recipient: 'NQ15 0000 0000 0000 0000 0000 0000 0000 0000',
        sender,
        valueLuna: 1_000,
      },
    }, [sender])

    expect(result).toMatchObject({
      executionResult: true,
      finalityReached: false,
      finalizingMacroBlock: 180,
      headBlock: 179,
      inclusionBlock: 123,
      observedSender: sender,
      observedValueLuna: 1_000,
      senderIsListedWalletAccount: true,
    })
  })
})
