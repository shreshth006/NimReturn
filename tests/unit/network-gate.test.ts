import type { NimiqProvider } from '@nimiq/mini-app-sdk'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  assertWalletOnExpectedNetwork,
  fetchNetworkStatus,
  identifyWalletNetwork,
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

const bothNetworks = (testHead: number | null, mainHead: number | null) => () => Promise.resolve({
  expectedNetwork: 'TestAlbatross',
  headBlockNumber: testHead,
  label: 'Nimiq Testnet',
  networks: [
    { blockNumber: testHead, label: 'Nimiq Testnet', network: 'TestAlbatross' },
    { blockNumber: mainHead, label: 'Nimiq Mainnet', network: 'MainAlbatross' },
  ],
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('wallet network identification', () => {
  it('places a wallet on whichever verified chain its head matches', async () => {
    const onMainnet = provider(61_875_500)
    await expect(identifyWalletNetwork(onMainnet.provider, bothNetworks(11_600_000, 61_875_983)))
      .resolves.toEqual({
        label: 'Nimiq Mainnet',
        network: 'MainAlbatross',
        snapshot: { blockNumber: 61_875_500, consensus: true },
      })

    const onTestnet = provider(11_600_010)
    await expect(identifyWalletNetwork(onTestnet.provider, bothNetworks(11_600_000, 61_875_983)))
      .resolves.toMatchObject({ network: 'TestAlbatross' })
    expect(onMainnet.sign).not.toHaveBeenCalled()
    expect(onTestnet.sign).not.toHaveBeenCalled()
  })

  it('names every verified chain when the wallet is on none of them', async () => {
    const wallet = provider(999_999_999)
    await expect(identifyWalletNetwork(wallet.provider, bothNetworks(11_600_000, 61_875_983))).rejects.toMatchObject({
      kind: 'wrong-network',
      message: expect.stringContaining('Nimiq Testnet or Nimiq Mainnet') as unknown,
    })
  })

  it('skips a chain whose head could not be read, and fails closed when none can', async () => {
    const wallet = provider(61_875_500)
    await expect(identifyWalletNetwork(wallet.provider, bothNetworks(null, 61_875_983)))
      .resolves.toMatchObject({ network: 'MainAlbatross' })
    await expect(identifyWalletNetwork(wallet.provider, bothNetworks(null, null)))
      .rejects.toMatchObject({ kind: 'network-unverified' })
  })

  it('refuses to guess when one head matches two chains', async () => {
    const wallet = provider(11_600_000)
    await expect(identifyWalletNetwork(wallet.provider, bothNetworks(11_600_000, 11_600_100))).rejects.toMatchObject({
      kind: 'network-unverified',
    })
  })
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
