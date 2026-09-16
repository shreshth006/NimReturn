import { z } from 'zod'

import { normalizeNimiqAddress } from '../crypto/nimiq-signature.js'
import { buildProtocolMessage } from './canonical-json.js'

const UTF8_ENCODER = new TextEncoder()
const PUBLIC_TOKEN_PATTERN = /^[A-Za-z0-9_-]{22}$/u
const LOWER_HEX_32_PATTERN = /^[0-9a-f]{64}$/u
const LOWER_HEX_64_PATTERN = /^[0-9a-f]{128}$/u

const publicTokenSchema = z.string().regex(PUBLIC_TOKEN_PATTERN)
const safeTimestampSchema = z.number().int().safe().nonnegative()

const canonicalAddressSchema = z.string().superRefine((value, context) => {
  try {
    if (normalizeNimiqAddress(value) !== value) {
      context.addIssue({ code: 'custom', message: 'Address must use canonical no-space uppercase form.' })
    }
  } catch {
    context.addIssue({ code: 'custom', message: 'Address must be a valid Nimiq address.' })
  }
})

const noteSchema = z.string().superRefine((value, context) => {
  if (value !== value.trim() || value !== value.normalize('NFC')) {
    context.addIssue({ code: 'custom', message: 'Claim note must be trimmed NFC text.' })
  }
  const containsControlCharacter = Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0)
    return codePoint !== undefined && (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f))
  })
  if (containsControlCharacter) {
    context.addIssue({ code: 'custom', message: 'Claim note cannot contain control characters.' })
  }
  if (Array.from(value).length > 280) {
    context.addIssue({ code: 'custom', message: 'Claim note cannot exceed 280 code points.' })
  }
  if (UTF8_ENCODER.encode(value).byteLength > 1_024) {
    context.addIssue({ code: 'custom', message: 'Claim note cannot exceed 1,024 UTF-8 bytes.' })
  }
})

export const claimTypeSchema = z.enum(['RETURN', 'WARRANTY'])
export const claimReasonCodeSchema = z.enum([
  'CHANGED_MIND',
  'DEFECTIVE',
  'NOT_AS_DESCRIBED',
  'OTHER',
])

export const claimPayloadSchema = z.object({
  claimId: publicTokenSchema,
  claimType: claimTypeSchema,
  createdAt: safeTimestampSchema,
  nonce: publicTokenSchema,
  note: noteSchema,
  orderId: publicTokenSchema,
  protocol: z.literal('NR1'),
  purchaseSenderAddress: canonicalAddressSchema,
  reasonCode: claimReasonCodeSchema,
  type: z.literal('CLAIM'),
}).strict()

export const claimAuthorizationPayloadSchema = z.object({
  authorizationId: publicTokenSchema,
  claimId: publicTokenSchema,
  claimPayloadHash: z.string().regex(LOWER_HEX_32_PATTERN),
  claimSignerAddress: canonicalAddressSchema,
  createdAt: safeTimestampSchema,
  expiresAt: safeTimestampSchema,
  nonce: publicTokenSchema,
  protocol: z.literal('NR1'),
  purchaseSenderAddress: canonicalAddressSchema,
  type: z.literal('CLAIM_AUTHORIZATION'),
}).strict().superRefine((payload, context) => {
  if (payload.expiresAt <= payload.createdAt) {
    context.addIssue({ code: 'custom', message: 'Authorization expiry must follow creation.' })
  }
})

// Signed by the buyer's Nimiq Pay signing key before payment. Nimiq Pay may pay from a
// different account than it signs with, so this key, not the chain sender, is the
// claim authority for a purchase that was bound before its payment was requested.
export const purchaseClaimKeyPayloadSchema = z.object({
  createdAt: safeTimestampSchema,
  expiresAt: safeTimestampSchema,
  network: z.string().min(1).max(24),
  nonce: publicTokenSchema,
  orderId: publicTokenSchema,
  paymentData: z.string().min(1).max(64),
  policyPayloadHash: z.string().regex(LOWER_HEX_32_PATTERN),
  protocol: z.literal('NR1'),
  recipient: canonicalAddressSchema,
  type: z.literal('PURCHASE_CLAIM_KEY'),
  valueLuna: z.number().int().safe().positive(),
}).strict().superRefine((payload, context) => {
  if (payload.expiresAt <= payload.createdAt) {
    context.addIssue({ code: 'custom', message: 'Claim key expiry must follow creation.' })
  }
})

export const claimProofEnvelopeSchema = z.object({
  canonicalMessage: z.string().min(1).max(4_096),
  payloadHash: z.string().regex(LOWER_HEX_32_PATTERN),
  publicKey: z.string().regex(LOWER_HEX_32_PATTERN),
  signature: z.string().regex(LOWER_HEX_64_PATTERN),
}).strict()

export type ClaimType = z.infer<typeof claimTypeSchema>
export type ClaimReasonCode = z.infer<typeof claimReasonCodeSchema>
export type ClaimPayload = z.infer<typeof claimPayloadSchema>
export type ClaimAuthorizationPayload = z.infer<typeof claimAuthorizationPayloadSchema>
export type ClaimProofEnvelope = z.infer<typeof claimProofEnvelopeSchema>
export type PurchaseClaimKeyPayload = z.infer<typeof purchaseClaimKeyPayloadSchema>

export function buildPurchaseClaimKeyMessage(value: unknown): string {
  const payload = purchaseClaimKeyPayloadSchema.parse(value)
  return buildProtocolMessage('PURCHASE_CLAIM_KEY', { ...payload })
}

export function buildClaimMessage(value: unknown): string {
  const payload = claimPayloadSchema.parse(value)
  return buildProtocolMessage('CLAIM', { ...payload })
}

export function buildClaimAuthorizationMessage(value: unknown): string {
  const payload = claimAuthorizationPayloadSchema.parse(value)
  return buildProtocolMessage('CLAIM_AUTHORIZATION', { ...payload })
}
