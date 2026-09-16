import type postgres from 'postgres'
import { z } from 'zod'

import { encodePurchaseTag } from '../../src/lib/protocol/transaction-data.js'
import {
  PurchaseOrderError,
  type PurchaseOrderState,
  type PurchaseOrderView,
} from './purchase-order.js'

const publicTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{22}$/u)

interface PurchaseOrderRow {
  block_number: string | null
  block_timestamp_ms: string | null
  buyer_address: string | null
  chain_sender: string | null
  claim_key_canonical_message: string | null
  claim_key_expires_at: Date | null
  claim_key_nonce: string | null
  claim_key_payload_hash: string | null
  claim_key_signer_address: string | null
  claim_key_verified_at: Date | null
  database_now: Date
  created_at: Date
  execution_result: boolean | null
  expected_data: string
  expected_recipient: string
  expected_value_luna: string
  expires_at: Date
  failure_code: string | null
  finalizing_block_number: string | null
  head_block_number: string | null
  merchant_display_name: string
  merchant_public_id: string
  network: string
  observed_state: NonNullable<PurchaseOrderView['transaction']>['observedState'] | null
  order_public_id: string
  passport_public_id: string | null
  payment_state: PurchaseOrderState
  policy_payload_hash: string
  policy_public_id: string
  policy_version: number
  product_description: string
  product_name: string
  product_public_id: string
  row_version: number
  reconciliation_checked_at: Date | null
  reconciliation_outcome: 'confirmed' | 'exception' | 'inconclusive' | null
  reconciliation_reason: string | null
  transaction_hash: string | null
  verification_reason: string | null
}

function parseSafeInteger(value: string | null): number | null {
  if (value === null) return null
  if (!/^(0|[1-9][0-9]*)$/u.test(value)) {
    throw new PurchaseOrderError('EVIDENCE_INTEGRITY', 'Stored purchase evidence is invalid.')
  }
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) {
    throw new PurchaseOrderError('EVIDENCE_INTEGRITY', 'Stored purchase evidence is unsafe.')
  }
  return parsed
}

export async function getPurchaseOrder(
  client: postgres.Sql | postgres.TransactionSql,
  rawOrderPublicId: unknown,
): Promise<PurchaseOrderView | null> {
  const orderPublicId = publicTokenSchema.safeParse(rawOrderPublicId)
  if (!orderPublicId.success) {
    throw new PurchaseOrderError('INVALID_REQUEST', 'The purchase identifier is invalid.')
  }

  const rows = await client<PurchaseOrderRow[]>`
    select
      orders.public_id as order_public_id,
      orders.product_name,
      orders.product_description,
      orders.merchant_display_name,
      orders.policy_payload_hash,
      orders.policy_version,
      orders.expected_recipient,
      orders.expected_value_luna::text,
      orders.expected_data,
      orders.network,
      orders.buyer_address,
      orders.payment_state,
      orders.failure_code,
      orders.expires_at,
      orders.row_version,
      orders.created_at,
      products.public_id as product_public_id,
      merchants.public_id as merchant_public_id,
      policy_versions.public_id as policy_public_id,
      chain_transactions.transaction_hash,
      chain_transactions.observed_state,
      chain_transactions.verification_reason,
      chain_transactions.block_number::text,
      chain_transactions.block_timestamp_ms::text,
      chain_transactions.finalizing_block_number::text,
      chain_transactions.head_block_number::text,
      chain_transactions.execution_result,
      chain_transactions.sender as chain_sender,
      latest_reconciliation.checked_at as reconciliation_checked_at,
      latest_reconciliation.outcome as reconciliation_outcome,
      latest_reconciliation.reason as reconciliation_reason,
      purchase_passports.public_id as passport_public_id,
      latest_claim_key.canonical_message as claim_key_canonical_message,
      latest_claim_key.expires_at as claim_key_expires_at,
      latest_claim_key.nonce as claim_key_nonce,
      latest_claim_key.payload_hash as claim_key_payload_hash,
      latest_claim_key.signer_address as claim_key_signer_address,
      latest_claim_key.verified_at as claim_key_verified_at,
      clock_timestamp() as database_now
    from orders
    join products on products.id = orders.product_id
    join merchants on merchants.id = orders.merchant_id
    join policy_versions on policy_versions.id = orders.policy_version_id
    left join chain_transactions
      on chain_transactions.purpose = 'purchase' and chain_transactions.resource_id = orders.id
    left join purchase_transactions on purchase_transactions.order_id = orders.id
    left join purchase_passports on purchase_passports.order_id = orders.id
    left join lateral (
      select checked_at, outcome, reason
      from chain_reconciliations
      where chain_reconciliations.chain_transaction_id = chain_transactions.id
      order by checked_at desc, id desc
      limit 1
    ) latest_reconciliation on true
    left join lateral (
      select canonical_message, expires_at, nonce, payload_hash, signer_address, verified_at
      from purchase_claim_keys
      where purchase_claim_keys.order_id = orders.id
      order by (verified_at is not null) desc, created_at desc, id desc
      limit 1
    ) latest_claim_key on true
    where orders.public_id = ${orderPublicId.data}
  `
  const row = rows[0]
  if (!row) return null
  if (row.expected_data !== encodePurchaseTag(row.order_public_id)) {
    throw new PurchaseOrderError('EVIDENCE_INTEGRITY', 'Stored purchase data binding is invalid.')
  }
  const valueLuna = parseSafeInteger(row.expected_value_luna)
  if (valueLuna === null || valueLuna <= 0) {
    throw new PurchaseOrderError('EVIDENCE_INTEGRITY', 'Stored purchase value is invalid.')
  }

  const transaction = row.transaction_hash && row.observed_state && row.verification_reason
    ? {
        blockNumber: parseSafeInteger(row.block_number),
        blockTimestamp: parseSafeInteger(row.block_timestamp_ms),
        executionResult: row.execution_result,
        finalizingBlockNumber: parseSafeInteger(row.finalizing_block_number),
        hash: row.transaction_hash,
        headBlockNumber: parseSafeInteger(row.head_block_number),
        observedState: row.observed_state,
        reason: row.verification_reason,
        reconciliation: row.reconciliation_checked_at && row.reconciliation_outcome && row.reconciliation_reason
          ? {
              checkedAt: row.reconciliation_checked_at,
              outcome: row.reconciliation_outcome,
              reason: row.reconciliation_reason,
            }
          : null,
        sender: row.chain_sender,
      }
    : null

  if (
    (row.payment_state === 'purchased' && (!row.buyer_address || !row.passport_public_id || transaction?.observedState !== 'finalized'))
    || (row.payment_state !== 'purchased' && (row.buyer_address || row.passport_public_id))
  ) {
    throw new PurchaseOrderError('EVIDENCE_INTEGRITY', 'Stored purchase lifecycle is inconsistent.')
  }

  const claimKey = row.claim_key_nonce && row.claim_key_canonical_message
    && row.claim_key_payload_hash && row.claim_key_expires_at
    ? {
        canonicalMessage: row.claim_key_canonical_message,
        expiresAt: row.claim_key_expires_at,
        nonce: row.claim_key_nonce,
        payloadHash: row.claim_key_payload_hash,
        signerAddress: row.claim_key_signer_address,
        status: row.claim_key_verified_at
          ? 'verified' as const
          : row.claim_key_expires_at <= row.database_now ? 'expired' as const : 'pending' as const,
        verifiedAt: row.claim_key_verified_at,
      }
    : null

  return {
    buyerAddress: row.buyer_address,
    claimKey,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    expectedPayment: {
      data: row.expected_data,
      network: row.network,
      recipient: row.expected_recipient,
      valueLuna,
    },
    failureCode: row.failure_code,
    merchant: {
      displayName: row.merchant_display_name,
      publicId: row.merchant_public_id,
    },
    paymentState: row.payment_state,
    passport: row.passport_public_id ? { publicId: row.passport_public_id } : null,
    policy: {
      payloadHash: row.policy_payload_hash,
      publicId: row.policy_public_id,
      version: row.policy_version,
    },
    product: {
      description: row.product_description,
      name: row.product_name,
      publicId: row.product_public_id,
    },
    publicId: row.order_public_id,
    rowVersion: row.row_version,
    transaction,
  }
}
