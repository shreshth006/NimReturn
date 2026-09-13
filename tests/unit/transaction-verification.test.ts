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
  sender,
  recipient,
  valueLuna: 1,
  data: 'NR1:P:AAAAAAAAAAAAAAAAAAAAAA',
}

const observed: ObservedTransaction = {
  ...expected,
  state: 'included',
  confirmations: 1,
}

describe('transaction verification', () => {
  it('accepts exact included evidence and address-format differences', () => {
    const compactSender = sender.replaceAll(' ', '')
    const result = verifyObservedTransaction(expected, { ...observed, sender: compactSender })
    expect(result.outcome).toBe('verified')
    expect(Object.values(result.checks).every(Boolean)).toBe(true)
  })

  it.each([
    ['network', { network: 'MainAlbatross' }],
    ['sender', { sender: recipient }],
    ['recipient', { recipient: sender }],
    ['value', { valueLuna: 2 }],
    ['data', { data: `${expected.data}x` }],
    ['hash', { hash: 'cd'.repeat(32) }],
  ])('rejects a wrong %s', (_name, change) => {
    const result = verifyObservedTransaction(expected, { ...observed, ...change })
    expect(result.outcome).toBe('invalid')
  })

  it('distinguishes pending and unknown state from verified', () => {
    expect(verifyObservedTransaction(expected, { ...observed, state: 'pending' }).outcome).toBe('pending')
    expect(verifyObservedTransaction(expected, { ...observed, state: 'unknown' }).outcome).toBe('inconclusive')
  })
})
