import { randomBytes, randomUUID } from 'node:crypto'
import type postgres from 'postgres'
import { z } from 'zod'

import { normalizeNimiqAddress } from '../../src/lib/crypto/nimiq-signature.js'
import {
  verifyObservedTransaction,
  type ObservedTransaction,
  type TransactionVerification,
} from '../../src/lib/protocol/transaction-verification.js'
import { getPurchaseOrder } from './get-purchase-order.js'
import {
  PurchaseOrderError,
  type PurchaseOrderState,
  type PurchaseOrderView,
} from './purchase-order.js'

const VERIFIER_VERSION = 'nr1-purchase-verifier-v1'
const CONFIRMATION_POLICY = 'albatross-next-macro-v1'
const transactionHashSchema = z.string().regex(/^[0-9a-f]{64}$/iu)
const inputSchema = z.object({
  hash: transactionHashSchema,
  orderPublicId: z.string().regex(/^[A-Za-z0-9_-]{22}$/u),
}).strict()

export interface PurchaseTransactionReader {
  /** The network is always the record's own; readers must never answer from another chain. */
  getTransaction(hash: string, network: string): Promise<ObservedTransaction | null>
}

interface LockedOrderRow {
  expected_data: string
  expected_recipient: string
  expected_value_luna: string
  id: string
  network: string
  payment_state: PurchaseOrderState
}

interface ChainBindingRow {
  id: string
  observed_state: 'absent' | 'finalized' | 'included' | 'inconclusive' | 'invalid' | 'mempool'
  transaction_hash: string
}

interface FinalizationOrderRow extends LockedOrderRow {
  merchant_display_name: string
  merchant_id: string
  policy_payload_hash: string
  policy_version: number
  policy_version_id: string
  product_description: string
  product_id: string
  product_name: string
  protocol_version: string
  return_window_seconds: string
  warranty_window_seconds: string
}

function databaseConstraint(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  const value = (error as Record<string, unknown>).constraint_name
  return typeof value === 'string' ? value : undefined
}

function parsePositiveSafeInteger(value: string, message: string): number {
  if (!/^[1-9][0-9]*$/u.test(value)) {
    throw new PurchaseOrderError('EVIDENCE_INTEGRITY', message)
  }
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) {
    throw new PurchaseOrderError('EVIDENCE_INTEGRITY', message)
  }
  return parsed
}

function parseWindow(value: string): number {
  if (!/^(0|[1-9][0-9]*)$/u.test(value)) {
    throw new PurchaseOrderError('EVIDENCE_INTEGRITY', 'The purchase policy window is invalid.')
  }
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed > 157_680_000) {
    throw new PurchaseOrderError('EVIDENCE_INTEGRITY', 'The purchase policy window is unsafe.')
  }
  return parsed
}

function deadline(purchaseTime: number, windowSeconds: number): Date | null {
  if (windowSeconds === 0) return null
  const value = purchaseTime + windowSeconds * 1_000
  if (!Number.isSafeInteger(value)) {
    throw new PurchaseOrderError('EVIDENCE_INTEGRITY', 'The purchase deadline is unsafe.')
  }
  return new Date(value)
}

function normalizeAddressOrNull(value: string): string | null {
  try {
    return normalizeNimiqAddress(value)
  } catch {
    return null
  }
}

function generatePublicToken(): string {
  return randomBytes(16).toString('base64url')
}

async function reserveTransactionHash(
  client: postgres.Sql,
  input: z.infer<typeof inputSchema>,
): Promise<PurchaseOrderView | LockedOrderRow> {
  try {
    return await client.begin(async (transaction) => {
      const orderRows = await transaction<LockedOrderRow[]>`
        select
          id, payment_state, network, expected_recipient,
          expected_value_luna::text, expected_data
        from orders where public_id = ${input.orderPublicId}
        for update
      `
      const order = orderRows[0]
      if (!order) throw new PurchaseOrderError('ORDER_NOT_FOUND', 'The purchase was not found.')
      if (order.payment_state === 'purchased') {
        const view = await getPurchaseOrder(transaction, input.orderPublicId)
        if (!view) throw new PurchaseOrderError('PERSISTENCE_CONFLICT', 'The purchase disappeared.')
        if (view.transaction?.hash !== input.hash) {
          throw new PurchaseOrderError('STATE_CONFLICT', 'The purchase already uses another transaction.')
        }
        return view
      }
      if (['expired', 'payment_cancelled', 'payment_failed'].includes(order.payment_state)) {
        throw new PurchaseOrderError('STATE_CONFLICT', 'The purchase cannot accept a transaction hash.')
      }

      const existingRows = await transaction<ChainBindingRow[]>`
        select id, transaction_hash, observed_state
        from chain_transactions
        where purpose = 'purchase' and resource_id = ${order.id}
        for update
      `
      const existing = existingRows[0]
      if (existing && existing.transaction_hash !== input.hash) {
        throw new PurchaseOrderError('STATE_CONFLICT', 'The purchase already uses another transaction.')
      }
      if (!existing) {
        await transaction`
          insert into chain_transactions (
            network, transaction_hash, purpose, resource_id, observed_state,
            provider_id, observed_at, verification_reason, verifier_version
          ) values (
            ${order.network}, ${input.hash}, 'purchase', ${order.id}, 'inconclusive',
            'configured-primary-rpc', clock_timestamp(),
            'Transaction hash attached; independent verification has not completed.',
            ${VERIFIER_VERSION}
          )
        `
      }
      if (order.payment_state !== 'payment_verifying') {
        await transaction`update orders set payment_state = 'payment_verifying' where id = ${order.id}`
      }
      return order
    })
  } catch (error) {
    if (databaseConstraint(error) === 'chain_transactions_network_hash_unique') {
      throw new PurchaseOrderError('STATE_CONFLICT', 'The transaction hash is already bound to another purchase.')
    }
    throw error
  }
}

async function persistNonFinal(
  client: postgres.Sql,
  input: z.infer<typeof inputSchema>,
  state: 'absent' | 'included' | 'inconclusive' | 'mempool',
  reason: string,
  observed: ObservedTransaction | null,
  verification: TransactionVerification | null,
): Promise<PurchaseOrderView> {
  return client.begin(async (transaction) => {
    const orderRows = await transaction<{ id: string; payment_state: PurchaseOrderState }[]>`
      select id, payment_state from orders where public_id = ${input.orderPublicId} for update
    `
    const order = orderRows[0]
    if (!order) throw new PurchaseOrderError('ORDER_NOT_FOUND', 'The purchase was not found.')
    if (order.payment_state === 'purchased' || order.payment_state === 'payment_failed') {
      const existing = await getPurchaseOrder(transaction, input.orderPublicId)
      if (!existing) throw new PurchaseOrderError('PERSISTENCE_CONFLICT', 'The purchase disappeared.')
      return existing
    }

    const sender = observed ? normalizeAddressOrNull(observed.sender) : null
    const recipient = observed ? normalizeAddressOrNull(observed.recipient) : null
    await transaction`
      update chain_transactions set
        observed_state = ${state},
        normalized_evidence = ${observed ? transaction.json(observed as unknown as postgres.JSONValue) : null},
        observed_at = clock_timestamp(),
        block_number = ${observed?.blockNumber ?? null},
        block_timestamp_ms = ${observed?.blockTimestamp ?? null},
        finalizing_block_number = ${observed?.finality.finalizingBlockNumber ?? null},
        head_block_number = ${observed?.finality.headBlockNumber ?? null},
        confirmations = ${observed?.confirmations ?? null},
        execution_result = ${observed?.executionResult ?? null},
        sender = ${sender}, recipient = ${recipient},
        value_luna = ${observed?.valueLuna ?? null}, data_text = ${observed?.data ?? null},
        verification_checks = ${verification ? transaction.json(verification.checks) : null},
        verification_reason = ${reason}, verifier_version = ${VERIFIER_VERSION}
      where purpose = 'purchase' and resource_id = ${order.id}
        and transaction_hash = ${input.hash} and observed_state not in ('finalized', 'invalid')
    `
    if (order.payment_state === 'payment_verifying') {
      await transaction`update orders set payment_state = 'payment_pending' where id = ${order.id}`
    }
    const view = await getPurchaseOrder(transaction, input.orderPublicId)
    if (!view) throw new PurchaseOrderError('PERSISTENCE_CONFLICT', 'The purchase disappeared.')
    return view
  })
}

async function persistInvalid(
  client: postgres.Sql,
  input: z.infer<typeof inputSchema>,
  observed: ObservedTransaction,
  verification: TransactionVerification,
): Promise<PurchaseOrderView> {
  return client.begin(async (transaction) => {
    const orderRows = await transaction<{ id: string; payment_state: PurchaseOrderState }[]>`
      select id, payment_state from orders where public_id = ${input.orderPublicId} for update
    `
    const order = orderRows[0]
    if (!order) throw new PurchaseOrderError('ORDER_NOT_FOUND', 'The purchase was not found.')
    if (order.payment_state === 'purchased' || order.payment_state === 'payment_failed') {
      const existing = await getPurchaseOrder(transaction, input.orderPublicId)
      if (!existing) throw new PurchaseOrderError('PERSISTENCE_CONFLICT', 'The purchase disappeared.')
      return existing
    }

    await transaction`
      update chain_transactions set
        observed_state = 'invalid', normalized_evidence = ${transaction.json(observed as unknown as postgres.JSONValue)},
        observed_at = clock_timestamp(), block_number = ${observed.blockNumber},
        block_timestamp_ms = ${observed.blockTimestamp},
        finalizing_block_number = ${observed.finality.finalizingBlockNumber},
        head_block_number = ${observed.finality.headBlockNumber},
        confirmations = ${observed.confirmations ?? null},
        execution_result = ${observed.executionResult},
        sender = ${normalizeAddressOrNull(observed.sender)},
        recipient = ${normalizeAddressOrNull(observed.recipient)},
        value_luna = ${observed.valueLuna}, data_text = ${observed.data},
        verification_checks = ${transaction.json(verification.checks)},
        verification_reason = ${verification.reason}, verifier_version = ${VERIFIER_VERSION}
      where purpose = 'purchase' and resource_id = ${order.id}
        and transaction_hash = ${input.hash} and observed_state not in ('finalized', 'invalid')
    `
    await transaction`
      update orders set payment_state = 'payment_failed', failure_code = 'TRANSACTION_INVALID'
      where id = ${order.id} and payment_state in ('payment_verifying', 'payment_pending')
    `
    const view = await getPurchaseOrder(transaction, input.orderPublicId)
    if (!view) throw new PurchaseOrderError('PERSISTENCE_CONFLICT', 'The purchase disappeared.')
    return view
  })
}

async function persistVerified(
  client: postgres.Sql,
  input: z.infer<typeof inputSchema>,
  observed: ObservedTransaction,
  verification: TransactionVerification,
): Promise<PurchaseOrderView> {
  const buyerAddress = normalizeAddressOrNull(observed.sender)
  const recipient = normalizeAddressOrNull(observed.recipient)
  if (!buyerAddress || !recipient || !Number.isSafeInteger(observed.blockTimestamp)) {
    return persistNonFinal(
      client,
      input,
      'inconclusive',
      'Verified-shaped evidence could not be normalized safely.',
      observed,
      verification,
    )
  }

  return client.begin(async (transaction) => {
    const orderRows = await transaction<FinalizationOrderRow[]>`
      select
        orders.id, orders.payment_state, orders.network, orders.expected_recipient,
        orders.expected_value_luna::text, orders.expected_data,
        orders.product_id, orders.policy_version_id, orders.merchant_id,
        orders.product_name, orders.product_description, orders.merchant_display_name,
        orders.policy_payload_hash, orders.policy_version, orders.protocol_version,
        policy_versions.return_window_seconds::text,
        policy_versions.warranty_window_seconds::text
      from orders
      join policy_versions on policy_versions.id = orders.policy_version_id
      where orders.public_id = ${input.orderPublicId}
      for update of orders
    `
    const order = orderRows[0]
    if (!order) throw new PurchaseOrderError('ORDER_NOT_FOUND', 'The purchase was not found.')
    if (order.payment_state === 'purchased' || order.payment_state === 'payment_failed') {
      const existing = await getPurchaseOrder(transaction, input.orderPublicId)
      if (!existing) throw new PurchaseOrderError('PERSISTENCE_CONFLICT', 'The purchase disappeared.')
      return existing
    }

    const chainRows = await transaction<ChainBindingRow[]>`
      select id, transaction_hash, observed_state from chain_transactions
      where purpose = 'purchase' and resource_id = ${order.id}
      for update
    `
    const chain = chainRows[0]
    if (!chain || chain.transaction_hash !== input.hash) {
      throw new PurchaseOrderError('PERSISTENCE_CONFLICT', 'The transaction binding changed.')
    }

    await transaction`
      update chain_transactions set
        observed_state = 'finalized', normalized_evidence = ${transaction.json(observed as unknown as postgres.JSONValue)},
        observed_at = clock_timestamp(), block_number = ${observed.blockNumber},
        block_timestamp_ms = ${observed.blockTimestamp},
        finalizing_block_number = ${observed.finality.finalizingBlockNumber},
        head_block_number = ${observed.finality.headBlockNumber},
        confirmations = ${observed.confirmations ?? null},
        execution_result = ${observed.executionResult}, sender = ${buyerAddress},
        recipient = ${recipient}, value_luna = ${observed.valueLuna},
        data_text = ${observed.data}, verification_checks = ${transaction.json(verification.checks)},
        verification_reason = ${verification.reason}, verifier_version = ${VERIFIER_VERSION}
      where id = ${chain.id} and observed_state not in ('finalized', 'invalid')
    `
    const purchasedRows = await transaction<{ id: string }[]>`
      update orders set payment_state = 'purchased', buyer_address = ${buyerAddress}
      where id = ${order.id} and payment_state in ('payment_verifying', 'payment_pending')
      returning id
    `
    if (purchasedRows.length !== 1) {
      throw new PurchaseOrderError('PERSISTENCE_CONFLICT', 'The purchase could not be finalized once.')
    }

    const verifiedAtRows = await transaction<{ now: Date }[]>`select clock_timestamp() as now`
    const verifiedAt = verifiedAtRows[0]?.now
    if (!verifiedAt) throw new PurchaseOrderError('PERSISTENCE_CONFLICT', 'The database clock was unavailable.')
    const purchaseRows = await transaction<{ id: string }[]>`
      insert into purchase_transactions (order_id, chain_transaction_id, verified_at, confirmation_policy)
      values (${order.id}, ${chain.id}, ${verifiedAt}, ${CONFIRMATION_POLICY})
      returning id
    `
    const purchase = purchaseRows[0]
    if (!purchase) throw new PurchaseOrderError('PERSISTENCE_CONFLICT', 'The verified purchase could not be stored.')

    const purchaseTime = new Date(observed.blockTimestamp)
    const returnDeadline = deadline(observed.blockTimestamp, parseWindow(order.return_window_seconds))
    const warrantyDeadline = deadline(observed.blockTimestamp, parseWindow(order.warranty_window_seconds))
    const priceLuna = parsePositiveSafeInteger(order.expected_value_luna, 'The purchase price is invalid.')
    let passportId: string | undefined
    for (let attempt = 0; attempt < 3 && !passportId; attempt += 1) {
      const passportPublicId = generatePublicToken()
      const passportRows = await transaction<{ id: string }[]>`
        insert into purchase_passports (
          public_id, order_id, purchase_transaction_id, policy_version_id,
          product_id, merchant_id, original_buyer_address,
          product_name, product_description, merchant_display_name,
          policy_payload_hash, policy_version, protocol_version,
          price_luna, settlement_recipient, purchase_time,
          return_deadline, warranty_deadline, created_at, updated_at
        ) values (
          ${passportPublicId}, ${order.id}, ${purchase.id}, ${order.policy_version_id},
          ${order.product_id}, ${order.merchant_id}, ${buyerAddress},
          ${order.product_name}, ${order.product_description}, ${order.merchant_display_name},
          ${order.policy_payload_hash}, ${order.policy_version}, ${order.protocol_version},
          ${priceLuna}, ${order.expected_recipient}, ${purchaseTime},
          ${returnDeadline}, ${warrantyDeadline}, ${verifiedAt}, ${verifiedAt}
        )
        on conflict (public_id) do nothing
        returning id
      `
      passportId = passportRows[0]?.id
    }
    if (!passportId) {
      throw new PurchaseOrderError('PERSISTENCE_CONFLICT', 'A unique Passport identifier could not be allocated.')
    }

    await transaction`
      insert into protocol_events (
        aggregate_type, aggregate_id, event_type, protocol_version, occurred_at,
        actor_address, correlation_id, evidence_type, evidence_id, payload
      ) values (
        'order', ${order.id}, 'purchase.verified', 'NR1', ${verifiedAt},
        ${buyerAddress}, ${randomUUID()}, 'chain', ${chain.id},
        ${transaction.json({
          finalizingBlockNumber: observed.finality.finalizingBlockNumber,
          passportId,
          policyPayloadHash: order.policy_payload_hash,
          policyVersion: order.policy_version,
        })}
      )
    `

    const view = await getPurchaseOrder(transaction, input.orderPublicId)
    if (!view) throw new PurchaseOrderError('PERSISTENCE_CONFLICT', 'The purchase disappeared.')
    return view
  })
}

async function runIndependentVerification(
  client: postgres.Sql,
  reader: PurchaseTransactionReader,
  input: z.infer<typeof inputSchema>,
  expected: LockedOrderRow,
): Promise<PurchaseOrderView> {
  let observed: ObservedTransaction | null
  try {
    observed = await reader.getTransaction(input.hash, expected.network)
  } catch {
    return persistNonFinal(
      client,
      input,
      'inconclusive',
      'The configured RPC could not provide trustworthy transaction evidence yet.',
      null,
      null,
    )
  }
  if (!observed) {
    return persistNonFinal(
      client,
      input,
      'absent',
      'The configured RPC has not returned this transaction yet.',
      null,
      null,
    )
  }

  const verification = verifyObservedTransaction({
    data: expected.expected_data,
    hash: input.hash,
    network: expected.network,
    recipient: expected.expected_recipient,
    valueLuna: parsePositiveSafeInteger(expected.expected_value_luna, 'The purchase price is invalid.'),
  }, observed)
  if (verification.outcome === 'verified') {
    return persistVerified(client, input, observed, verification)
  }
  if (verification.outcome === 'invalid') {
    return persistInvalid(client, input, observed, verification)
  }
  return persistNonFinal(
    client,
    input,
    verification.outcome === 'pending-finality'
      ? 'included'
      : verification.outcome === 'pending-inclusion'
        ? 'mempool'
        : 'inconclusive',
    verification.reason,
    observed,
    verification,
  )
}

async function persistReconciliation(
  client: postgres.Sql,
  orderPublicId: string,
  outcome: 'confirmed' | 'exception' | 'inconclusive',
  reason: string,
  observed: ObservedTransaction | null,
): Promise<PurchaseOrderView> {
  return client.begin(async (transaction) => {
    const rows = await transaction<{ chain_id: string; order_id: string }[]>`
      select chain_transactions.id as chain_id, orders.id as order_id
      from orders
      join chain_transactions
        on chain_transactions.purpose = 'purchase' and chain_transactions.resource_id = orders.id
      where orders.public_id = ${orderPublicId}
        and orders.payment_state = 'purchased'
        and chain_transactions.observed_state = 'finalized'
      for share of orders, chain_transactions
    `
    const row = rows[0]
    if (!row) throw new PurchaseOrderError('STATE_CONFLICT', 'Only a finalized purchase can be reconciled.')
    const nowRows = await transaction<{ now: Date }[]>`select clock_timestamp() as now`
    const checkedAt = nowRows[0]?.now
    if (!checkedAt) throw new PurchaseOrderError('PERSISTENCE_CONFLICT', 'The database clock was unavailable.')
    await transaction`
      insert into chain_reconciliations (
        chain_transaction_id, outcome, normalized_evidence, reason, verifier_version, checked_at
      ) values (
        ${row.chain_id}, ${outcome},
        ${observed ? transaction.json(observed as unknown as postgres.JSONValue) : null},
        ${reason}, ${VERIFIER_VERSION}, ${checkedAt}
      )
    `
    if (outcome === 'exception') {
      await transaction`
        insert into protocol_events (
          aggregate_type, aggregate_id, event_type, protocol_version, occurred_at,
          correlation_id, evidence_type, evidence_id, payload
        ) values (
          'order', ${row.order_id}, 'purchase.reconciliation-exception', 'NR1', ${checkedAt},
          ${randomUUID()}, 'chain', ${row.chain_id},
          ${transaction.json({ reason, transactionHash: observed?.hash ?? null })}
        )
      `
    }
    const view = await getPurchaseOrder(transaction, orderPublicId)
    if (!view) throw new PurchaseOrderError('PERSISTENCE_CONFLICT', 'The reconciled purchase disappeared.')
    return view
  })
}

async function reconcilePurchasedTransaction(
  client: postgres.Sql,
  reader: PurchaseTransactionReader,
  view: PurchaseOrderView,
): Promise<PurchaseOrderView> {
  const stored = view.transaction
  if (!stored || stored.observedState !== 'finalized' || !stored.sender) {
    throw new PurchaseOrderError('EVIDENCE_INTEGRITY', 'The finalized purchase evidence is incomplete.')
  }
  let observed: ObservedTransaction | null
  try {
    observed = await reader.getTransaction(stored.hash, view.expectedPayment.network)
  } catch {
    return persistReconciliation(
      client,
      view.publicId,
      'inconclusive',
      'Reconciliation RPC was unavailable; original finalized evidence was not rewritten.',
      null,
    )
  }
  if (!observed) {
    return persistReconciliation(
      client,
      view.publicId,
      'inconclusive',
      'Reconciliation did not find the transaction; independent follow-up is required.',
      null,
    )
  }
  const verification = verifyObservedTransaction({
    ...view.expectedPayment,
    hash: stored.hash,
  }, observed)
  const sameFinalizedIdentity = verification.outcome === 'verified'
    && normalizeAddressOrNull(observed.sender) === stored.sender
    && observed.blockNumber === stored.blockNumber
    && observed.blockTimestamp === stored.blockTimestamp
    && observed.finality.finalizingBlockNumber === stored.finalizingBlockNumber
  if (!sameFinalizedIdentity) {
    return persistReconciliation(
      client,
      view.publicId,
      'exception',
      `Previously finalized evidence regressed or changed: ${verification.reason}`,
      observed,
    )
  }
  return persistReconciliation(
    client,
    view.publicId,
    'confirmed',
    'Independent recheck confirmed the original transaction fields, execution, sender, and macro finality.',
    observed,
  )
}

export async function verifyPurchaseTransaction(
  client: postgres.Sql,
  reader: PurchaseTransactionReader,
  rawInput: unknown,
): Promise<PurchaseOrderView> {
  const inputResult = inputSchema.safeParse(rawInput)
  if (!inputResult.success) {
    throw new PurchaseOrderError('INVALID_REQUEST', 'The transaction attachment is invalid.')
  }
  const input = { ...inputResult.data, hash: inputResult.data.hash.toLowerCase() }
  const reservation = await reserveTransactionHash(client, input)
  if ('publicId' in reservation) return reservation
  return runIndependentVerification(client, reader, input, reservation)
}

export async function recheckPurchaseTransaction(
  client: postgres.Sql,
  reader: PurchaseTransactionReader,
  rawOrderPublicId: unknown,
): Promise<PurchaseOrderView> {
  const orderPublicId = z.string().regex(/^[A-Za-z0-9_-]{22}$/u).safeParse(rawOrderPublicId)
  if (!orderPublicId.success) {
    throw new PurchaseOrderError('INVALID_REQUEST', 'The purchase identifier is invalid.')
  }
  const view = await getPurchaseOrder(client, orderPublicId.data)
  if (!view) throw new PurchaseOrderError('ORDER_NOT_FOUND', 'The purchase was not found.')
  if (view.paymentState === 'purchased') {
    return reconcilePurchasedTransaction(client, reader, view)
  }
  if (!view.transaction) {
    throw new PurchaseOrderError('STATE_CONFLICT', 'The purchase has no transaction to recheck.')
  }
  return verifyPurchaseTransaction(client, reader, {
    hash: view.transaction.hash,
    orderPublicId: orderPublicId.data,
  })
}
