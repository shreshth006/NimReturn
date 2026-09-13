import { describe, expect, it } from 'vitest'

import { NimiqRpcError, normalizeRpcTransaction } from '../../server/rpc/nimiq-rpc.js'

function textToHex(value: string): string {
  return Array.from(new TextEncoder().encode(value), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

describe('Nimiq RPC normalization', () => {
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
    }, 'TestAlbatross')

    expect(result).toMatchObject({
      data: tag,
      state: 'confirmed',
      network: 'TestAlbatross',
      valueLuna: 1,
    })
  })

  it('fails closed when the RPC omits a verification field', () => {
    expect(() => normalizeRpcTransaction({ hash: 'ab'.repeat(32) }, 'TestAlbatross')).toThrow(NimiqRpcError)
  })
})
