import { afterEach, describe, expect, it, vi } from 'vitest'

import { NimiqRpcClient, NimiqRpcError, normalizeRpcTransaction } from '../../server/rpc/nimiq-rpc.js'

function textToHex(value: string): string {
  return Array.from(new TextEncoder().encode(value), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

describe('Nimiq RPC normalization', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('normalizes the current provider-shaped transaction fields and hex data', () => {
    const tag = 'NR1:P:AAAAAAAAAAAAAAAAAAAAAA'
    const result = normalizeRpcTransaction({
      hash: 'ab'.repeat(32),
      from: 'NQ00 TEST',
      to: 'NQ01 TEST',
      value: 1,
      recipientData: textToHex(tag),
      blockNumber: 123,
      confirmations: 2,
      executionResult: true,
    }, {
      finalizingBlockNumber: 180,
      headBlockNumber: 180,
      network: 'TestAlbatross',
    })

    expect(result).toMatchObject({
      data: tag,
      executionResult: true,
      state: 'finalized',
      network: 'TestAlbatross',
      valueLuna: 1,
    })
  })

  it('does not treat confirmations as finality before the next macro block', () => {
    const tag = 'NR1:P:AAAAAAAAAAAAAAAAAAAAAA'
    const result = normalizeRpcTransaction({
      hash: 'ab'.repeat(32),
      from: 'NQ00 TEST',
      to: 'NQ01 TEST',
      value: 1,
      recipientData: textToHex(tag),
      blockNumber: 123,
      confirmations: 56,
      executionResult: true,
    }, {
      finalizingBlockNumber: 180,
      headBlockNumber: 179,
      network: 'TestAlbatross',
    })

    expect(result.state).toBe('included')
    expect(result.finality).toEqual({
      finalizingBlockNumber: 180,
      headBlockNumber: 179,
      reached: false,
    })
  })

  it('fails closed when executionResult is missing', () => {
    const tag = 'NR1:P:AAAAAAAAAAAAAAAAAAAAAA'
    expect(() => normalizeRpcTransaction({
      hash: 'ab'.repeat(32),
      from: 'NQ00 TEST',
      to: 'NQ01 TEST',
      value: 1,
      recipientData: textToHex(tag),
      blockNumber: 123,
    }, {
      finalizingBlockNumber: 180,
      headBlockNumber: 180,
      network: 'TestAlbatross',
    })).toThrow(NimiqRpcError)
  })

  it('fails closed when the RPC omits a verification field', () => {
    expect(() => normalizeRpcTransaction({ hash: 'ab'.repeat(32) }, {
      finalizingBlockNumber: 180,
      headBlockNumber: 180,
      network: 'TestAlbatross',
    })).toThrow(NimiqRpcError)
  })

  it('retrieves the live head shape without exposing transport metadata', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({
      jsonrpc: '2.0',
      result: {
        data: { network: 'TestAlbatross', number: 123 },
        metadata: null,
      },
      id: 'test',
    }), { status: 200 }))))

    const client = new NimiqRpcClient('https://rpc.test.invalid')
    await expect(client.getHead()).resolves.toEqual({
      blockNumber: 123,
      network: 'TestAlbatross',
    })
  })
})
