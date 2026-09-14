import { describe, expect, it } from 'vitest'

import {
  hashMerchantBootstrapCapability,
  issueMerchantBootstrapCapability,
  merchantBootstrapCapabilityMatches,
} from '../../server/domain/merchant-bootstrap.js'

describe('merchant bootstrap capabilities', () => {
  it('issues a 256-bit base64url capability and stores only its SHA-256 hash', () => {
    const first = issueMerchantBootstrapCapability()
    const second = issueMerchantBootstrapCapability()

    expect(first.capability).toMatch(/^[A-Za-z0-9_-]{43}$/u)
    expect(first.capabilityHash).toMatch(/^[0-9a-f]{64}$/u)
    expect(first.capabilityHash).toBe(hashMerchantBootstrapCapability(first.capability))
    expect(first.capability).not.toBe(second.capability)
    expect(first.capabilityHash).not.toBe(second.capabilityHash)
  })

  it('matches only the exact capability against a normalized stored hash', () => {
    const issued = issueMerchantBootstrapCapability()
    expect(merchantBootstrapCapabilityMatches(issued.capability, issued.capabilityHash)).toBe(true)
    expect(merchantBootstrapCapabilityMatches('A'.repeat(43), issued.capabilityHash)).toBe(false)
    expect(merchantBootstrapCapabilityMatches(issued.capability, 'AB'.repeat(32))).toBe(false)
  })

  it('rejects malformed or truncated capabilities', () => {
    expect(() => hashMerchantBootstrapCapability('short')).toThrow(/32-byte base64url/u)
    expect(merchantBootstrapCapabilityMatches('short', 'ab'.repeat(32))).toBe(false)
  })
})
