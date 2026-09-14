import { createHmac, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'

const SESSION_DOMAIN = 'NIMRETURN/1/MERCHANT-SESSION\n'
const PUBLIC_TOKEN_PATTERN = /^[A-Za-z0-9_-]{22}$/u
const SESSION_TTL_MS = 8 * 60 * 60 * 1000

const claimsSchema = z.object({
  expiresAt: z.number().int().safe().positive(),
  merchantPublicId: z.string().regex(PUBLIC_TOKEN_PATTERN),
  version: z.literal(1),
}).strict()

function signEncodedClaims(secret: string, encodedClaims: string): Buffer {
  return createHmac('sha256', secret)
    .update(SESSION_DOMAIN)
    .update(encodedClaims)
    .digest()
}

export function createMerchantSessionToken(input: {
  merchantPublicId: string
  now?: Date
  secret: string
}): { expiresAt: Date; token: string } {
  const now = input.now ?? new Date()
  const claims = claimsSchema.parse({
    expiresAt: now.getTime() + SESSION_TTL_MS,
    merchantPublicId: input.merchantPublicId,
    version: 1,
  })
  const encodedClaims = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url')
  const signature = signEncodedClaims(input.secret, encodedClaims).toString('base64url')
  return {
    expiresAt: new Date(claims.expiresAt),
    token: `v1.${encodedClaims}.${signature}`,
  }
}

export function readMerchantSessionToken(input: {
  now?: Date
  secret: string
  token: string | undefined
}): { expiresAt: Date; merchantPublicId: string } | null {
  if (!input.token) return null
  const [version, encodedClaims, encodedSignature, ...remainder] = input.token.split('.')
  if (version !== 'v1' || !encodedClaims || !encodedSignature || remainder.length > 0) return null

  let suppliedSignature: Buffer
  let claimsValue: unknown
  try {
    suppliedSignature = Buffer.from(encodedSignature, 'base64url')
    claimsValue = JSON.parse(Buffer.from(encodedClaims, 'base64url').toString('utf8'))
  } catch {
    return null
  }
  const expectedSignature = signEncodedClaims(input.secret, encodedClaims)
  if (
    suppliedSignature.byteLength !== expectedSignature.byteLength
    || !timingSafeEqual(suppliedSignature, expectedSignature)
  ) {
    return null
  }

  const claims = claimsSchema.safeParse(claimsValue)
  if (!claims.success) return null
  const now = input.now ?? new Date()
  if (now.getTime() >= claims.data.expiresAt) return null
  return {
    expiresAt: new Date(claims.data.expiresAt),
    merchantPublicId: claims.data.merchantPublicId,
  }
}
