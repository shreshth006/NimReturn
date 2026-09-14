import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'

const LOWER_HEX_32_PATTERN = /^[0-9a-f]{64}$/u

export const merchantBootstrapCapabilitySchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/u)

export interface MerchantBootstrapCapability {
  capability: string
  capabilityHash: string
}

export function hashMerchantBootstrapCapability(capability: string): string {
  const parsed = merchantBootstrapCapabilitySchema.safeParse(capability)
  if (!parsed.success) {
    throw new TypeError('Merchant bootstrap capability must be 32-byte base64url data.')
  }
  return createHash('sha256').update(parsed.data, 'utf8').digest('hex')
}

export function issueMerchantBootstrapCapability(): MerchantBootstrapCapability {
  const capability = randomBytes(32).toString('base64url')
  return { capability, capabilityHash: hashMerchantBootstrapCapability(capability) }
}

export function merchantBootstrapCapabilityMatches(
  capability: string,
  expectedHash: string,
): boolean {
  if (!LOWER_HEX_32_PATTERN.test(expectedHash)) return false

  let actualHash: string
  try {
    actualHash = hashMerchantBootstrapCapability(capability)
  } catch {
    return false
  }
  return timingSafeEqual(Buffer.from(actualHash, 'hex'), Buffer.from(expectedHash, 'hex'))
}
