import type { NimiqProvider } from '@nimiq/mini-app-sdk'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  assertWalletOnExpectedNetwork,
  fetchNetworkStatus,
  walletMatchesNetwork,
  WALLET_HEAD_TOLERANCE_BLOCKS,
} from '../../src/lib/nimiq/network-gate.js'

function provider(blockNumber: number, consensus = true) {
  const sign = vi.fn()
  const sendBasicTransactionWithData = vi.fn()
  return {
    provider: {
      getBlockNumber: () => Promise.resolve(blockNumber),
      isConsensusEstablished: () => Promise.resolve(consensus),
      sendBasicTransactionWithData,
      sign,
    } as unknown as NimiqProvider,
    sendBasicTransactionWithData,
    sign,
  }
}

const testnet = (headBlockNumber: number | null) => () => Promise.resolve({
  expectedNetwork: 'TestAlbatross',
  headBlockNumber,
  label: 'Nimiq Testnet',
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('wallet network gate', () => {
  it('accepts only wallet heads within the tolerance window', () => {
    expect(walletMatchesNetwork(11_600_000, 11_600_000)).toBe(true)
    expect(walletMatchesNetwork(11_600_000 + WALLET_HEAD_TOLERANCE_BLOCKS, 11_600_000)).toBe(true)
    expect(walletMatchesNetwork(11_600_000 - WALLET_HEAD_TOLERANCE_BLOCKS - 1, 11_600_000)).toBe(false)
    expect(walletMatchesNetwork(60_000_000, 11_600_000)).toBe(false)
  })

  it('returns the wallet snapshot on the expected network without prompting', async () => {
    const wallet = provider(11_600_010)
    await expect(assertWalletOnExpectedNetwork(wallet.provider, testnet(11_600_000)))
      .resolves.toEqual({ blockNumber: 11_600_010, consensus: true })
    expect(wallet.sign).not.toHaveBeenCalled()
    expect(wallet.sendBasicTransactionWithData).not.toHaveBeenCalled()
  })

  it('blocks a wallet on another network with a switch instruction', async () => {
    const wallet = provider(60_000_000)
    await expect(assertWalletOnExpectedNetwork(wallet.provider, testnet(11_600_000))).rejects.toMatchObject({
      kind: 'wrong-network',
      message: expect.stringContaining('Switch Nimiq Pay to Nimiq Testnet') as unknown,
    })
    expect(wallet.sign).not.toHaveBeenCalled()
  })

  it('fails closed when the expected network head cannot be read', async () => {
    const wallet = provider(11_600_000)
    await expect(assertWalletOnExpectedNetwork(wallet.provider, testnet(null)))
      .rejects.toMatchObject({ kind: 'network-unverified' })
    await expect(assertWalletOnExpectedNetwork(wallet.provider, () => Promise.reject(new Error('offline'))))
      .rejects.toMatchObject({ kind: 'network-unverified' })
    expect(wallet.sign).not.toHaveBeenCalled()
  })

  it('still refuses a wallet without consensus', async () => {
    const wallet = provider(11_600_000, false)
    await expect(assertWalletOnExpectedNetwork(wallet.provider, testnet(11_600_000)))
      .rejects.toMatchObject({ kind: 'consensus-unavailable' })
  })

  it('strictly parses the server network status and rejects failed responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      expectedNetwork: 'TestAlbatross',
      headBlockNumber: 11_600_000,
      label: 'Nimiq Testnet',
    }), { status: 200 })))
    await expect(fetchNetworkStatus()).resolves.toMatchObject({ headBlockNumber: 11_600_000 })

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      expectedNetwork: 'TestAlbatross',
      headBlockNumber: 11_600_000,
      label: 'Nimiq Testnet',
    }), { status: 503 })))
    await expect(fetchNetworkStatus()).rejects.toThrow('invalid network status')
  })
})
