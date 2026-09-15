import { z } from 'zod'

import { policyPayloadSchema } from '../protocol/policy.js'

const baseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/u, '') ?? ''
const publicTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{22}$/u)
const transactionHashSchema = z.string().regex(/^[0-9a-f]{64}$/u)
const isoDateSchema = z.string().datetime({ offset: true })

const apiErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
}).passthrough()

const orderStateSchema = z.enum([
  'expired',
  'payment_cancelled',
  'payment_failed',
  'payment_pending',
  'payment_requested',
  'payment_verifying',
  'purchased',
  'submission_outcome_unknown',
  'wallet_request_started',
])

const purchaseOrderSchema = z.object({
  buyerAddress: z.string().min(1).max(64).nullable(),
  createdAt: isoDateSchema,
  expiresAt: isoDateSchema,
  expectedPayment: z.object({
    data: z.string().regex(/^NR1:P:[A-Za-z0-9_-]{22}$/u),
    network: z.string().min(1).max(24),
    recipient: z.string().min(1).max(64),
    valueLuna: z.number().int().positive().safe(),
  }).strict(),
  failureCode: z.string().min(1).max(50).nullable(),
  merchant: z.object({
    displayName: z.string().min(1).max(80),
    publicId: publicTokenSchema,
  }).strict(),
  passport: z.object({ publicId: publicTokenSchema }).strict().nullable(),
  paymentState: orderStateSchema,
  policy: z.object({
    payloadHash: z.string().regex(/^[0-9a-f]{64}$/u),
    publicId: publicTokenSchema,
    version: z.number().int().positive().safe(),
  }).strict(),
  product: z.object({
    description: z.string().max(500),
    name: z.string().min(1).max(100),
    publicId: publicTokenSchema,
  }).strict(),
  publicId: publicTokenSchema,
  rowVersion: z.number().int().positive().safe(),
  transaction: z.object({
    blockNumber: z.number().int().nonnegative().safe().nullable(),
    blockTimestamp: z.number().int().nonnegative().safe().nullable(),
    executionResult: z.boolean().nullable(),
    finalizingBlockNumber: z.number().int().nonnegative().safe().nullable(),
    hash: transactionHashSchema,
    headBlockNumber: z.number().int().nonnegative().safe().nullable(),
    observedState: z.enum(['absent', 'finalized', 'included', 'inconclusive', 'invalid', 'mempool']),
    reason: z.string().min(1),
    reconciliation: z.object({
      checkedAt: isoDateSchema,
      outcome: z.enum(['confirmed', 'exception', 'inconclusive']),
      reason: z.string().min(1),
    }).strict().nullable(),
    sender: z.string().min(1).max(64).nullable(),
  }).strict().nullable(),
}).strict()

const purchasePassportSchema = z.object({
  createdAt: isoDateSchema,
  deadlines: z.object({
    return: isoDateSchema.nullable(),
    warranty: isoDateSchema.nullable(),
  }).strict(),
  merchant: z.object({
    displayName: z.string().min(1).max(80),
    publicId: publicTokenSchema,
    settlementAddress: z.string().min(1).max(64),
  }).strict(),
  orderPublicId: publicTokenSchema,
  payment: z.object({
    buyerAddress: z.string().min(1).max(64),
    confirmationPolicy: z.literal('albatross-next-macro-v1'),
    data: z.string().regex(/^NR1:P:[A-Za-z0-9_-]{22}$/u),
    executionResult: z.literal(true),
    finality: z.object({
      finalizingBlockNumber: z.number().int().nonnegative().safe(),
      headBlockNumber: z.number().int().nonnegative().safe(),
      status: z.literal('verified'),
    }).strict(),
    network: z.string().min(1).max(24),
    purchaseTime: isoDateSchema,
    recipient: z.string().min(1).max(64),
    transactionHash: transactionHashSchema,
    valueLuna: z.number().int().positive().safe(),
    verifiedAt: isoDateSchema,
  }).strict(),
  policy: z.object({
    payload: policyPayloadSchema,
    payloadHash: z.string().regex(/^[0-9a-f]{64}$/u),
    publicId: publicTokenSchema,
    signerAddress: z.string().min(1).max(64),
    version: z.number().int().positive().safe(),
  }).strict(),
  product: z.object({
    description: z.string().max(500),
    name: z.string().min(1).max(100),
    publicId: publicTokenSchema,
  }).strict(),
  protocol: z.literal('NR1'),
  publicId: publicTokenSchema,
  reconciliation: z.object({
    checkedAt: isoDateSchema.nullable(),
    reason: z.string().min(1),
    status: z.enum(['confirmed', 'exception', 'inconclusive', 'original-verification']),
  }).strict(),
  status: z.enum(['active', 'refunded', 'verification_exception']),
}).strict()

const walletEventSchema = z.enum([
  'submission-outcome-unknown',
  'wallet-cancelled',
  'wallet-request-started',
])

export type PurchaseOrder = z.infer<typeof purchaseOrderSchema>
export type PurchasePassport = z.infer<typeof purchasePassportSchema>
export type PurchaseWalletEvent = z.infer<typeof walletEventSchema>

export class PurchaseApiError extends Error {
  override readonly name = 'PurchaseApiError'

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
    throw new PurchaseApiError('INVALID_API_RESPONSE', 'NimReturn returned an unreadable response.', response.status)
  }
  if (!response.ok) {
    const parsed = apiErrorSchema.safeParse(body)
    throw new PurchaseApiError(
      parsed.success ? parsed.data.code : 'REQUEST_FAILED',
      parsed.success ? parsed.data.message : 'The purchase request failed.',
      response.status,
    )
  }
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    throw new PurchaseApiError('INVALID_API_RESPONSE', 'NimReturn returned purchase data that failed validation.', response.status)
  }
  return parsed.data
}

export function createOrder(productPublicId: string): Promise<PurchaseOrder> {
  return requestJson(`/api/v1/products/${publicTokenSchema.parse(productPublicId)}/orders`, purchaseOrderSchema, {
    body: '{}',
    method: 'POST',
  })
}

export function getOrder(orderPublicId: string): Promise<PurchaseOrder> {
  return requestJson(`/api/v1/orders/${publicTokenSchema.parse(orderPublicId)}`, purchaseOrderSchema)
}

export function recordWalletState(
  orderPublicId: string,
  event: PurchaseWalletEvent,
): Promise<PurchaseOrder> {
  return requestJson(`/api/v1/orders/${publicTokenSchema.parse(orderPublicId)}/wallet-state`, purchaseOrderSchema, {
    body: JSON.stringify({ event: walletEventSchema.parse(event) }),
    method: 'POST',
  })
}

export function attachTransaction(orderPublicId: string, hash: string): Promise<PurchaseOrder> {
  return requestJson(`/api/v1/orders/${publicTokenSchema.parse(orderPublicId)}/transactions`, purchaseOrderSchema, {
    body: JSON.stringify({ hash: transactionHashSchema.parse(hash) }),
    method: 'POST',
  })
}

export function recheckTransaction(orderPublicId: string): Promise<PurchaseOrder> {
  return requestJson(`/api/v1/orders/${publicTokenSchema.parse(orderPublicId)}/verify`, purchaseOrderSchema, {
    body: '{}',
    method: 'POST',
  })
}

export function getPassport(passportPublicId: string): Promise<PurchasePassport> {
  return requestJson(`/api/v1/passports/${publicTokenSchema.parse(passportPublicId)}`, purchasePassportSchema)
}
