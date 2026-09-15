import type postgres from 'postgres'
import { z } from 'zod'

import { normalizeNimiqAddress } from '../../src/lib/crypto/nimiq-signature.js'
import { encodePurchaseTag } from '../../src/lib/protocol/transaction-data.js'
import {
  verifyObservedTransaction,
  type ObservedTransaction,
} from '../../src/lib/protocol/transaction-verification.js'
import {
  projectVerifiedPolicy,
  PublicProductReadError,
  type PublicProductRow,
} from './get-public-product.js'
import { PurchaseOrderError } from './purchase-order.js'

const publicTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{22}$/u)
const observedTransactionSchema = z.object({
  blockNumber: z.number().int().safe().nonnegative(),
  blockTimestamp: z.number().int().safe().nonnegative(),
  confirmations: z.number().int().safe().nonnegative().optional(),
  data: z.string().min(1).refine((value) => new TextEncoder().encode(value).byteLength <= 64),
  executionResult: z.boolean(),
  finality: z.object({
    finalizingBlockNumber: z.number().int().safe().nonnegative(),
    headBlockNumber: z.number().int().safe().nonnegative(),
    reached: z.boolean(),
  }).strict(),
  hash: z.string().regex(/^[0-9a-f]{64}$/u),
  network: z.string().min(1).max(24),
  recipient: z.string().min(1).max(64),
  sender: z.string().min(1).max(64),
  state: z.literal('finalized'),
  valueLuna: z.number().int().safe().positive(),
}).strict()

interface PurchasePassportRow extends PublicProductRow {
  chain_block_number: string
  chain_block_timestamp_ms: string
  chain_data_text: string
  chain_execution_result: boolean
  chain_finalizing_block_number: string
  chain_head_block_number: string
  chain_network: string
  chain_normalized_evidence: unknown
  chain_recipient: string
  chain_sender: string
  chain_transaction_hash: string
  chain_value_luna: string
  confirmation_policy: string
  order_expected_data: string
  order_public_id: string
  passport_buyer_address: string
  passport_created_at: Date
  passport_merchant_display_name: string
  passport_policy_hash: string
  passport_policy_version: number
  passport_price_luna: string
  passport_product_description: string
  passport_product_name: string
  passport_protocol_version: string
  passport_public_id: string
  passport_return_deadline: Date | null
  passport_settlement_recipient: string
  passport_status: 'active' | 'refunded'
  passport_warranty_deadline: Date | null
  purchase_time: Date
  purchase_verified_at: Date
  reconciliation_checked_at: Date | null
  reconciliation_outcome: 'confirmed' | 'exception' | 'inconclusive' | null
  reconciliation_reason: string | null
}

export interface PurchasePassportView {
  createdAt: Date
  deadlines: {
    return: Date | null
    warranty: Date | null
  }
  merchant: {
    displayName: string
    publicId: string
    settlementAddress: string
  }
  orderPublicId: string
  payment: {
    buyerAddress: string
    confirmationPolicy: string
    data: string
    executionResult: true
    finality: {
      finalizingBlockNumber: number
      headBlockNumber: number
      status: 'verified'
    }
    network: string
    purchaseTime: Date
    recipient: string
    transactionHash: string
    valueLuna: number
    verifiedAt: Date
  }
  policy: {
    payload: ReturnType<typeof projectVerifiedPolicy>['payload']
    payloadHash: string
    publicId: string
    signerAddress: string
    version: number
  }
  product: {
    description: string
    name: string
    publicId: string
  }
  protocol: 'NR1'
  publicId: string
  reconciliation: {
    checkedAt: Date | null
    reason: string
    status: 'confirmed' | 'exception' | 'inconclusive' | 'original-verification'
  }
  status: 'active' | 'refunded' | 'verification_exception'
}

function parseSafeInteger(value: string): number {
  if (!/^(0|[1-9][0-9]*)$/u.test(value)) {
    throw new PurchaseOrderError('EVIDENCE_INTEGRITY', 'Stored Passport evidence is invalid.')
  }
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) {
    throw new PurchaseOrderError('EVIDENCE_INTEGRITY', 'Stored Passport evidence is unsafe.')
  }
  return parsed
}

function expectedDeadline(purchaseTime: number, windowSeconds: number): number | null {
  if (windowSeconds === 0) return null
  const result = purchaseTime + windowSeconds * 1_000
  if (!Number.isSafeInteger(result)) {
    throw new PurchaseOrderError('EVIDENCE_INTEGRITY', 'Stored Passport deadline is unsafe.')
  }
  return result
}

export async function getPurchasePassport(
  client: postgres.Sql | postgres.TransactionSql,
  rawPassportPublicId: unknown,
): Promise<PurchasePassportView | null> {
  const passportPublicId = publicTokenSchema.safeParse(rawPassportPublicId)
  if (!passportPublicId.success) {
    throw new PurchaseOrderError('INVALID_REQUEST', 'The Passport identifier is invalid.')
  }

  const rows = await client<PurchasePassportRow[]>`
    select
      purchase_passports.public_id as passport_public_id,
      purchase_passports.status as passport_status,
      purchase_passports.original_buyer_address as passport_buyer_address,
      purchase_passports.product_name as passport_product_name,
      purchase_passports.product_description as passport_product_description,
      purchase_passports.merchant_display_name as passport_merchant_display_name,
      purchase_passports.policy_payload_hash as passport_policy_hash,
      purchase_passports.policy_version as passport_policy_version,
      purchase_passports.protocol_version as passport_protocol_version,
      purchase_passports.price_luna::text as passport_price_luna,
      purchase_passports.settlement_recipient as passport_settlement_recipient,
      purchase_passports.purchase_time,
      purchase_passports.return_deadline as passport_return_deadline,
      purchase_passports.warranty_deadline as passport_warranty_deadline,
      purchase_passports.created_at as passport_created_at,
      purchase_transactions.verified_at as purchase_verified_at,
      purchase_transactions.confirmation_policy,
      orders.public_id as order_public_id,
      orders.expected_data as order_expected_data,
      products.public_id as product_public_id,
      orders.policy_version_id as active_policy_version_id,
      products.description as product_description,
      merchants.public_id as merchant_public_id,
      merchants.display_name,
      merchants.policy_signer_address as merchant_policy_signer_address,
      policy_versions.public_id as policy_public_id,
      policy_versions.id as policy_version_id,
      policy_versions.payload,
      policy_versions.product_name,
      policy_versions.price_luna::text,
      policy_versions.return_window_seconds::text,
      policy_versions.warranty_window_seconds::text,
      policy_versions.warranty_transfer_allowed,
      policy_versions.protocol_version,
      policy_versions.challenge_nonce,
      policy_versions.canonical_message,
      policy_versions.payload_hash,
      policy_versions.settlement_address,
      policy_versions.version,
      policy_versions.signer_address as policy_signer_address,
      policy_versions.public_key as policy_public_key,
      policy_versions.signature as policy_signature,
      policy_versions.verified_at,
      chain_transactions.network as chain_network,
      chain_transactions.transaction_hash as chain_transaction_hash,
      chain_transactions.normalized_evidence as chain_normalized_evidence,
      chain_transactions.block_number::text as chain_block_number,
      chain_transactions.block_timestamp_ms::text as chain_block_timestamp_ms,
      chain_transactions.finalizing_block_number::text as chain_finalizing_block_number,
      chain_transactions.head_block_number::text as chain_head_block_number,
      chain_transactions.execution_result as chain_execution_result,
      chain_transactions.sender as chain_sender,
      chain_transactions.recipient as chain_recipient,
      chain_transactions.value_luna::text as chain_value_luna,
      chain_transactions.data_text as chain_data_text,
      latest_reconciliation.checked_at as reconciliation_checked_at,
      latest_reconciliation.outcome as reconciliation_outcome,
      latest_reconciliation.reason as reconciliation_reason
    from purchase_passports
    join orders on orders.id = purchase_passports.order_id
    join products on products.id = purchase_passports.product_id
    join merchants on merchants.id = purchase_passports.merchant_id
    join policy_versions on policy_versions.id = purchase_passports.policy_version_id
    join purchase_transactions on purchase_transactions.id = purchase_passports.purchase_transaction_id
    join chain_transactions on chain_transactions.id = purchase_transactions.chain_transaction_id
    left join lateral (
      select checked_at, outcome, reason
      from chain_reconciliations
      where chain_reconciliations.chain_transaction_id = chain_transactions.id
      order by checked_at desc, id desc
      limit 1
    ) latest_reconciliation on true
    where purchase_passports.public_id = ${passportPublicId.data}
      and chain_transactions.observed_state = 'finalized'
  `
  const row = rows[0]
  if (!row) return null

  let policy
  try {
    policy = projectVerifiedPolicy(row)
  } catch (error) {
    if (error instanceof PublicProductReadError) {
      throw new PurchaseOrderError('EVIDENCE_INTEGRITY', 'The purchase-bound policy failed verification.')
    }
    throw error
  }
  const observedResult = observedTransactionSchema.safeParse(row.chain_normalized_evidence)
  if (!observedResult.success) {
    throw new PurchaseOrderError('EVIDENCE_INTEGRITY', 'The stored chain evidence failed validation.')
  }
  const { confirmations, ...observedWithoutConfirmations } = observedResult.data
  const observed: ObservedTransaction = {
    ...observedWithoutConfirmations,
    ...(confirmations === undefined
      ? {}
      : { confirmations }),
  }
  const valueLuna = parseSafeInteger(row.passport_price_luna)
  const verification = verifyObservedTransaction({
    data: row.order_expected_data,
    hash: row.chain_transaction_hash,
    network: row.chain_network,
    recipient: row.passport_settlement_recipient,
    valueLuna,
  }, observed)
  const buyerAddress = normalizeNimiqAddress(row.passport_buyer_address)
  const chainSender = normalizeNimiqAddress(row.chain_sender)
  const chainRecipient = normalizeNimiqAddress(row.chain_recipient)
  const purchaseTimeMs = row.purchase_time.getTime()
  const returnDeadline = expectedDeadline(purchaseTimeMs, policy.payload.returnWindowSeconds)
  const warrantyDeadline = expectedDeadline(purchaseTimeMs, policy.payload.warrantyWindowSeconds)

  if (
    verification.outcome !== 'verified'
    || row.chain_execution_result !== true
    || parseSafeInteger(row.chain_block_number) !== observed.blockNumber
    || parseSafeInteger(row.chain_block_timestamp_ms) !== observed.blockTimestamp
    || parseSafeInteger(row.chain_finalizing_block_number) !== observed.finality.finalizingBlockNumber
    || parseSafeInteger(row.chain_head_block_number) !== observed.finality.headBlockNumber
    || chainSender !== normalizeNimiqAddress(observed.sender)
    || chainRecipient !== normalizeNimiqAddress(observed.recipient)
    || parseSafeInteger(row.chain_value_luna) !== observed.valueLuna
    || row.chain_data_text !== observed.data
    || row.order_expected_data !== encodePurchaseTag(row.order_public_id)
    || buyerAddress !== chainSender
    || row.passport_product_name !== policy.payload.productName
    || row.passport_policy_hash !== policy.proof.payloadHash
    || row.passport_policy_version !== policy.payload.version
    || row.passport_protocol_version !== policy.payload.protocol
    || valueLuna !== policy.payload.priceLuna
    || row.passport_settlement_recipient !== policy.payload.settlementAddress
    || purchaseTimeMs !== observed.blockTimestamp
    || (row.passport_return_deadline?.getTime() ?? null) !== returnDeadline
    || (row.passport_warranty_deadline?.getTime() ?? null) !== warrantyDeadline
  ) {
    throw new PurchaseOrderError('EVIDENCE_INTEGRITY', 'The stored Passport evidence is inconsistent.')
  }

  return {
    createdAt: row.passport_created_at,
    deadlines: {
      return: row.passport_return_deadline,
      warranty: row.passport_warranty_deadline,
    },
    merchant: {
      displayName: row.passport_merchant_display_name,
      publicId: row.merchant_public_id,
      settlementAddress: row.passport_settlement_recipient,
    },
    orderPublicId: row.order_public_id,
    payment: {
      buyerAddress,
      confirmationPolicy: row.confirmation_policy,
      data: row.chain_data_text,
      executionResult: true,
      finality: {
        finalizingBlockNumber: observed.finality.finalizingBlockNumber,
        headBlockNumber: observed.finality.headBlockNumber,
        status: 'verified',
      },
      network: row.chain_network,
      purchaseTime: row.purchase_time,
      recipient: chainRecipient,
      transactionHash: row.chain_transaction_hash,
      valueLuna,
      verifiedAt: row.purchase_verified_at,
    },
    policy: {
      payload: policy.payload,
      payloadHash: policy.proof.payloadHash,
      publicId: policy.publicId,
      signerAddress: policy.signerAddress,
      version: policy.payload.version,
    },
    product: {
      description: row.passport_product_description,
      name: row.passport_product_name,
      publicId: row.product_public_id,
    },
    protocol: 'NR1',
    publicId: row.passport_public_id,
    reconciliation: row.reconciliation_checked_at && row.reconciliation_outcome && row.reconciliation_reason
      ? {
          checkedAt: row.reconciliation_checked_at,
          reason: row.reconciliation_reason,
          status: row.reconciliation_outcome,
        }
      : {
          checkedAt: null,
          reason: 'The original independent verification established successful execution and macro-block finality.',
          status: 'original-verification',
        },
    status: row.reconciliation_outcome === 'exception'
      ? 'verification_exception'
      : row.passport_status,
  }
}
