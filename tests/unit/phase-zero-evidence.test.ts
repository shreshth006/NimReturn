import { describe, expect, it } from 'vitest'

import { buildPhaseZeroEvidence } from '../../src/features/diagnostics/evidence.js'

describe('Phase 0 evidence export', () => {
  it('records the exact UTF-8 signing bytes and public address-binding proof', () => {
    const address = 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000'
    const evidence = buildPhaseZeroEvidence({
      capturedAtUtc: '2026-09-14T04:50:00.000Z',
      device: {
        nimiqPayVersion: 'test-version',
        osVersion: 'test-os',
        platform: 'Android',
        userAgent: 'test-agent',
      },
      expectedAccount: address,
      listedAccounts: [address],
      network: { blockNumber: 123, consensus: true },
      networkCheckedAtUtc: '2026-09-14T04:49:00.000Z',
      providerAvailable: true,
      rpcResult: {
        observed: {
          blockNumber: 123,
          data: 'NR1:P:AAAAAAAAAAAAAAAAAAAAAA',
          executionResult: true,
          finality: {
            finalizingBlockNumber: 180,
            headBlockNumber: 180,
            reached: true,
          },
          recipient: address,
          sender: address,
          valueLuna: 1_000,
        },
      },
      rpcVerification: {
        detail: 'Verified.',
        lastCheckedAtUtc: '2026-09-14T04:51:00.000Z',
        outcome: 'verified',
      },
      signatureMessage: 'NIMRETURN/1/DIAGNOSTIC\n{"value":"✓"}',
      signature: { publicKey: 'ab'.repeat(32), signature: 'cd'.repeat(64) },
      signatureVerification: {
        actualSignerAddress: address,
        addressBindingValid: true,
        expectedMatchesSigner: true,
        payloadHash: 'ef'.repeat(32),
        signedMessageDigest: '12'.repeat(32),
        signatureValid: true,
        signerIsListedAccount: true,
        valid: true,
      },
      transaction: {
        data: 'NR1:P:AAAAAAAAAAAAAAAAAAAAAA',
        hash: '34'.repeat(32),
        network: { blockNumber: 120, consensus: true },
        recipient: address,
        status: 'submitted',
        submittedAtUtc: '2026-09-14T04:48:00.000Z',
        validityStartHeight: 120,
        valueLuna: 1_000,
        walletAccounts: [address],
      },
    }) as Record<string, unknown>

    const signature = evidence.signature as Record<string, unknown>
    expect(evidence.format).toBe('nimreturn.phase0.evidence.v2')
    expect(signature.messageUtf8Hex).toBe(
      '4e494d52455455524e2f312f444941474e4f535449430a7b2276616c7565223a22e29c93227d',
    )
    expect(signature).toMatchObject({
      actualSignerAddress: address,
      addressBindingValid: true,
      expectedAccount: address,
      expectedMatchesSigner: true,
      nr1PayloadHash: 'ef'.repeat(32),
      publicKey: 'ab'.repeat(32),
      signature: 'cd'.repeat(64),
      signatureValid: true,
      signerIsListedAccount: true,
    })
    expect(evidence.device).toEqual({
      nimiqPayVersion: 'test-version',
      osVersion: 'test-os',
      platform: 'Android',
      userAgent: 'test-agent',
    })
    expect(JSON.stringify(evidence)).not.toMatch(/private|seed/iu)
    expect(JSON.stringify(evidence)).not.toContain('selectedAccount')
    expect(JSON.stringify(evidence)).not.toContain('expectedSender')

    expect(evidence.provider).toEqual({ available: true })
    expect(evidence.wallet).toEqual({ listedAccounts: [address] })
    expect(evidence.network).toEqual({
      blockNumber: 123,
      consensus: true,
      lastCheckedAtUtc: '2026-09-14T04:49:00.000Z',
    })
    expect(evidence.rpc).toMatchObject({
      executionResult: true,
      finalityReached: true,
      finalizingMacroBlock: 180,
      headBlock: 180,
      inclusionBlock: 123,
      observedData: 'NR1:P:AAAAAAAAAAAAAAAAAAAAAA',
      observedSender: address,
      observedValueLuna: 1_000,
      outcome: 'verified',
      senderIsListedWalletAccount: true,
    })
    expect(evidence.transaction).toEqual({
      data: 'NR1:P:AAAAAAAAAAAAAAAAAAAAAA',
      hash: '34'.repeat(32),
      networkSnapshot: { blockNumber: 120, consensus: true },
      recipient: address,
      submittedAtUtc: '2026-09-14T04:48:00.000Z',
      validityStartHeight: 120,
      valueLuna: 1_000,
      walletAccountsAtSubmission: [address],
    })
    expect(evidence.transaction).not.toHaveProperty('sender')
  })
})
