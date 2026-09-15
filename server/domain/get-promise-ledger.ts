import type postgres from 'postgres'
import { z } from 'zod'

const publicTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{22}$/u)

const DEFINITIONS = {
  approvedClaims: 'Claims with a final APPROVED attestation verified to the purchase-bound policy signer.',
  claimsFiled: 'Authorized wallet-signed claims with a current deterministic eligibility evaluation.',
  eligibleClaims: 'Filed claims whose current stored NR1 evaluation matched the purchase-bound policy.',
  ineligibleClaims: 'Filed claims whose current stored NR1 evaluation did not match the purchase-bound policy.',
  medianResolutionTime: 'Median time from verified claimant authorization to the verified policy-signer decision. Unresolved claims are excluded.',
  refundPending: 'Verified APPROVED decisions without a matching independently verified refund transaction.',
  rejectedClaims: 'Claims with a final REJECTED attestation verified to the purchase-bound policy signer.',
  unresolvedCases: 'Filed claims without a verified final policy-signer decision.',
  verifiedPurchases: 'Unique purchases with successful execution and following-macro finality, bound to a verified policy.',
  verifiedRefunds: 'Unique refunds with exact sender, recipient, value and tag, successful execution, and following-macro finality.',
} as const

type CountMetric = {
  definition: string
  sampleSize: number
  value: number
}

type DurationMetric = {
  definition: string
  sampleSize: number
  unit: 'milliseconds'
  value: number | null
}

export interface PromiseLedgerView {
  asOf: Date
  definitionsVersion: 'promise-ledger-v1'
  evidenceModel: {
    chainTransactions: string
    walletSignatures: string
  }
  merchant: {
    displayName: string
    policySignerAddress: string
    publicId: string
  }
  metrics: {
    approvedClaims: CountMetric
    claimsFiled: CountMetric
    eligibleClaims: CountMetric
    ineligibleClaims: CountMetric
    medianResolutionTime: DurationMetric
    refundPending: CountMetric
    rejectedClaims: CountMetric
    unresolvedCases: CountMetric
    verifiedPurchases: CountMetric
    verifiedRefunds: CountMetric
  }
  products: Array<{
    name: string
    payloadHash: string
    policySignerAddress: string
    policyVersion: number
    priceLuna: number
    publicId: string
    settlementAddress: string
    verifiedAt: Date
  }>
}

type LedgerRow = {
  approved_claims: number | string
  as_of: Date
  claims_filed: number | string
  eligible_claims: number | string
  ineligible_claims: number | string
  median_resolution_ms: number | string | null
  merchant_display_name: string
  merchant_public_id: string
  policy_signer_address: string | null
  refund_pending: number | string
  rejected_claims: number | string
  resolution_time_sample_size: number | string
  unresolved_claims: number | string
  verified_purchases: number | string
  verified_refunds: number | string
}

type ProductRow = {
  name: string
  payload_hash: string
  policy_signer_address: string
  policy_version: number
  price_luna: number | string
  public_id: string
  settlement_address: string
  verified_at: Date
}

export class PromiseLedgerReadError extends Error {
  override readonly name = 'PromiseLedgerReadError'

  constructor(
    readonly code: 'EVIDENCE_INTEGRITY' | 'INVALID_REQUEST',
    detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code)
  }
}

function safeInteger(value: number | string, label: string): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new PromiseLedgerReadError('EVIDENCE_INTEGRITY', label)
  }
  return parsed
}

function countMetric(value: number, sampleSize: number, definition: string): CountMetric {
  return { definition, sampleSize, value }
}

export async function getPromiseLedger(
  database: postgres.Sql,
  merchantPublicIdInput: string,
): Promise<PromiseLedgerView | null> {
  const parsedId = publicTokenSchema.safeParse(merchantPublicIdInput)
  if (!parsedId.success) throw new PromiseLedgerReadError('INVALID_REQUEST')

  const rows = await database<LedgerRow[]>`
    select ledger.*, transaction_timestamp() as as_of
    from promise_ledger_v1 ledger
    where ledger.merchant_public_id = ${parsedId.data}
      and ledger.policy_signer_address is not null
    limit 1
  `
  const row = rows[0]
  if (!row?.policy_signer_address) return null

  const products = await database<ProductRow[]>`
    select
      products.public_id,
      policies.product_name as name,
      policies.version as policy_version,
      policies.price_luna,
      policies.payload_hash,
      policies.signer_address as policy_signer_address,
      policies.settlement_address,
      policies.verified_at
    from products
    join merchants on merchants.id = products.merchant_id
    join policy_versions policies on policies.id = products.active_policy_version_id
    where merchants.public_id = ${parsedId.data}
      and merchants.status = 'active'
      and products.status = 'active'
      and policies.verification_status = 'verified'
      and policies.signer_address = merchants.policy_signer_address
      and policies.verified_at is not null
    order by policies.verified_at desc, products.public_id
  `

  const verifiedPurchases = safeInteger(row.verified_purchases, 'verified purchases')
  const claimsFiled = safeInteger(row.claims_filed, 'claims filed')
  const eligibleClaims = safeInteger(row.eligible_claims, 'eligible claims')
  const ineligibleClaims = safeInteger(row.ineligible_claims, 'ineligible claims')
  const approvedClaims = safeInteger(row.approved_claims, 'approved claims')
  const rejectedClaims = safeInteger(row.rejected_claims, 'rejected claims')
  const unresolvedCases = safeInteger(row.unresolved_claims, 'unresolved cases')
  const refundPending = safeInteger(row.refund_pending, 'refund pending')
  const verifiedRefunds = safeInteger(row.verified_refunds, 'verified refunds')
  const decisionCount = approvedClaims + rejectedClaims
  const resolutionSample = safeInteger(row.resolution_time_sample_size, 'resolution time sample')
  const medianResolution = row.median_resolution_ms === null
    ? null
    : safeInteger(row.median_resolution_ms, 'median resolution time')

  if (
    eligibleClaims + ineligibleClaims !== claimsFiled
    || approvedClaims + rejectedClaims + unresolvedCases !== claimsFiled
    || refundPending + verifiedRefunds !== approvedClaims
    || resolutionSample > decisionCount
    || (resolutionSample === 0) !== (medianResolution === null)
  ) {
    throw new PromiseLedgerReadError('EVIDENCE_INTEGRITY')
  }

  return {
    asOf: row.as_of,
    definitionsVersion: 'promise-ledger-v1',
    evidenceModel: {
      chainTransactions: 'Chain transactions are monetary evidence only after independent exact-field, execution, and finality verification.',
      walletSignatures: 'Wallet signatures are attestations. They do not prove that NIM moved.',
    },
    merchant: {
      displayName: row.merchant_display_name,
      policySignerAddress: row.policy_signer_address,
      publicId: row.merchant_public_id,
    },
    metrics: {
      approvedClaims: countMetric(approvedClaims, decisionCount, DEFINITIONS.approvedClaims),
      claimsFiled: countMetric(claimsFiled, verifiedPurchases, DEFINITIONS.claimsFiled),
      eligibleClaims: countMetric(eligibleClaims, claimsFiled, DEFINITIONS.eligibleClaims),
      ineligibleClaims: countMetric(ineligibleClaims, claimsFiled, DEFINITIONS.ineligibleClaims),
      medianResolutionTime: {
        definition: DEFINITIONS.medianResolutionTime,
        sampleSize: resolutionSample,
        unit: 'milliseconds',
        value: medianResolution,
      },
      refundPending: countMetric(refundPending, approvedClaims, DEFINITIONS.refundPending),
      rejectedClaims: countMetric(rejectedClaims, decisionCount, DEFINITIONS.rejectedClaims),
      unresolvedCases: countMetric(unresolvedCases, claimsFiled, DEFINITIONS.unresolvedCases),
      verifiedPurchases: countMetric(verifiedPurchases, verifiedPurchases, DEFINITIONS.verifiedPurchases),
      verifiedRefunds: countMetric(verifiedRefunds, approvedClaims, DEFINITIONS.verifiedRefunds),
    },
    products: products.map((product) => ({
      name: product.name,
      payloadHash: product.payload_hash,
      policySignerAddress: product.policy_signer_address,
      policyVersion: product.policy_version,
      priceLuna: safeInteger(product.price_luna, 'product price'),
      publicId: product.public_id,
      settlementAddress: product.settlement_address,
      verifiedAt: product.verified_at,
    })),
  }
}
