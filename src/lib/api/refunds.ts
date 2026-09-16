import { z } from 'zod'

const baseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/u, '') ?? ''
const token = z.string().regex(/^[A-Za-z0-9_-]{22}$/u)
const hash = z.string().regex(/^[0-9a-f]{64}$/u)
const iso = z.string().datetime({ offset: true })
const apiError = z.object({ code: z.string().min(1), message: z.string().min(1) }).passthrough()
const state = z.enum([
  'payment_cancelled',
  'payment_failed',
  'payment_pending',
  'payment_requested',
  'payment_verifying',
  'refunded',
  'submission_outcome_unknown',
  'wallet_request_started',
])

const refundSchema = z.object({
  attempt: z.object({
    createdAt: iso,
    expectedPayment: z.object({
      data: z.string().regex(/^NR1:R:[A-Za-z0-9_-]{22}$/u),
      network: z.string().min(1).max(24),
      recipient: z.string().min(1).max(64),
      sender: z.string().min(1).max(64),
      valueLuna: z.number().int().positive().safe(),
    }).strict(),
    failureCode: z.string().min(1).max(50).nullable(),
    outcome: z.object({
      referenceHeight: z.number().int().nonnegative().safe().nullable(),
      ruledOutAt: iso.nullable(),
      ruledOutHeight: z.number().int().nonnegative().safe().nullable(),
      safeAfterHeight: z.number().int().nonnegative().safe().nullable(),
    }).strict(),
    publicId: token,
    recipientRule: z.enum(['claim-key-v2', 'purchase-sender-v1']),
    rowVersion: z.number().int().positive().safe(),
    state,
    transaction: z.object({
      blockNumber: z.number().int().nonnegative().safe().nullable(),
      blockTimestamp: z.number().int().nonnegative().safe().nullable(),
      executionResult: z.boolean().nullable(),
      finalizingBlockNumber: z.number().int().nonnegative().safe().nullable(),
      hash,
      headBlockNumber: z.number().int().nonnegative().safe().nullable(),
      observedState: z.enum(['absent', 'finalized', 'included', 'inconclusive', 'invalid', 'mempool']),
      reason: z.string().min(1),
      reconciliation: z.object({
        checkedAt: iso,
        outcome: z.enum(['confirmed', 'exception', 'inconclusive']),
        reason: z.string().min(1),
      }).strict().nullable(),
      recipient: z.string().min(1).max(64).nullable(),
      sender: z.string().min(1).max(64).nullable(),
      valueLuna: z.number().int().nonnegative().safe().nullable(),
    }).strict().nullable(),
    updatedAt: iso,
  }).strict().nullable(),
  claimPublicId: token,
  decision: z.literal('APPROVED'),
  passportPublicId: token,
  refund: z.object({ verifiedAt: iso }).strict().nullable(),
  resolutionPublicId: token,
}).strict()

const reconciliationSchema = z.discriminatedUnion('result', [
  z.object({ refund: refundSchema, result: z.literal('recovered'), transactionHash: hash }).strict(),
  z.object({ refund: refundSchema, result: z.literal('ruled-out') }).strict(),
  z.object({
    headBlockNumber: z.number().int().nonnegative().safe(),
    refund: refundSchema,
    result: z.literal('waiting'),
    safeAfterHeight: z.number().int().nonnegative().safe(),
  }).strict(),
])

export type Refund = z.infer<typeof refundSchema>
export type RefundReconciliation = z.infer<typeof reconciliationSchema>
export type RefundWalletEvent = 'submission-outcome-unknown' | 'wallet-cancelled' | 'wallet-request-started'

export class RefundApiError extends Error {
  override readonly name = 'RefundApiError'
  constructor(readonly code: string, message: string, readonly status: number) { super(message) }
}

async function request(path: string, init?: RequestInit): Promise<Refund> {
  return requestAs(path, refundSchema, init)
}

async function requestAs<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    credentials: 'include',
    headers: { accept: 'application/json', ...(init?.body ? { 'content-type': 'application/json' } : {}) },
  })
  let body: unknown
  try { body = await response.json() } catch {
    throw new RefundApiError('INVALID_API_RESPONSE', 'NimReturn returned an unreadable refund response.', response.status)
  }
  if (!response.ok) {
    const parsed = apiError.safeParse(body)
    throw new RefundApiError(parsed.success ? parsed.data.code : 'REQUEST_FAILED', parsed.success ? parsed.data.message : 'The refund request failed.', response.status)
  }
  const parsed = schema.safeParse(body)
  if (!parsed.success) throw new RefundApiError('INVALID_API_RESPONSE', 'NimReturn returned refund evidence that failed validation.', response.status)
  return parsed.data
}

function basePath(merchantPublicId: string, claimPublicId: string): string {
  return `/api/v1/merchants/${token.parse(merchantPublicId)}/claims/${token.parse(claimPublicId)}/refunds`
}

export function getRefund(claimPublicId: string): Promise<Refund> {
  return request(`/api/v1/claims/${token.parse(claimPublicId)}/refund`)
}

export function createRefund(merchantPublicId: string, claimPublicId: string): Promise<Refund> {
  return request(basePath(merchantPublicId, claimPublicId), { body: '{}', method: 'POST' })
}

export function recordRefundState(
  merchantPublicId: string,
  claimPublicId: string,
  attemptPublicId: string,
  event: RefundWalletEvent,
): Promise<Refund> {
  return request(`${basePath(merchantPublicId, claimPublicId)}/${token.parse(attemptPublicId)}/wallet-state`, {
    body: JSON.stringify({ event }),
    method: 'POST',
  })
}

export function attachRefundTransaction(
  merchantPublicId: string,
  claimPublicId: string,
  attemptPublicId: string,
  transactionHash: string,
): Promise<Refund> {
  return request(`${basePath(merchantPublicId, claimPublicId)}/${token.parse(attemptPublicId)}/transactions`, {
    body: JSON.stringify({ hash: hash.parse(transactionHash) }),
    method: 'POST',
  })
}

export function recheckRefund(
  merchantPublicId: string,
  claimPublicId: string,
  attemptPublicId: string,
): Promise<Refund> {
  return request(`${basePath(merchantPublicId, claimPublicId)}/${token.parse(attemptPublicId)}/recheck`, {
    body: '{}',
    method: 'POST',
  })
}

export function reconcileRefundOutcome(
  merchantPublicId: string,
  claimPublicId: string,
  attemptPublicId: string,
): Promise<RefundReconciliation> {
  return requestAs(
    `${basePath(merchantPublicId, claimPublicId)}/${token.parse(attemptPublicId)}/reconcile`,
    reconciliationSchema,
    { body: '{}', method: 'POST' },
  )
}
