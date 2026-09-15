import { z } from 'zod'

import { normalizeNimiqAddress } from '../crypto/nimiq-signature.js'
import { buildProtocolMessage } from './canonical-json.js'
import { claimProofEnvelopeSchema } from './claim.js'

const UTF8_ENCODER = new TextEncoder()
const publicTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{22}$/u)

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
    context.addIssue({ code: 'custom', message: 'Resolution note must be trimmed NFC text.' })
  }
  const containsControlCharacter = Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0)
    return codePoint !== undefined && (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f))
  })
  if (containsControlCharacter) {
    context.addIssue({ code: 'custom', message: 'Resolution note cannot contain control characters.' })
  }
  if (Array.from(value).length > 280 || UTF8_ENCODER.encode(value).byteLength > 1_024) {
    context.addIssue({ code: 'custom', message: 'Resolution note is too long.' })
  }
})

export const resolutionDecisionSchema = z.enum(['APPROVED', 'REJECTED'])
export const resolutionReasonCodeSchema = z.enum([
  'INSUFFICIENT_INFORMATION',
  'POLICY_ACCEPTED',
  'POLICY_NOT_APPLICABLE',
  'OTHER',
])

export const resolutionPayloadSchema = z.object({
  approvedRefundLuna: z.number().int().safe().nonnegative(),
  claimId: publicTokenSchema,
  createdAt: z.number().int().safe().nonnegative(),
  decision: resolutionDecisionSchema,
  nonce: publicTokenSchema,
  note: noteSchema,
  policySignerAddress: canonicalAddressSchema,
  protocol: z.literal('NR1'),
  reasonCode: resolutionReasonCodeSchema,
  type: z.literal('RESOLUTION'),
}).strict().superRefine((payload, context) => {
  if (payload.decision === 'APPROVED' && payload.approvedRefundLuna <= 0) {
    context.addIssue({ code: 'custom', message: 'An approved resolution requires a positive refund.' })
  }
  if (payload.decision === 'REJECTED' && payload.approvedRefundLuna !== 0) {
    context.addIssue({ code: 'custom', message: 'A rejected resolution cannot approve a refund.' })
  }
})

export const resolutionProofEnvelopeSchema = claimProofEnvelopeSchema

export type ResolutionPayload = z.infer<typeof resolutionPayloadSchema>
export type ResolutionDecision = z.infer<typeof resolutionDecisionSchema>
export type ResolutionReasonCode = z.infer<typeof resolutionReasonCodeSchema>

export function buildResolutionMessage(value: unknown): string {
  const payload = resolutionPayloadSchema.parse(value)
  return buildProtocolMessage('RESOLUTION', { ...payload })
}
