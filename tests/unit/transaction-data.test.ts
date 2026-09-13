import { describe, expect, it } from 'vitest'

import {
  encodeBase64Url,
  encodePurchaseTag,
  encodeRefundTag,
  generateProtocolToken,
  isProtocolToken,
  parseTransactionTag,
  transactionTagByteLength,
} from '../../src/lib/protocol/transaction-data.js'

describe('NR1 transaction data', () => {
  const token = 'AAAAAAAAAAAAAAAAAAAAAA'

  it('encodes 16 bytes as an unpadded 22-character base64url token', () => {
    expect(encodeBase64Url(new Uint8Array(16))).toBe(token)
    const generated = generateProtocolToken()
    expect(generated).toHaveLength(22)
    expect(isProtocolToken(generated)).toBe(true)
  })

  it('encodes exact compact purchase and refund tags', () => {
    const purchase = encodePurchaseTag(token)
    const refund = encodeRefundTag(token)
    expect(purchase).toBe(`NR1:P:${token}`)
    expect(refund).toBe(`NR1:R:${token}`)
    expect(transactionTagByteLength(purchase)).toBe(28)
    expect(transactionTagByteLength(refund)).toBeLessThan(64)
  })

  it('parses exact tags and rejects suffixes, whitespace, and wrong versions', () => {
    expect(parseTransactionTag(`NR1:P:${token}`)).toEqual({ purpose: 'purchase', token })
    expect(parseTransactionTag(`NR1:R:${token}`)).toEqual({ purpose: 'refund', token })
    expect(parseTransactionTag(`NR1:P:${token}x`)).toBeNull()
    expect(parseTransactionTag(` NR1:P:${token}`)).toBeNull()
    expect(parseTransactionTag(`NR2:P:${token}`)).toBeNull()
    expect(() => encodePurchaseTag('short')).toThrow(/22-character/u)
  })
})
