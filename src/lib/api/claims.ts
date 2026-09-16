import { z } from 'zod'

import { claimProofEnvelopeSchema } from '../protocol/claim.js'
import { resolutionProofEnvelopeSchema } from '../protocol/resolution.js'

const baseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/u, '') ?? ''
const publicTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{22}$/u)
const isoDateSchema = z.string().datetime({ offset: true })
const addressSchema = z.string().min(1).max(64)
const hashSchema = z.string().regex(/^[0-9a-f]{64}$/u)

const apiErrorSchema = z.object({ code: z.string().min(1), message: z.string().min(1) }).passthrough()
const claimWorkflowSchema = z.enum([
  'approved',
  'authorization_pending',
  'decision_pending',
  'eligible',
  'ineligible',
  'rejected',
  'signature_requested',
])
const claimSchema = z.object({
  authorization: z.object({
    canonicalMessage: z.string().min(1).nullable(),
    expiresAt: isoDateSchema.nullable(),
    mode: z.enum(['delegated', 'purchase_key', 'self']),
    nonce: publicTokenSchema.nullable(),
    publicId: publicTokenSchema,
    requiredSignerAddress: addressSchema,
    status: z.enum(['pending', 'verified']),
  }).strict().nullable(),
  challenge: z.object({
    canonicalMessage: z.string().min(1),
    expiresAt: isoDateSchema,
    nonce: publicTokenSchema,
  }).strict(),
  claimSignerAddress: addressSchema.nullable(),
  claimTime: isoDateSchema,
  claimType: z.enum(['RETURN', 'WARRANTY']),
  createdAt: isoDateSchema,
  eligibility: z.object({
    deadlineMs: z.number().int().safe().nonnegative().nullable(),
    eligible: z.boolean(),
    evaluatedAtMs: z.number().int().safe().nonnegative(),
    evaluatorVersion: z.string().min(1).max(40),
    rules: z.object({
      authorizationVerified: z.literal(true),
      chronologyValid: z.boolean(),
      passportActive: z.boolean(),
      purchaseVerified: z.boolean(),
      withinInclusiveDeadline: z.boolean(),
      windowAvailable: z.boolean(),
    }).strict(),
    selectedWindowSeconds: z.number().int().safe().nonnegative(),
  }).strict().nullable(),
  merchantPublicId: publicTokenSchema,
  orderPublicId: publicTokenSchema,
  passportPublicId: publicTokenSchema,
  payloadHash: hashSchema,
  policyVersion: z.number().int().positive().safe(),
  publicId: publicTokenSchema,
  purchaseSenderAddress: addressSchema,
  reasonCode: z.enum(['CHANGED_MIND', 'DEFECTIVE', 'NOT_AS_DESCRIBED', 'OTHER']),
  signatureStatus: z.enum(['expired', 'pending', 'verified']),
  workflowState: claimWorkflowSchema,
}).strict()

const resolutionSchema = z.object({
  approvedRefundLuna: z.number().int().safe().nonnegative(),
  canonicalMessage: z.string().min(1),
  claimPublicId: publicTokenSchema,
  createdAt: isoDateSchema,
  decision: z.enum(['APPROVED', 'REJECTED']),
  expiresAt: isoDateSchema,
  note: z.string().max(1_024),
  payloadHash: hashSchema,
  policySignerAddress: addressSchema,
  publicId: publicTokenSchema,
  reasonCode: z.enum(['INSUFFICIENT_INFORMATION', 'POLICY_ACCEPTED', 'POLICY_NOT_APPLICABLE', 'OTHER']),
  resolutionTime: isoDateSchema,
  signerAddress: addressSchema.nullable(),
  status: z.enum(['expired', 'pending', 'verified']),
  verifiedAt: isoDateSchema.nullable(),
}).strict()

const queueItemSchema = z.object({
  claim: z.object({
    claimSignerAddress: addressSchema,
    claimTime: isoDateSchema,
    claimType: z.enum(['RETURN', 'WARRANTY']),
    eligibility: z.enum(['eligible', 'ineligible']),
    note: z.string().max(1_024),
    publicId: publicTokenSchema,
    purchaseSenderAddress: addressSchema,
    reasonCode: z.enum(['CHANGED_MIND', 'DEFECTIVE', 'NOT_AS_DESCRIBED', 'OTHER']),
    workflowState: claimWorkflowSchema,
  }).strict(),
  passportPublicId: publicTokenSchema,
  productName: z.string().min(1).max(100),
  resolution: z.object({
    decision: z.enum(['APPROVED', 'REJECTED']),
    publicId: publicTokenSchema,
    status: z.enum(['expired', 'pending', 'verified']),
  }).strict().nullable(),
}).strict()

export type Claim = z.infer<typeof claimSchema>
export type ClaimResolution = z.infer<typeof resolutionSchema>
export type MerchantClaimQueueItem = z.infer<typeof queueItemSchema>

export class ClaimApiError extends Error {
  override readonly name = 'ClaimApiError'

  constructor(readonly code: string, message: string, readonly status: number) {
    super(message)
  }
}

async function requestJson<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      accept: 'application/json',
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...init?.headers,
    },
  })
  let body: unknown
  try { body = await response.json() } catch {
    throw new ClaimApiError('INVALID_API_RESPONSE', 'NimReturn returned an unreadable response.', response.status)
  }
  if (!response.ok) {
    const parsed = apiErrorSchema.safeParse(body)
    throw new ClaimApiError(
      parsed.success ? parsed.data.code : 'REQUEST_FAILED',
      parsed.success ? parsed.data.message : 'The claim request failed.',
      response.status,
    )
  }
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    throw new ClaimApiError('INVALID_API_RESPONSE', 'NimReturn returned claim evidence that failed validation.', response.status)
  }
  return parsed.data
}

export function createClaim(input: {
  claimType: 'RETURN' | 'WARRANTY'
  note?: string
  passportPublicId: string
  reasonCode: 'CHANGED_MIND' | 'DEFECTIVE' | 'NOT_AS_DESCRIBED' | 'OTHER'
}): Promise<Claim> {
  return requestJson(
    `/api/v1/passports/${publicTokenSchema.parse(input.passportPublicId)}/claims/challenges`,
    claimSchema,
    {
      body: JSON.stringify({
        claimType: input.claimType,
        ...(input.note === undefined ? {} : { note: input.note }),
        reasonCode: input.reasonCode,
      }),
      method: 'POST',
    },
  )
}

export function getClaim(claimPublicId: string): Promise<Claim> {
  return requestJson(`/api/v1/claims/${publicTokenSchema.parse(claimPublicId)}`, claimSchema)
}

export function submitClaim(claimPublicId: string, proof: unknown): Promise<Claim> {
  return requestJson(`/api/v1/claims/${publicTokenSchema.parse(claimPublicId)}/submit`, claimSchema, {
    body: JSON.stringify({ proof: claimProofEnvelopeSchema.parse(proof) }),
    method: 'POST',
  })
}

export function authorizeClaim(
  claimPublicId: string,
  authorizationPublicId: string,
  proof: unknown,
): Promise<Claim> {
  return requestJson(
    `/api/v1/claims/${publicTokenSchema.parse(claimPublicId)}/authorizations/${publicTokenSchema.parse(authorizationPublicId)}/submit`,
    claimSchema,
    { body: JSON.stringify({ proof: claimProofEnvelopeSchema.parse(proof) }), method: 'POST' },
  )
}

export function renewClaimAuthorization(claimPublicId: string): Promise<Claim> {
  return requestJson(
    `/api/v1/claims/${publicTokenSchema.parse(claimPublicId)}/authorizations`,
    claimSchema,
    { body: JSON.stringify({}), method: 'POST' },
  )
}

export function getResolution(claimPublicId: string): Promise<ClaimResolution> {
  return requestJson(`/api/v1/claims/${publicTokenSchema.parse(claimPublicId)}/resolution`, resolutionSchema)
}

export function getMerchantResolution(
  claimPublicId: string,
  merchantPublicId: string,
): Promise<ClaimResolution> {
  return requestJson(
    `/api/v1/merchants/${publicTokenSchema.parse(merchantPublicId)}/claims/${publicTokenSchema.parse(claimPublicId)}/resolution`,
    resolutionSchema,
  )
}

export function getMerchantClaims(merchantPublicId: string): Promise<MerchantClaimQueueItem[]> {
  return requestJson(
    `/api/v1/merchants/${publicTokenSchema.parse(merchantPublicId)}/claims`,
    z.object({ claims: z.array(queueItemSchema) }).strict(),
  ).then((result) => result.claims)
}

export function requestResolution(input: {
  claimPublicId: string
  decision: 'APPROVED' | 'REJECTED'
  merchantPublicId: string
  note?: string
  reasonCode: 'INSUFFICIENT_INFORMATION' | 'POLICY_ACCEPTED' | 'POLICY_NOT_APPLICABLE' | 'OTHER'
}): Promise<ClaimResolution> {
  return requestJson(
    `/api/v1/merchants/${publicTokenSchema.parse(input.merchantPublicId)}/claims/${publicTokenSchema.parse(input.claimPublicId)}/resolutions/challenges`,
    resolutionSchema,
    {
      body: JSON.stringify({
        decision: input.decision,
        ...(input.note === undefined ? {} : { note: input.note }),
        reasonCode: input.reasonCode,
      }),
      method: 'POST',
    },
  )
}

export function publishResolution(input: {
  claimPublicId: string
  merchantPublicId: string
  proof: unknown
  resolutionPublicId: string
}): Promise<ClaimResolution> {
  return requestJson(
    `/api/v1/merchants/${publicTokenSchema.parse(input.merchantPublicId)}/claims/${publicTokenSchema.parse(input.claimPublicId)}/resolutions/${publicTokenSchema.parse(input.resolutionPublicId)}/publish`,
    resolutionSchema,
    {
      body: JSON.stringify({ proof: resolutionProofEnvelopeSchema.parse(input.proof) }),
      method: 'POST',
    },
  )
}
