import { describe, expect, it } from 'vitest'

import {
  createMerchantSessionToken,
  readMerchantSessionToken,
} from '../../server/http/merchant-session.js'

const SECRET = 'merchant-session-test-secret-with-more-than-32-bytes'
const MERCHANT_ID = 'AAAAAAAAAAAAAAAAAAAAAA'
const NOW = new Date('2026-09-15T12:00:00.000Z')

describe('merchant session tokens', () => {
  it('authenticates the exact merchant until the bounded expiry', () => {
    const issued = createMerchantSessionToken({
      merchantPublicId: MERCHANT_ID,
      now: NOW,
      secret: SECRET,
    })

    expect(readMerchantSessionToken({
      now: new Date(NOW.getTime() + 1),
      secret: SECRET,
      token: issued.token,
    })).toEqual({
      expiresAt: issued.expiresAt,
      merchantPublicId: MERCHANT_ID,
    })
    expect(issued.expiresAt.getTime() - NOW.getTime()).toBe(8 * 60 * 60 * 1000)
  })

  it('fails closed for changed claims, changed signatures, and another secret', () => {
    const { token } = createMerchantSessionToken({
      merchantPublicId: MERCHANT_ID,
      now: NOW,
      secret: SECRET,
    })
    const [version, claims, signature] = token.split('.')
    if (!version || !claims || !signature) throw new Error('Session token fixture was invalid.')

    for (const candidate of [
      `${version}.${claims.slice(0, -1)}A.${signature}`,
      `${version}.${claims}.${signature.slice(0, -1)}A`,
      token,
    ]) {
      expect(readMerchantSessionToken({
        now: NOW,
        secret: candidate === token ? `${SECRET}-other` : SECRET,
        token: candidate,
      })).toBeNull()
    }
  })

  it('rejects expired and malformed tokens without throwing', () => {
    const issued = createMerchantSessionToken({
      merchantPublicId: MERCHANT_ID,
      now: NOW,
      secret: SECRET,
    })

    expect(readMerchantSessionToken({
      now: issued.expiresAt,
      secret: SECRET,
      token: issued.token,
    })).toBeNull()
    expect(readMerchantSessionToken({ secret: SECRET, token: 'not-a-session' })).toBeNull()
    expect(readMerchantSessionToken({ secret: SECRET, token: undefined })).toBeNull()
  })
})
