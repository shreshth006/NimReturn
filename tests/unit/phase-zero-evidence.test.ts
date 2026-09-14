import { describe, expect, it } from 'vitest'

import { buildPhaseZeroEvidence } from '../../src/features/diagnostics/evidence.js'

describe('Phase 0 evidence export', () => {
  it('records the exact UTF-8 signing bytes and public address-binding proof', () => {
    const evidence = buildPhaseZeroEvidence({
      capturedAtUtc: '2026-09-14T04:50:00.000Z',
      device: {
        nimiqPayVersion: 'test-version',
        osVersion: 'test-os',
        platform: 'Android',
        userAgent: 'test-agent',
      },
      network: { blockNumber: 123, consensus: true },
      rpcResult: null,
      selectedAccount: 'NQ00TEST',
      signatureMessage: 'NIMRETURN/1/DIAGNOSTIC\n{"value":"✓"}',
      signature: { publicKey: 'ab'.repeat(32), signature: 'cd'.repeat(64) },
      signatureVerification: {
        actualSignerAddress: 'NQ00 TEST',
        addressBindingValid: true,
        expectedMatchesSigner: true,
        payloadHash: 'ef'.repeat(32),
        signedMessageDigest: '12'.repeat(32),
        signatureValid: true,
        signerIsListedAccount: true,
        valid: true,
      },
      transaction: null,
    }) as Record<string, unknown>

    const signature = evidence.signature as Record<string, unknown>
    expect(signature.messageUtf8Hex).toBe(
      '4e494d52455455524e2f312f444941474e4f535449430a7b2276616c7565223a22e29c93227d',
    )
    expect(signature).toMatchObject({
      publicKey: 'ab'.repeat(32),
      signature: 'cd'.repeat(64),
    })
    expect(evidence.device).toEqual({
      nimiqPayVersion: 'test-version',
      osVersion: 'test-os',
      platform: 'Android',
      userAgent: 'test-agent',
    })
    expect(JSON.stringify(evidence)).not.toMatch(/private|seed/iu)
  })
})
