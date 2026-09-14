import type { NimiqProvider } from '@nimiq/mini-app-sdk'
import { describe, expect, it, vi } from 'vitest'

import {
  assertWalletConsensusForPayment,
  readProviderNetwork,
  sendTransactionWithData,
  WalletOperationError,
} from '../../src/lib/nimiq/provider.js'

function providerWithNetwork(consensus: boolean, blockNumber: number): NimiqProvider {
  return {
    getBlockNumber: vi.fn().mockResolvedValue(blockNumber),
    isConsensusEstablished: vi.fn().mockResolvedValue(consensus),
  } as unknown as NimiqProvider
}

describe('Nimiq provider network gate', () => {
  it('retains a valid head while reporting wallet consensus as false', async () => {
    await expect(readProviderNetwork(providerWithNetwork(false, 123_456))).resolves.toEqual({
      blockNumber: 123_456,
      consensus: false,
    })
  })

  it('blocks payment before a native request when consensus is false', () => {
    expect(() => assertWalletConsensusForPayment({ blockNumber: 123_456, consensus: false }))
      .toThrowError(
        new WalletOperationError(
          'consensus-unavailable',
          'The wallet provider is reachable and returned a head, but consensus is not established. No payment request was opened; wait and retry the network check.',
        ),
      )
  })

  it('never calls the native transaction method while consensus is false', async () => {
    const sendBasicTransactionWithData = vi.fn()
    const provider = { sendBasicTransactionWithData } as unknown as NimiqProvider

    await expect(
      sendTransactionWithData(
        provider,
        { blockNumber: 123_456, consensus: false },
        {
          data: 'NR1:P:AAAAAAAAAAAAAAAAAAAAAA',
          recipient: 'NQ00 TEST',
          validityStartHeight: 123_456,
          value: 1,
        },
      ),
    ).rejects.toMatchObject({ kind: 'consensus-unavailable' })
    expect(sendBasicTransactionWithData).not.toHaveBeenCalled()
  })

  it('permits the payment path only when wallet consensus is true', () => {
    expect(() => assertWalletConsensusForPayment({ blockNumber: 123_456, consensus: true }))
      .not.toThrow()
  })

  it('sends no invented sender field to the Mini App provider', async () => {
    const sendBasicTransactionWithData = vi.fn().mockResolvedValue('ab'.repeat(32))
    const provider = { sendBasicTransactionWithData } as unknown as NimiqProvider
    const request = {
      data: 'NR1:P:AAAAAAAAAAAAAAAAAAAAAA',
      recipient: 'NQ00 TEST',
      validityStartHeight: 123_456,
      value: 1_000,
    }

    await expect(
      sendTransactionWithData(
        provider,
        { blockNumber: 123_456, consensus: true },
        request,
      ),
    ).resolves.toBe('ab'.repeat(32))
    expect(request).not.toHaveProperty('sender')
    expect(sendBasicTransactionWithData).toHaveBeenCalledExactlyOnceWith(request)
  })
})
