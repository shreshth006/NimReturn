import { z } from 'zod'

import { normalizeNimiqAddress } from '../crypto/nimiq-signature.js'
import { buildProtocolMessage } from './canonical-json.js'

export const MAX_POLICY_WINDOW_SECONDS = 5 * 365 * 24 * 60 * 60

const UTF8_ENCODER = new TextEncoder()
const PUBLIC_TOKEN_PATTERN = /^[A-Za-z0-9_-]{22}$/u
const LOWER_HEX_32_PATTERN = /^[0-9a-f]{64}$/u
const LOWER_HEX_64_PATTERN = /^[0-9a-f]{128}$/u

const publicTokenSchema = z.string().regex(PUBLIC_TOKEN_PATTERN)

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

const productNameSchema = z.string().superRefine((value, context) => {
  if (value !== value.trim() || value !== value.normalize('NFC')) {
    context.addIssue({ code: 'custom', message: 'Product name must be trimmed NFC text.' })
  }
  const containsControlCharacter = Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0)
    return codePoint !== undefined && (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f))
  })
  if (containsControlCharacter) {
    context.addIssue({ code: 'custom', message: 'Product name cannot contain control characters.' })
  }
  const codePointLength = Array.from(value).length
  if (codePointLength < 1 || codePointLength > 100) {
    context.addIssue({ code: 'custom', message: 'Product name must contain 1–100 code points.' })
  }
  if (UTF8_ENCODER.encode(value).byteLength > 256) {
    context.addIssue({ code: 'custom', message: 'Product name cannot exceed 256 UTF-8 bytes.' })
  }
})

const safeIntegerSchema = z.number().int().safe()

export const policyPayloadSchema = z.object({
  createdAt: safeIntegerSchema.nonnegative(),
  merchantId: publicTokenSchema,
  nonce: publicTokenSchema,
  policyId: publicTokenSchema,
  priceLuna: safeIntegerSchema.positive(),
  productId: publicTokenSchema,
  productName: productNameSchema,
  protocol: z.literal('NR1'),
  returnWindowSeconds: safeIntegerSchema.min(0).max(MAX_POLICY_WINDOW_SECONDS),
  settlementAddress: canonicalAddressSchema,
  type: z.literal('POLICY'),
  version: safeIntegerSchema.positive(),
  warrantyTransferAllowed: z.boolean(),
  warrantyWindowSeconds: safeIntegerSchema.min(0).max(MAX_POLICY_WINDOW_SECONDS),
}).strict()

export const policyProofEnvelopeSchema = z.object({
  canonicalMessage: z.string().min(1).max(4096),
  payloadHash: z.string().regex(LOWER_HEX_32_PATTERN),
  publicKey: z.string().regex(LOWER_HEX_32_PATTERN),
  signature: z.string().regex(LOWER_HEX_64_PATTERN),
}).strict()

export type PolicyPayload = z.infer<typeof policyPayloadSchema>
export type PolicyProofEnvelope = z.infer<typeof policyProofEnvelopeSchema>

export function parsePolicyPayload(value: unknown): PolicyPayload {
  return policyPayloadSchema.parse(value)
}

export function buildPolicyMessage(value: unknown): string {
  const payload = parsePolicyPayload(value)
  return buildProtocolMessage('POLICY', { ...payload })
}
