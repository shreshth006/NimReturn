import { randomBytes, randomUUID } from 'node:crypto'
import type postgres from 'postgres'
import { z } from 'zod'

import { encodePurchaseTag } from '../../src/lib/protocol/transaction-data.js'
import {
  getPublicVerifiedProduct,
  PublicProductReadError,
} from './get-public-product.js'

const ORDER_TTL_MS = 20 * 60 * 1000
const PUBLIC_TOKEN_PATTERN = /^[A-Za-z0-9_-]{22}$/u

const createPurchaseOrderInputSchema = z.object({
  // The chain the buyer's wallet is on. It never selects the chain: it is checked
  // against the product's own chain so a mismatch fails before anything is signed.
  network: z.string().min(1).max(24).optional(),
  productPublicId: z.string().regex(PUBLIC_TOKEN_PATTERN),
}).strict()

interface BoundProductRow {
  active_policy_public_id: string
  active_policy_version_id: string
  description: string
  merchant_id: string
  network: string
  product_id: string
}

interface DatabaseNowRow {
  now: Date
}

interface CreatedOrderRow {
  id: string
}

export type PurchaseOrderState =
  | 'expired'
  | 'payment_cancelled'
  | 'payment_failed'
  | 'payment_pending'
  | 'payment_requested'
  | 'payment_verifying'
  | 'purchased'
  | 'submission_outcome_unknown'
  | 'wallet_request_started'

export interface PurchaseOrderView {
  buyerAddress: string | null
  claimKey: null | {
    canonicalMessage: string
    expiresAt: Date
    nonce: string
    payloadHash: string
    signerAddress: string | null
    status: 'expired' | 'pending' | 'verified'
    verifiedAt: Date | null
  }
  createdAt: Date
  expiresAt: Date
  expectedPayment: {
    data: string
    network: string
    recipient: string
    valueLuna: number
  }
  failureCode: string | null
  merchant: {
    displayName: string
    publicId: string
  }
  paymentState: PurchaseOrderState
  passport: null | { publicId: string }
  policy: {
    payloadHash: string
    publicId: string
    version: number
  }
  product: {
    description: string
    name: string
    publicId: string
  }
  publicId: string
  rowVersion: number
  transaction: null | {
    blockNumber: number | null
    blockTimestamp: number | null
    executionResult: boolean | null
    finalizingBlockNumber: number | null
    hash: string
    headBlockNumber: number | null
    observedState: 'absent' | 'finalized' | 'included' | 'inconclusive' | 'invalid' | 'mempool'
    reason: string
    reconciliation: null | {
      checkedAt: Date
      outcome: 'confirmed' | 'exception' | 'inconclusive'
      reason: string
    }
    sender: string | null
  }
}

export type PurchaseOrderErrorCode =
  | 'CLAIM_KEY_INVALID'
  | 'CLAIM_KEY_REQUIRED'
  | 'EVIDENCE_INTEGRITY'
  | 'INVALID_REQUEST'
  | 'NETWORK_MISMATCH'
  | 'ORDER_EXPIRED'
  | 'ORDER_NOT_FOUND'
  | 'PERSISTENCE_CONFLICT'
  | 'PRODUCT_NOT_AVAILABLE'
  | 'STATE_CONFLICT'

export class PurchaseOrderError extends Error {
  readonly code: PurchaseOrderErrorCode

  constructor(code: PurchaseOrderErrorCode, message: string) {
    super(message)
    this.name = 'PurchaseOrderError'
    this.code = code
  }
}

function fail(code: PurchaseOrderErrorCode, message: string): never {
  throw new PurchaseOrderError(code, message)
}

function requireOne<T>(rows: T[], code: PurchaseOrderErrorCode, message: string): T {
  const row = rows[0]
  if (!row) fail(code, message)
  return row
}

function generatePublicToken(): string {
  return randomBytes(16).toString('base64url')
}

export async function createPurchaseOrder(
  client: postgres.Sql,
  rawInput: unknown,
): Promise<PurchaseOrderView> {
  const inputResult = createPurchaseOrderInputSchema.safeParse(rawInput)
  if (!inputResult.success) fail('INVALID_REQUEST', 'The purchase request is invalid.')
  const input = inputResult.data

  return client.begin(async (transaction) => {
    let publicProduct
    try {
      publicProduct = await getPublicVerifiedProduct(transaction, input.productPublicId)
    } catch (error) {
      if (error instanceof PublicProductReadError && error.code === 'EVIDENCE_INTEGRITY') {
        fail('EVIDENCE_INTEGRITY', 'The active policy failed verification.')
      }
      fail('INVALID_REQUEST', 'The product identifier is invalid.')
    }
    if (!publicProduct) {
      fail('PRODUCT_NOT_AVAILABLE', 'No active verified policy is available for purchase.')
    }

    const boundProduct = requireOne(
      await transaction<BoundProductRow[]>`
        select
          products.id as product_id,
          products.merchant_id,
          products.description,
          products.network,
          products.active_policy_version_id,
          policy_versions.public_id as active_policy_public_id
        from products
        join policy_versions on policy_versions.id = products.active_policy_version_id
        where products.public_id = ${input.productPublicId}
          and products.status = 'active'
          and policy_versions.verification_status = 'verified'
        for share of products, policy_versions
      `,
      'PRODUCT_NOT_AVAILABLE',
      'The product is no longer available for purchase.',
    )
    if (boundProduct.active_policy_public_id !== publicProduct.policy.publicId) {
      fail('PERSISTENCE_CONFLICT', 'The active policy changed during order creation.')
    }
    // The product decides the chain. A wallet on another chain is refused here rather
    // than allowed to settle a mainnet promise with testnet funds.
    if (input.network && input.network !== boundProduct.network) {
      fail('NETWORK_MISMATCH', 'This product is sold on a different Nimiq network than the connected wallet.')
    }

    const databaseNow = requireOne(
      await transaction<DatabaseNowRow[]>`select clock_timestamp() as now`,
      'PERSISTENCE_CONFLICT',
      'The database clock was unavailable.',
    ).now
    const expiresAt = new Date(databaseNow.getTime() + ORDER_TTL_MS)
    let order: CreatedOrderRow | undefined
    let orderPublicId = ''

    for (let attempt = 0; attempt < 3 && !order; attempt += 1) {
      orderPublicId = generatePublicToken()
      const expectedData = encodePurchaseTag(orderPublicId)
      const rows = await transaction<CreatedOrderRow[]>`
        insert into orders (
          public_id, product_id, policy_version_id, merchant_id,
          product_name, product_description, merchant_display_name,
          policy_payload_hash, policy_version, protocol_version,
          expected_recipient, expected_value_luna, expected_data, network,
          expires_at, created_at, updated_at
        ) values (
          ${orderPublicId}, ${boundProduct.product_id}, ${boundProduct.active_policy_version_id},
          ${boundProduct.merchant_id}, ${publicProduct.policy.payload.productName},
          ${boundProduct.description}, ${publicProduct.merchant.displayName},
          ${publicProduct.policy.proof.payloadHash}, ${publicProduct.policy.payload.version},
          ${publicProduct.policy.payload.protocol}, ${publicProduct.policy.payload.settlementAddress},
          ${publicProduct.policy.payload.priceLuna}, ${expectedData}, ${boundProduct.network},
          ${expiresAt}, ${databaseNow}, ${databaseNow}
        )
        on conflict (public_id) do nothing
        returning id
      `
      order = rows[0]
    }
    if (!order) fail('PERSISTENCE_CONFLICT', 'A unique purchase identifier could not be allocated.')

    await transaction`
      insert into protocol_events (
        aggregate_type, aggregate_id, event_type, protocol_version, occurred_at,
        correlation_id, evidence_type, payload
      ) values (
        'order', ${order.id}, 'purchase.order-created', 'NR1', ${databaseNow},
        ${randomUUID()}, 'backend',
        ${transaction.json({
          policyPayloadHash: publicProduct.policy.proof.payloadHash,
          policyVersion: publicProduct.policy.payload.version,
          productId: boundProduct.product_id,
        })}
      )
    `

    return {
      buyerAddress: null,
      claimKey: null,
      createdAt: databaseNow,
      expiresAt,
      expectedPayment: {
        data: encodePurchaseTag(orderPublicId),
        network: boundProduct.network,
        recipient: publicProduct.policy.payload.settlementAddress,
        valueLuna: publicProduct.policy.payload.priceLuna,
      },
      failureCode: null,
      merchant: publicProduct.merchant,
      paymentState: 'payment_requested',
      passport: null,
      policy: {
        payloadHash: publicProduct.policy.proof.payloadHash,
        publicId: publicProduct.policy.publicId,
        version: publicProduct.policy.payload.version,
      },
      product: {
        description: boundProduct.description,
        name: publicProduct.policy.payload.productName,
        publicId: publicProduct.product.publicId,
      },
      publicId: orderPublicId,
      rowVersion: 1,
      transaction: null,
    }
  })
}
