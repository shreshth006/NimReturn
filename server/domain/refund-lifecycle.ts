import { randomBytes, randomUUID } from 'node:crypto'
import type postgres from 'postgres'
import { z } from 'zod'

import { encodeRefundTag } from '../../src/lib/protocol/transaction-data.js'

const publicTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{22}$/u)
const createSchema = z.object({
  claimPublicId: publicTokenSchema,
  merchantPublicId: publicTokenSchema,
  network: z.string().min(1).max(24),
}).strict()
const stateSchema = z.object({
  attemptPublicId: publicTokenSchema,
  claimPublicId: publicTokenSchema,
  event: z.enum(['wallet-request-started', 'wallet-cancelled', 'submission-outcome-unknown']),
  merchantPublicId: publicTokenSchema,
}).strict()

export type RefundAttemptState =
  | 'payment_cancelled'
  | 'payment_failed'
  | 'payment_pending'
  | 'payment_requested'
  | 'payment_verifying'
  | 'refunded'
  | 'submission_outcome_unknown'
  | 'wallet_request_started'

export interface RefundView {
  attempt: null | {
    createdAt: Date
    expectedPayment: {
      data: string
      network: string
      recipient: string
      sender: string
      valueLuna: number
    }
    failureCode: string | null
    publicId: string
    rowVersion: number
    state: RefundAttemptState
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
      recipient: string | null
      sender: string | null
      valueLuna: number | null
    }
    updatedAt: Date
  }
  claimPublicId: string
  decision: 'APPROVED'
  passportPublicId: string
  refund: null | { verifiedAt: Date }
  resolutionPublicId: string
}

export type RefundLifecycleErrorCode =
  | 'EVIDENCE_INTEGRITY'
  | 'INVALID_REQUEST'
  | 'PERSISTENCE_CONFLICT'
  | 'REFUND_NOT_AVAILABLE'
  | 'STATE_CONFLICT'

export class RefundLifecycleError extends Error {
  constructor(readonly code: RefundLifecycleErrorCode, message: string) {
    super(message)
    this.name = 'RefundLifecycleError'
  }
}

interface RefundRow {
  approved_refund_luna: string
  attempt_created_at: Date | null
  attempt_public_id: string | null
  attempt_updated_at: Date | null
  block_number: string | null
  block_timestamp_ms: string | null
  chain_recipient: string | null
  chain_sender: string | null
  chain_value_luna: string | null
  claim_public_id: string
  execution_result: boolean | null
  expected_data: string | null
  expected_recipient: string | null
  expected_sender: string | null
  expected_value_luna: string | null
  failure_code: string | null
  finalizing_block_number: string | null
  head_block_number: string | null
  merchant_public_id: string
  network: string | null
  observed_state: NonNullable<RefundView['attempt']>['transaction'] extends infer T
    ? T extends { observedState: infer S } ? S : never
    : never
  passport_public_id: string
  reconciliation_checked_at: Date | null
  reconciliation_outcome: 'confirmed' | 'exception' | 'inconclusive' | null
  reconciliation_reason: string | null
  refund_verified_at: Date | null
  resolution_public_id: string
  row_version: number | null
  transaction_hash: string | null
  verification_reason: string | null
  wallet_state: RefundAttemptState | null
}

function fail(code: RefundLifecycleErrorCode, message: string): never {
  throw new RefundLifecycleError(code, message)
}

function safeInteger(value: string | null, allowZero = true): number | null {
  if (value === null || !/^(0|[1-9][0-9]*)$/u.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && (allowZero || parsed > 0) ? parsed : null
}

function project(row: RefundRow): RefundView {
  const approved = safeInteger(row.approved_refund_luna, false)
  if (!approved) fail('EVIDENCE_INTEGRITY', 'Stored refund approval amount is invalid.')
  let attempt: RefundView['attempt'] = null
  if (row.attempt_public_id) {
    const expectedValue = safeInteger(row.expected_value_luna, false)
    if (
      !row.attempt_created_at || !row.attempt_updated_at || !row.expected_data
      || !row.expected_recipient || !row.expected_sender || !row.network
      || !row.wallet_state || row.row_version === null || !expectedValue
      || expectedValue !== approved || row.expected_data !== encodeRefundTag(row.claim_public_id)
    ) fail('EVIDENCE_INTEGRITY', 'Stored refund attempt expectation is invalid.')
    const transaction = row.transaction_hash && row.observed_state && row.verification_reason
      ? {
          blockNumber: safeInteger(row.block_number),
          blockTimestamp: safeInteger(row.block_timestamp_ms),
          executionResult: row.execution_result,
          finalizingBlockNumber: safeInteger(row.finalizing_block_number),
          hash: row.transaction_hash,
          headBlockNumber: safeInteger(row.head_block_number),
          observedState: row.observed_state,
          reason: row.verification_reason,
          reconciliation: row.reconciliation_checked_at && row.reconciliation_outcome && row.reconciliation_reason
            ? {
                checkedAt: row.reconciliation_checked_at,
                outcome: row.reconciliation_outcome,
                reason: row.reconciliation_reason,
              }
            : null,
          recipient: row.chain_recipient,
          sender: row.chain_sender,
          valueLuna: safeInteger(row.chain_value_luna),
        }
      : null
    if ((row.wallet_state === 'refunded') !== Boolean(row.refund_verified_at && transaction?.observedState === 'finalized')) {
      fail('EVIDENCE_INTEGRITY', 'Stored refund completion evidence is inconsistent.')
    }
    attempt = {
      createdAt: row.attempt_created_at,
      expectedPayment: {
        data: row.expected_data,
        network: row.network,
        recipient: row.expected_recipient,
        sender: row.expected_sender,
        valueLuna: expectedValue,
      },
      failureCode: row.failure_code,
      publicId: row.attempt_public_id,
      rowVersion: row.row_version,
      state: row.wallet_state,
      transaction,
      updatedAt: row.attempt_updated_at,
    }
  }
  return {
    attempt,
    claimPublicId: row.claim_public_id,
    decision: 'APPROVED',
    passportPublicId: row.passport_public_id,
    refund: row.refund_verified_at ? { verifiedAt: row.refund_verified_at } : null,
    resolutionPublicId: row.resolution_public_id,
  }
}

async function readRow(
  client: postgres.Sql | postgres.TransactionSql,
  claimPublicId: string,
  merchantPublicId?: string,
  lock = false,
): Promise<RefundRow | null> {
  const rows = await client<RefundRow[]>`
    select
      claims.public_id as claim_public_id,
      merchants.public_id as merchant_public_id,
      purchase_passports.public_id as passport_public_id,
      claim_resolutions.public_id as resolution_public_id,
      claim_resolutions.approved_refund_luna::text,
      latest_attempt.public_id as attempt_public_id,
      latest_attempt.network, latest_attempt.expected_sender,
      latest_attempt.expected_recipient, latest_attempt.expected_value_luna::text,
      latest_attempt.expected_data, latest_attempt.wallet_state,
      latest_attempt.failure_code, latest_attempt.row_version,
      latest_attempt.created_at as attempt_created_at,
      latest_attempt.updated_at as attempt_updated_at,
      chain_transactions.transaction_hash, chain_transactions.observed_state,
      chain_transactions.verification_reason, chain_transactions.block_number::text,
      chain_transactions.block_timestamp_ms::text,
      chain_transactions.finalizing_block_number::text,
      chain_transactions.head_block_number::text, chain_transactions.execution_result,
      chain_transactions.sender as chain_sender,
      chain_transactions.recipient as chain_recipient,
      chain_transactions.value_luna::text as chain_value_luna,
      latest_reconciliation.checked_at as reconciliation_checked_at,
      latest_reconciliation.outcome as reconciliation_outcome,
      latest_reconciliation.reason as reconciliation_reason,
      refund_transactions.verified_at as refund_verified_at
    from claims
    join merchants on merchants.id = claims.merchant_id
    join purchase_passports on purchase_passports.id = claims.passport_id
    join claim_resolutions on claim_resolutions.claim_id = claims.id
      and claim_resolutions.verification_status = 'verified'
      and claim_resolutions.decision = 'APPROVED'
    left join lateral (
      select * from refund_attempts where refund_attempts.claim_id = claims.id
      order by created_at desc, id desc limit 1
    ) latest_attempt on true
    left join chain_transactions on chain_transactions.purpose = 'refund'
      and chain_transactions.resource_id = latest_attempt.id
    left join refund_transactions on refund_transactions.attempt_id = latest_attempt.id
    left join lateral (
      select checked_at, outcome, reason from chain_reconciliations
      where chain_reconciliations.chain_transaction_id = chain_transactions.id
      order by checked_at desc, id desc limit 1
    ) latest_reconciliation on true
    where claims.public_id = ${claimPublicId}
      ${merchantPublicId ? client`and merchants.public_id = ${merchantPublicId}` : client``}
    ${lock ? client.unsafe('for update of claims, purchase_passports, claim_resolutions') : client.unsafe('')}
  `
  return rows[0] ?? null
}

export async function getRefund(
  client: postgres.Sql | postgres.TransactionSql,
  rawClaimPublicId: unknown,
): Promise<RefundView | null> {
  const parsed = publicTokenSchema.safeParse(rawClaimPublicId)
  if (!parsed.success) fail('INVALID_REQUEST', 'The claim identifier is invalid.')
  const row = await readRow(client, parsed.data)
  return row ? project(row) : null
}

export async function createRefundAttempt(
  client: postgres.Sql,
  rawInput: unknown,
): Promise<RefundView> {
  const parsed = createSchema.safeParse(rawInput)
  if (!parsed.success) fail('INVALID_REQUEST', 'The refund request is invalid.')
  const input = parsed.data
  return client.begin(async (transaction) => {
    const row = await readRow(transaction, input.claimPublicId, input.merchantPublicId, true)
    if (!row) fail('REFUND_NOT_AVAILABLE', 'Only a verified approved claim can be refunded.')
    const current = project(row)
    if (current.refund) return current
    if (current.attempt && !['payment_cancelled', 'payment_failed'].includes(current.attempt.state)) return current
    if (row.merchant_public_id !== input.merchantPublicId) fail('REFUND_NOT_AVAILABLE', 'The claim was not found for this merchant.')
    if (row.network && row.network !== input.network) fail('STATE_CONFLICT', 'The refund network cannot change.')

    const bindingRows = await transaction<{
      claim_id: string
      merchant_id: string
      passport_id: string
      resolution_id: string
      settlement_recipient: string
      original_buyer_address: string
      approved_refund_luna: string
      price_luna: string
      order_network: string
    }[]>`
      select claims.id as claim_id, claims.merchant_id, claims.passport_id,
        claim_resolutions.id as resolution_id,
        purchase_passports.settlement_recipient,
        purchase_passports.original_buyer_address,
        claim_resolutions.approved_refund_luna::text,
        purchase_passports.price_luna::text,
        orders.network as order_network
      from claims
      join claim_resolutions on claim_resolutions.claim_id = claims.id
        and claim_resolutions.verification_status = 'verified'
        and claim_resolutions.decision = 'APPROVED'
      join purchase_passports on purchase_passports.id = claims.passport_id
      join orders on orders.id = purchase_passports.order_id
      where claims.public_id = ${input.claimPublicId}
        and claims.workflow_state = 'approved'
        and purchase_passports.status = 'active'
      for update of claims, purchase_passports, claim_resolutions
    `
    const binding = bindingRows[0]
    if (!binding || binding.order_network !== input.network) {
      fail('REFUND_NOT_AVAILABLE', 'The approved refund is not available on this network.')
    }
    const approved = safeInteger(binding.approved_refund_luna, false)
    const price = safeInteger(binding.price_luna, false)
    if (!approved || approved !== price) fail('EVIDENCE_INTEGRITY', 'The approved refund does not equal the purchase price.')
    const now = (await transaction<{ now: Date }[]>`select clock_timestamp() as now`)[0]?.now
    if (!now) fail('PERSISTENCE_CONFLICT', 'The database clock was unavailable.')
    let inserted = false
    for (let attempt = 0; attempt < 3 && !inserted; attempt += 1) {
      const publicId = randomBytes(16).toString('base64url')
      const rows = await transaction<{ id: string }[]>`
        insert into refund_attempts (
          public_id, claim_id, claim_public_id, resolution_id, passport_id, merchant_id,
          network, expected_sender, expected_recipient, expected_value_luna,
          expected_data, created_at, updated_at
        ) values (
          ${publicId}, ${binding.claim_id}, ${input.claimPublicId}, ${binding.resolution_id},
          ${binding.passport_id}, ${binding.merchant_id}, ${input.network},
          ${binding.settlement_recipient}, ${binding.original_buyer_address}, ${approved},
          ${encodeRefundTag(input.claimPublicId)}, ${now}, ${now}
        ) on conflict (public_id) do nothing returning id
      `
      inserted = rows.length === 1
    }
    if (!inserted) fail('PERSISTENCE_CONFLICT', 'A unique refund attempt could not be allocated.')
    await transaction`
      insert into protocol_events (
        aggregate_type, aggregate_id, event_type, protocol_version, occurred_at,
        correlation_id, evidence_type, payload
      ) values (
        'claim', ${binding.claim_id}, 'refund.attempt-created', 'NR1', ${now},
        ${randomUUID()}, 'backend', ${transaction.json({ resolutionId: binding.resolution_id })}
      )
    `
    const created = await readRow(transaction, input.claimPublicId, input.merchantPublicId)
    if (!created) fail('PERSISTENCE_CONFLICT', 'The refund attempt could not be read back.')
    return project(created)
  })
}

export async function recordRefundWalletState(
  client: postgres.Sql,
  rawInput: unknown,
): Promise<RefundView> {
  const parsed = stateSchema.safeParse(rawInput)
  if (!parsed.success) fail('INVALID_REQUEST', 'The refund wallet state is invalid.')
  const input = parsed.data
  const target: RefundAttemptState = input.event === 'wallet-request-started'
    ? 'wallet_request_started'
    : input.event === 'wallet-cancelled'
      ? 'payment_cancelled'
      : 'submission_outcome_unknown'
  return client.begin(async (transaction) => {
    const rows = await transaction<{ id: string; state: RefundAttemptState }[]>`
      select refund_attempts.id, refund_attempts.wallet_state as state
      from refund_attempts
      join claims on claims.id = refund_attempts.claim_id
      join merchants on merchants.id = refund_attempts.merchant_id
      where refund_attempts.public_id = ${input.attemptPublicId}
        and claims.public_id = ${input.claimPublicId}
        and merchants.public_id = ${input.merchantPublicId}
      for update of refund_attempts
    `
    const attempt = rows[0]
    if (!attempt) fail('REFUND_NOT_AVAILABLE', 'The refund attempt was not found.')
    if (attempt.state !== target) {
      const allowed = (target === 'wallet_request_started' && attempt.state === 'payment_requested')
        || (target === 'payment_cancelled' && ['payment_requested', 'wallet_request_started'].includes(attempt.state))
        || (target === 'submission_outcome_unknown' && attempt.state === 'wallet_request_started')
      if (!allowed) fail('STATE_CONFLICT', 'The refund wallet state cannot move backward or skip required steps.')
      await transaction`update refund_attempts set wallet_state = ${target} where id = ${attempt.id}`
    }
    const row = await readRow(transaction, input.claimPublicId, input.merchantPublicId)
    if (!row) fail('PERSISTENCE_CONFLICT', 'The refund attempt disappeared.')
    return project(row)
  })
}
