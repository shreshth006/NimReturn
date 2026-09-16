import { z } from 'zod'

import { normalizeNimiqAddress } from '../crypto/nimiq-signature.js'
import { canonicalize } from './canonical-json.js'

export const MERCHANT_SESSION_CHALLENGE_TTL_MS = 5 * 60 * 1000

const PUBLIC_TOKEN_PATTERN = /^[A-Za-z0-9_-]{22}$/u
const LOWER_HEX_32_PATTERN = /^[0-9a-f]{64}$/u
const LOWER_HEX_64_PATTERN = /^[0-9a-f]{128}$/u

const audienceSchema = z.string().min(1).max(2_048).superRefine((value, context) => {
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== value) {
      context.addIssue({ code: 'custom', message: 'Audience must be an exact HTTP(S) origin.' })
    }
  } catch {
    context.addIssue({ code: 'custom', message: 'Audience must be a valid origin.' })
  }
})

const canonicalAddressSchema = z.string().superRefine((value, context) => {
  try {
    if (normalizeNimiqAddress(value) !== value) {
      context.addIssue({
        code: 'custom',
        message: 'Address must use canonical no-space uppercase form.',
      })
    }
  } catch {
    context.addIssue({ code: 'custom', message: 'Address must be a valid Nimiq address.' })
  }
})

const safeTimestampSchema = z.number().int().safe().nonnegative()

export const merchantSessionPayloadSchema = z.object({
  audience: audienceSchema,
  createdAt: safeTimestampSchema,
  expiresAt: safeTimestampSchema,
  merchantId: z.string().regex(PUBLIC_TOKEN_PATTERN),
  nonce: z.string().regex(PUBLIC_TOKEN_PATTERN),
  policySignerAddress: canonicalAddressSchema,
  type: z.literal('MERCHANT_SESSION'),
  version: z.literal(1),
}).strict().superRefine((payload, context) => {
  const lifetime = payload.expiresAt - payload.createdAt
  if (lifetime <= 0 || lifetime > MERCHANT_SESSION_CHALLENGE_TTL_MS) {
    context.addIssue({
      code: 'custom',
      message: 'Merchant session challenge lifetime must be at most five minutes.',
    })
  }
})

export const merchantSessionProofEnvelopeSchema = z.object({
  canonicalMessage: z.string().min(1).max(4_096),
  payloadHash: z.string().regex(LOWER_HEX_32_PATTERN),
  publicKey: z.string().regex(LOWER_HEX_32_PATTERN),
  signature: z.string().regex(LOWER_HEX_64_PATTERN),
}).strict()

export type MerchantSessionPayload = z.infer<typeof merchantSessionPayloadSchema>
export type MerchantSessionProofEnvelope = z.infer<typeof merchantSessionProofEnvelopeSchema>

export function buildMerchantSessionMessage(value: unknown): string {
  const payload = merchantSessionPayloadSchema.parse(value)
  return `NIMRETURN/AUTH/1/MERCHANT_SESSION\n${canonicalize({ ...payload })}`
}
