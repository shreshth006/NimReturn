import { z } from 'zod'

const baseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/u, '') ?? ''
const publicTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{22}$/u)
const nimiqAddressSchema = z.string().regex(/^NQ[0-9A-HJ-NP-VXY]{34}$/u)
const hashSchema = z.string().regex(/^[0-9a-f]{64}$/u)
const isoDateSchema = z.string().datetime({ offset: true })

const apiErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
}).passthrough()

const countMetricSchema = z.object({
  definition: z.string().min(1).max(500),
  sampleSize: z.number().int().nonnegative().safe(),
  value: z.number().int().nonnegative().safe(),
}).strict()

const durationMetricSchema = z.object({
  definition: z.string().min(1).max(500),
  sampleSize: z.number().int().nonnegative().safe(),
  unit: z.literal('milliseconds'),
  value: z.number().int().nonnegative().safe().nullable(),
}).strict()

const promiseLedgerSchema = z.object({
  asOf: isoDateSchema,
  definitionsVersion: z.literal('promise-ledger-v1'),
  evidenceModel: z.object({
    chainTransactions: z.string().min(1).max(500),
    walletSignatures: z.string().min(1).max(500),
  }).strict(),
  merchant: z.object({
    displayName: z.string().min(1).max(80),
    policySignerAddress: nimiqAddressSchema,
    publicId: publicTokenSchema,
  }).strict(),
  metrics: z.object({
    approvedClaims: countMetricSchema,
    claimsFiled: countMetricSchema,
    eligibleClaims: countMetricSchema,
    ineligibleClaims: countMetricSchema,
    medianResolutionTime: durationMetricSchema,
    refundPending: countMetricSchema,
    rejectedClaims: countMetricSchema,
    unresolvedCases: countMetricSchema,
    verifiedPurchases: countMetricSchema,
    verifiedRefunds: countMetricSchema,
  }).strict(),
  products: z.array(z.object({
    name: z.string().min(1).max(100),
    payloadHash: hashSchema,
    policySignerAddress: nimiqAddressSchema,
    policyVersion: z.number().int().positive().safe(),
    priceLuna: z.number().int().positive().safe(),
    publicId: publicTokenSchema,
    settlementAddress: nimiqAddressSchema,
    verifiedAt: isoDateSchema,
  }).strict()).max(500),
}).strict().superRefine((ledger, context) => {
  const metrics = ledger.metrics
  if (metrics.eligibleClaims.value + metrics.ineligibleClaims.value !== metrics.claimsFiled.value) {
    context.addIssue({ code: 'custom', message: 'Claim eligibility totals do not reconcile.' })
  }
  if (metrics.approvedClaims.value + metrics.rejectedClaims.value + metrics.unresolvedCases.value !== metrics.claimsFiled.value) {
    context.addIssue({ code: 'custom', message: 'Claim decision totals do not reconcile.' })
  }
  if (metrics.refundPending.value + metrics.verifiedRefunds.value !== metrics.approvedClaims.value) {
    context.addIssue({ code: 'custom', message: 'Refund totals do not reconcile.' })
  }
  if ((metrics.medianResolutionTime.sampleSize === 0) !== (metrics.medianResolutionTime.value === null)) {
    context.addIssue({ code: 'custom', message: 'Resolution timing sample does not reconcile.' })
  }
})

export type PromiseLedger = z.infer<typeof promiseLedgerSchema>
export type PromiseLedgerCountMetric = z.infer<typeof countMetricSchema>

export class PromiseLedgerApiError extends Error {
  override readonly name = 'PromiseLedgerApiError'

  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

export async function getPromiseLedger(merchantPublicId: string): Promise<PromiseLedger> {
  const response = await fetch(
    `${baseUrl}/api/v1/merchants/${publicTokenSchema.parse(merchantPublicId)}/promise-ledger`,
    { headers: { accept: 'application/json' } },
  )
  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new PromiseLedgerApiError(
      'INVALID_API_RESPONSE',
      'NimReturn returned an unreadable Promise Ledger.',
      response.status,
    )
  }
  if (!response.ok) {
    const parsed = apiErrorSchema.safeParse(body)
    throw new PromiseLedgerApiError(
      parsed.success ? parsed.data.code : 'REQUEST_FAILED',
      parsed.success ? parsed.data.message : 'The Promise Ledger could not be loaded.',
      response.status,
    )
  }
  const parsed = promiseLedgerSchema.safeParse(body)
  if (!parsed.success) {
    throw new PromiseLedgerApiError(
      'INVALID_API_RESPONSE',
      'The Promise Ledger did not reconcile to its published definitions.',
      response.status,
    )
  }
  return parsed.data
}
