import { KeyPair, PrivateKey } from '@nimiq/core'
import { describe, expect, it } from 'vitest'

import {
  verifyObservedTransaction,
  type ExpectedTransaction,
  type ObservedTransaction,
} from '../../src/lib/protocol/transaction-verification.js'

function addressFromPrivateKey(hex: string): string {
  const privateKey = PrivateKey.fromHex(hex)
  const keyPair = KeyPair.derive(privateKey)
  const address = keyPair.toAddress()
  try {
    return address.toUserFriendlyAddress()
  } finally {
    address.free()
    keyPair.free()
    privateKey.free()
  }
}

const sender = addressFromPrivateKey('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f')
const recipient = addressFromPrivateKey('1f1e1d1c1b1a191817161514131211100f0e0d0c0b0a09080706050403020100')

const expected: ExpectedTransaction = {
  hash: 'ab'.repeat(32),
  network: 'TestAlbatross',
  recipient,
  valueLuna: 1,
  data: 'NR1:P:AAAAAAAAAAAAAAAAAAAAAA',
}

const observed: ObservedTransaction = {
  ...expected,
  sender,
  blockNumber: 123,
  blockTimestamp: 1_789_460_000_000,
  confirmations: 1,
  executionResult: true,
  finality: {
    finalizingBlockNumber: 180,
    headBlockNumber: 180,
    reached: true,
  },
  state: 'finalized',
}

describe('transaction verification', () => {
  it('accepts exact finalized evidence and address-format differences', () => {
    const compactSender = sender.replaceAll(' ', '')
    const result = verifyObservedTransaction(expected, { ...observed, sender: compactSender })
    expect(result.outcome).toBe('verified')
    expect(Object.values(result.checks).every(Boolean)).toBe(true)
  })

  it('rejects an included transaction whose executionResult is false', () => {
    const result = verifyObservedTransaction(expected, { ...observed, executionResult: false })
    expect(result.outcome).toBe('invalid')
    expect(result.checks.execution).toBe(false)
  })

  it('keeps an included transaction pending until its finalizing macro block', () => {
    const result = verifyObservedTransaction(expected, {
      ...observed,
      confirmations: 56,
      finality: {
        finalizingBlockNumber: 180,
        headBlockNumber: 179,
        reached: false,
      },
      state: 'included',
    })
    expect(result.outcome).toBe('pending-finality')
    expect(result.checks.finality).toBe(false)
  })

  it.each([
    ['network', { network: 'MainAlbatross' }],
    ['recipient', { recipient: sender }],
    ['value', { valueLuna: 2 }],
    ['data', { data: `${expected.data}x` }],
    ['hash', { hash: 'cd'.repeat(32) }],
  ])('rejects a wrong %s', (_name, change) => {
    const result = verifyObservedTransaction(expected, { ...observed, ...change })
    expect(result.outcome).toBe('invalid')
  })

  it('distinguishes pending and unknown state from verified', () => {
    expect(verifyObservedTransaction(expected, { ...observed, state: 'pending' }).outcome).toBe('pending-inclusion')
    expect(verifyObservedTransaction(expected, { ...observed, state: 'unknown' }).outcome).toBe('inconclusive')
  })

  it('takes the sender from observed chain evidence instead of client expectations', () => {
    expect(expected).not.toHaveProperty('sender')
    const result = verifyObservedTransaction(expected, { ...observed, sender })
    expect(result.outcome).toBe('verified')
    expect(observed.sender).toBe(sender)
  })

  it('rejects a malformed observed sender address', () => {
    const result = verifyObservedTransaction(expected, { ...observed, sender: 'NQ00 TEST' })
    expect(result.outcome).toBe('invalid')
    expect(result.checks.sender).toBe(false)
  })

  it('fails closed on an unsafe block timestamp', () => {
    const result = verifyObservedTransaction(expected, {
      ...observed,
      blockTimestamp: Number.MAX_SAFE_INTEGER + 1,
    })
    expect(result.outcome).toBe('inconclusive')
  })
})
