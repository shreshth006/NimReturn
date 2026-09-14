import { z } from 'zod'

import {
  policyPayloadSchema,
  policyProofEnvelopeSchema,
} from '../protocol/policy.js'

const baseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/u, '') ?? ''
const publicTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{22}$/u)
const isoDateSchema = z.string().refine((value) => !Number.isNaN(Date.parse(value)))

const apiErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
}).passthrough()

const createdMerchantSchema = z.object({
  bootstrapExpiresAt: isoDateSchema,
  merchant: z.object({
    displayName: z.string().min(1),
    publicId: publicTokenSchema,
  }).strict(),
  product: z.object({
    name: z.string().min(1),
    publicId: publicTokenSchema,
  }).strict(),
}).strict()

const policyChallengeSchema = z.object({
  canonicalMessage: z.string().min(1),
  expiresAt: isoDateSchema,
  nonce: publicTokenSchema,
  payload: policyPayloadSchema,
  payloadHash: z.string().regex(/^[0-9a-f]{64}$/u),
}).strict()

const publishedPolicySchema = z.object({
  firstPolicyForMerchant: z.boolean(),
  productPublicId: publicTokenSchema,
  signerAddress: z.string().min(1).max(64),
  verified: z.literal(true),
}).strict()

const verifiedPolicySchema = z.object({
  payload: policyPayloadSchema,
  proof: policyProofEnvelopeSchema,
  publicId: publicTokenSchema,
  signerAddress: z.string().min(1).max(64),
  verifiedAt: isoDateSchema,
}).strict()

const publicProductSchema = z.object({
  merchant: z.object({
    displayName: z.string().min(1),
    publicId: publicTokenSchema,
  }).strict(),
  policy: verifiedPolicySchema,
  policyVersions: z.array(verifiedPolicySchema.extend({ active: z.boolean() })).min(1),
  product: z.object({ publicId: publicTokenSchema }).strict(),
}).strict()

const createMerchantInputSchema = z.object({
  defaultSettlementAddress: z.string().min(1).max(64),
  description: z.string().max(2_048).optional(),
  displayName: z.string().min(1).max(512),
  productName: z.string().min(1).max(512),
}).strict()

const policyTermsInputSchema = z.object({
  priceLuna: z.number().int().safe().positive(),
  returnWindowSeconds: z.number().int().safe().min(0).max(157_680_000),
  settlementAddress: z.string().min(1).max(64),
  warrantyTransferAllowed: z.boolean(),
  warrantyWindowSeconds: z.number().int().safe().min(0).max(157_680_000),
}).strict()

export type CreatedMerchant = z.infer<typeof createdMerchantSchema>
export type PolicyChallenge = z.infer<typeof policyChallengeSchema>
export type PublishedPolicy = z.infer<typeof publishedPolicySchema>
export type PublicVerifiedProduct = z.infer<typeof publicProductSchema>
export type CreateMerchantInput = z.infer<typeof createMerchantInputSchema>
export type PolicyTermsInput = z.infer<typeof policyTermsInputSchema>

export class MerchantApiError extends Error {
  override readonly name = 'MerchantApiError'

  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

async function requestJson<T>(
  path: string,
  schema: z.ZodType<T>,
  init?: RequestInit,
): Promise<T> {
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
  try {
    body = await response.json()
  } catch {
    throw new MerchantApiError(
      'INVALID_API_RESPONSE',
      'NimReturn returned an unreadable response.',
      response.status,
    )
  }
  if (!response.ok) {
    const parsedError = apiErrorSchema.safeParse(body)
    throw new MerchantApiError(
      parsedError.success ? parsedError.data.code : 'REQUEST_FAILED',
      parsedError.success ? parsedError.data.message : 'The merchant request failed.',
      response.status,
    )
  }

  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    throw new MerchantApiError(
      'INVALID_API_RESPONSE',
      'NimReturn returned a response that failed validation.',
      response.status,
    )
  }
  return parsed.data
}

export function createMerchant(input: CreateMerchantInput): Promise<CreatedMerchant> {
  return requestJson('/api/v1/merchants', createdMerchantSchema, {
    body: JSON.stringify(createMerchantInputSchema.parse(input)),
    method: 'POST',
  })
}

export function requestPolicyChallenge(input: {
  merchantPublicId: string
  productPublicId: string
  terms: PolicyTermsInput
}): Promise<PolicyChallenge> {
  const merchantPublicId = publicTokenSchema.parse(input.merchantPublicId)
  const productPublicId = publicTokenSchema.parse(input.productPublicId)
  return requestJson(
    `/api/v1/merchants/${merchantPublicId}/products/${productPublicId}/policies/challenges`,
    policyChallengeSchema,
    {
      body: JSON.stringify(policyTermsInputSchema.parse(input.terms)),
      method: 'POST',
    },
  )
}

export function publishPolicy(input: {
  challengeNonce: string
  merchantPublicId: string
  productPublicId: string
  proof: unknown
}): Promise<PublishedPolicy> {
  const merchantPublicId = publicTokenSchema.parse(input.merchantPublicId)
  const productPublicId = publicTokenSchema.parse(input.productPublicId)
  return requestJson(
    `/api/v1/merchants/${merchantPublicId}/products/${productPublicId}/policies/publish`,
    publishedPolicySchema,
    {
      body: JSON.stringify({
        challengeNonce: publicTokenSchema.parse(input.challengeNonce),
        proof: policyProofEnvelopeSchema.parse(input.proof),
      }),
      method: 'POST',
    },
  )
}

export function getPublicProduct(productPublicId: string): Promise<PublicVerifiedProduct> {
  return requestJson(
    `/api/v1/products/${publicTokenSchema.parse(productPublicId)}`,
    publicProductSchema,
  )
}
