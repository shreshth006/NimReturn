import { randomUUID } from 'node:crypto'
import type postgres from 'postgres'
import { z } from 'zod'

import { normalizeNimiqAddress } from '../../src/lib/crypto/nimiq-signature.js'
import {
  verifyObservedTransaction,
  type ObservedTransaction,
  type TransactionVerification,
} from '../../src/lib/protocol/transaction-verification.js'
import type { AddressTransactionSearch } from '../rpc/nimiq-rpc.js'
import {
  getRefund,
  REFUND_OUTCOME_SAFETY_BLOCKS,
  RefundLifecycleError,
  type RefundAttemptState,
  type RefundView,
} from './refund-lifecycle.js'
import type { PurchaseTransactionReader } from './verify-purchase.js'

const VERIFIER_VERSION = 'nr1-refund-verifier-v1'
const CONFIRMATION_POLICY = 'albatross-next-macro-v1'
const inputSchema = z.object({
  attemptPublicId: z.string().regex(/^[A-Za-z0-9_-]{22}$/u),
  claimPublicId: z.string().regex(/^[A-Za-z0-9_-]{22}$/u),
  hash: z.string().regex(/^[0-9a-f]{64}$/iu),
  merchantPublicId: z.string().regex(/^[A-Za-z0-9_-]{22}$/u),
}).strict()

interface AttemptRow {
  chain_id: string | null
  claim_id: string
  expected_data: string
  expected_recipient: string
  expected_sender: string
  expected_value_luna: string
  id: string
  merchant_id: string
  network: string
  passport_id: string
  recipient_rule: 'claim-key-v2' | 'purchase-sender-v1'
  resolution_id: string
  state: RefundAttemptState
  transaction_hash: string | null
}

function fail(code: 'EVIDENCE_INTEGRITY' | 'PERSISTENCE_CONFLICT' | 'REFUND_NOT_AVAILABLE' | 'STATE_CONFLICT', message: string): never {
  throw new RefundLifecycleError(code, message)
}

function constraintName(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  const value = (error as Record<string, unknown>).constraint_name
  return typeof value === 'string' ? value : undefined
}

function positiveLuna(value: string): number {
  if (!/^[1-9][0-9]*$/u.test(value)) fail('EVIDENCE_INTEGRITY', 'Stored refund amount is invalid.')
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) fail('EVIDENCE_INTEGRITY', 'Stored refund amount is unsafe.')
  return parsed
}

function normalized(value: string): string | null {
  try { return normalizeNimiqAddress(value) } catch { return null }
}

async function lockedAttempt(
  client: postgres.Sql | postgres.TransactionSql,
  input: z.infer<typeof inputSchema>,
): Promise<AttemptRow | null> {
  const rows = await client<AttemptRow[]>`
    select refund_attempts.id, refund_attempts.claim_id, refund_attempts.resolution_id,
      refund_attempts.passport_id, refund_attempts.merchant_id,
      refund_attempts.network, refund_attempts.expected_sender,
      refund_attempts.expected_recipient, refund_attempts.expected_value_luna::text,
      refund_attempts.expected_data, refund_attempts.wallet_state as state,
      refund_attempts.recipient_rule,
      refund_attempts.transaction_hash, chain_transactions.id as chain_id
    from refund_attempts
    join claims on claims.id = refund_attempts.claim_id
    join merchants on merchants.id = refund_attempts.merchant_id
    left join chain_transactions on chain_transactions.purpose = 'refund'
      and chain_transactions.resource_id = refund_attempts.id
    where refund_attempts.public_id = ${input.attemptPublicId}
      and claims.public_id = ${input.claimPublicId}
      and merchants.public_id = ${input.merchantPublicId}
    for update of refund_attempts
  `
  return rows[0] ?? null
}

async function reserve(
  client: postgres.Sql,
  input: z.infer<typeof inputSchema>,
): Promise<AttemptRow | RefundView> {
  try {
    return await client.begin(async (transaction) => {
      const attempt = await lockedAttempt(transaction, input)
      if (!attempt) fail('REFUND_NOT_AVAILABLE', 'The refund attempt was not found.')
      if (attempt.state === 'refunded') {
        const view = await getRefund(transaction, input.claimPublicId)
        if (!view) fail('PERSISTENCE_CONFLICT', 'The verified refund disappeared.')
        if (view.attempt?.transaction?.hash !== input.hash) fail('STATE_CONFLICT', 'The refund already uses another transaction.')
        return view
      }
      if (!['wallet_request_started', 'submission_outcome_unknown', 'payment_verifying', 'payment_pending'].includes(attempt.state)) {
        fail('STATE_CONFLICT', 'This refund attempt cannot accept a transaction hash.')
      }
      if (attempt.transaction_hash && attempt.transaction_hash !== input.hash) {
        fail('STATE_CONFLICT', 'This refund attempt already uses another transaction.')
      }
      if (!attempt.chain_id) {
        await transaction`
          insert into chain_transactions (
            network, transaction_hash, purpose, resource_id, observed_state,
            provider_id, observed_at, verification_reason, verifier_version
          ) values (
            ${attempt.network}, ${input.hash}, 'refund', ${attempt.id}, 'inconclusive',
            'configured-primary-rpc', clock_timestamp(),
            'Refund hash attached; independent verification has not completed.',
            ${VERIFIER_VERSION}
          )
        `
      }
      if (attempt.state !== 'payment_verifying') {
        await transaction`
          update refund_attempts set transaction_hash = ${input.hash}, wallet_state = 'payment_verifying'
          where id = ${attempt.id}
        `
      }
      return { ...attempt, transaction_hash: input.hash, state: 'payment_verifying' as const }
    })
  } catch (error) {
    if (constraintName(error) === 'chain_transactions_network_hash_unique') {
      fail('STATE_CONFLICT', 'The transaction hash is already bound to another purchase or refund.')
    }
    throw error
  }
}

async function persistEvidence(
  client: postgres.Sql,
  input: z.infer<typeof inputSchema>,
  state: 'absent' | 'included' | 'inconclusive' | 'invalid' | 'mempool',
  reason: string,
  observed: ObservedTransaction | null,
  verification: TransactionVerification | null,
): Promise<RefundView> {
  return client.begin(async (transaction) => {
    const attempt = await lockedAttempt(transaction, input)
    if (!attempt) fail('REFUND_NOT_AVAILABLE', 'The refund attempt was not found.')
    if (attempt.state === 'refunded' || attempt.state === 'payment_failed') {
      const existing = await getRefund(transaction, input.claimPublicId)
      if (!existing) fail('PERSISTENCE_CONFLICT', 'The refund disappeared.')
      return existing
    }
    if (!attempt.chain_id || attempt.transaction_hash !== input.hash) {
      fail('PERSISTENCE_CONFLICT', 'The refund transaction binding changed.')
    }
    await transaction`
      update chain_transactions set
        observed_state = ${state},
        normalized_evidence = ${observed ? transaction.json(observed as unknown as postgres.JSONValue) : null},
        observed_at = clock_timestamp(), block_number = ${observed?.blockNumber ?? null},
        block_timestamp_ms = ${observed?.blockTimestamp ?? null},
        finalizing_block_number = ${observed?.finality.finalizingBlockNumber ?? null},
        head_block_number = ${observed?.finality.headBlockNumber ?? null},
        confirmations = ${observed?.confirmations ?? null},
        execution_result = ${observed?.executionResult ?? null},
        sender = ${observed ? normalized(observed.sender) : null},
        recipient = ${observed ? normalized(observed.recipient) : null},
        value_luna = ${observed?.valueLuna ?? null}, data_text = ${observed?.data ?? null},
        verification_checks = ${verification ? transaction.json(verification.checks) : null},
        verification_reason = ${reason}, verifier_version = ${VERIFIER_VERSION}
      where id = ${attempt.chain_id} and observed_state not in ('finalized', 'invalid')
    `
    if (state === 'invalid') {
      await transaction`
        update refund_attempts set wallet_state = 'payment_failed', failure_code = 'TRANSACTION_INVALID'
        where id = ${attempt.id} and wallet_state in ('payment_verifying', 'payment_pending')
      `
    } else if (attempt.state === 'payment_verifying') {
      await transaction`update refund_attempts set wallet_state = 'payment_pending' where id = ${attempt.id}`
    }
    const view = await getRefund(transaction, input.claimPublicId)
    if (!view) fail('PERSISTENCE_CONFLICT', 'The refund disappeared.')
    return view
  })
}

async function persistVerified(
  client: postgres.Sql,
  input: z.infer<typeof inputSchema>,
  observed: ObservedTransaction,
  verification: TransactionVerification,
): Promise<RefundView> {
  const sender = normalized(observed.sender)
  const recipient = normalized(observed.recipient)
  if (!sender || !recipient) {
    return persistEvidence(client, input, 'inconclusive', 'Verified-shaped refund addresses could not be normalized.', observed, verification)
  }
  return client.begin(async (transaction) => {
    const attempt = await lockedAttempt(transaction, input)
    if (!attempt) fail('REFUND_NOT_AVAILABLE', 'The refund attempt was not found.')
    if (attempt.state === 'refunded') {
      const existing = await getRefund(transaction, input.claimPublicId)
      if (!existing) fail('PERSISTENCE_CONFLICT', 'The verified refund disappeared.')
      return existing
    }
    if (!attempt.chain_id || attempt.transaction_hash !== input.hash) fail('PERSISTENCE_CONFLICT', 'The refund binding changed.')
    await transaction`
      update chain_transactions set
        observed_state = 'finalized', normalized_evidence = ${transaction.json(observed as unknown as postgres.JSONValue)},
        observed_at = clock_timestamp(), block_number = ${observed.blockNumber},
        block_timestamp_ms = ${observed.blockTimestamp},
        finalizing_block_number = ${observed.finality.finalizingBlockNumber},
        head_block_number = ${observed.finality.headBlockNumber},
        confirmations = ${observed.confirmations ?? null}, execution_result = ${observed.executionResult},
        sender = ${sender}, recipient = ${recipient}, value_luna = ${observed.valueLuna},
        data_text = ${observed.data}, verification_checks = ${transaction.json(verification.checks)},
        verification_reason = ${verification.reason}, verifier_version = ${VERIFIER_VERSION}
      where id = ${attempt.chain_id} and observed_state not in ('finalized', 'invalid')
    `
    const now = (await transaction<{ now: Date }[]>`select clock_timestamp() as now`)[0]?.now
    if (!now) fail('PERSISTENCE_CONFLICT', 'The database clock was unavailable.')
    const inserted = await transaction<{ id: string }[]>`
      insert into refund_transactions (
        attempt_id, claim_id, resolution_id, passport_id,
        chain_transaction_id, verified_at, confirmation_policy
      ) values (
        ${attempt.id}, ${attempt.claim_id}, ${attempt.resolution_id}, ${attempt.passport_id},
        ${attempt.chain_id}, ${now}, ${CONFIRMATION_POLICY}
      ) on conflict (claim_id) do nothing returning id
    `
    if (inserted.length !== 1) fail('PERSISTENCE_CONFLICT', 'The refund could not be finalized once.')
    await transaction`update refund_attempts set wallet_state = 'refunded' where id = ${attempt.id}`
    await transaction`update purchase_passports set status = 'refunded' where id = ${attempt.passport_id} and status = 'active'`
    await transaction`
      insert into protocol_events (
        aggregate_type, aggregate_id, event_type, protocol_version, occurred_at,
        actor_address, correlation_id, evidence_type, evidence_id, payload
      ) values (
        'claim', ${attempt.claim_id}, 'refund.verified', 'NR1', ${now}, ${sender},
        ${randomUUID()}, 'chain', ${attempt.chain_id},
        ${transaction.json({ finalizingBlockNumber: observed.finality.finalizingBlockNumber })}
      )
    `
    const view = await getRefund(transaction, input.claimPublicId)
    if (!view) fail('PERSISTENCE_CONFLICT', 'The verified refund disappeared.')
    return view
  })
}

async function verifyReserved(
  client: postgres.Sql,
  reader: PurchaseTransactionReader,
  input: z.infer<typeof inputSchema>,
  attempt: AttemptRow,
): Promise<RefundView> {
  let observed: ObservedTransaction | null
  try { observed = await reader.getTransaction(input.hash) } catch {
    return persistEvidence(client, input, 'inconclusive', 'The configured RPC could not provide trustworthy refund evidence yet.', null, null)
  }
  if (!observed) return persistEvidence(client, input, 'absent', 'The configured RPC has not returned this refund yet.', null, null)
  const verification = verifyObservedTransaction({
    data: attempt.expected_data,
    hash: input.hash,
    network: attempt.network,
    recipient: attempt.expected_recipient,
    // Claim-key refunds record whichever account Nimiq Pay sent from.
    ...(attempt.recipient_rule === 'claim-key-v2' ? {} : { sender: attempt.expected_sender }),
    valueLuna: positiveLuna(attempt.expected_value_luna),
  }, observed)
  if (verification.outcome === 'verified') return persistVerified(client, input, observed, verification)
  if (verification.outcome === 'invalid') return persistEvidence(client, input, 'invalid', verification.reason, observed, verification)
  return persistEvidence(
    client,
    input,
    verification.outcome === 'pending-finality' ? 'included' : verification.outcome === 'pending-inclusion' ? 'mempool' : 'inconclusive',
    verification.reason,
    observed,
    verification,
  )
}

export async function verifyRefundTransaction(
  client: postgres.Sql,
  reader: PurchaseTransactionReader,
  rawInput: unknown,
): Promise<RefundView> {
  const parsed = inputSchema.safeParse(rawInput)
  if (!parsed.success) throw new RefundLifecycleError('INVALID_REQUEST', 'The refund transaction attachment is invalid.')
  const input = { ...parsed.data, hash: parsed.data.hash.toLowerCase() }
  const reserved = await reserve(client, input)
  if ('claimPublicId' in reserved) return reserved
  return verifyReserved(client, reader, input, reserved)
}

export async function recheckRefundTransaction(
  client: postgres.Sql,
  reader: PurchaseTransactionReader,
  rawInput: unknown,
): Promise<RefundView> {
  const parsed = inputSchema.omit({ hash: true }).safeParse(rawInput)
  if (!parsed.success) throw new RefundLifecycleError('INVALID_REQUEST', 'The refund recheck request is invalid.')
  const view = await getRefund(client, parsed.data.claimPublicId)
  const stored = view?.attempt?.transaction
  const hash = stored?.hash
  if (!view || !stored || !hash) fail('STATE_CONFLICT', 'The refund has no transaction to recheck.')
  if (view.attempt?.state !== 'refunded') {
    return verifyRefundTransaction(client, reader, { ...parsed.data, hash })
  }

  let observed: ObservedTransaction | null
  try { observed = await reader.getTransaction(hash) } catch { observed = null }
  const { sender: expectedSender, ...expectedFields } = view.attempt.expectedPayment
  const verification = observed
    ? verifyObservedTransaction({
        ...expectedFields,
        ...(view.attempt.recipientRule === 'claim-key-v2' ? {} : { sender: expectedSender }),
        hash,
      }, observed)
    : null
  const same = Boolean(observed && verification?.outcome === 'verified'
    && normalized(observed.sender) === stored.sender
    && normalized(observed.recipient) === stored.recipient
    && observed.blockNumber === stored.blockNumber
    && observed.blockTimestamp === stored.blockTimestamp
    && observed.finality.finalizingBlockNumber === stored.finalizingBlockNumber)
  const outcome = observed ? (same ? 'confirmed' : 'exception') : 'inconclusive'
  const reason = outcome === 'confirmed'
    ? 'Independent recheck confirmed the original refund fields, execution, recorded sender, and macro finality.'
    : outcome === 'exception'
      ? `Previously finalized refund evidence regressed or changed: ${verification?.reason ?? 'invalid evidence'}`
      : 'Refund reconciliation RPC was unavailable or absent; original finalized evidence was not rewritten.'
  await client.begin(async (transaction) => {
    const rows = await transaction<{ chain_id: string }[]>`
      select chain_transactions.id as chain_id from refund_attempts
      join claims on claims.id = refund_attempts.claim_id
      join merchants on merchants.id = refund_attempts.merchant_id
      join chain_transactions on chain_transactions.purpose = 'refund' and chain_transactions.resource_id = refund_attempts.id
      where refund_attempts.public_id = ${parsed.data.attemptPublicId}
        and claims.public_id = ${parsed.data.claimPublicId}
        and merchants.public_id = ${parsed.data.merchantPublicId}
        and refund_attempts.wallet_state = 'refunded'
      for share of refund_attempts, chain_transactions
    `
    const row = rows[0]
    if (!row) fail('REFUND_NOT_AVAILABLE', 'The finalized refund was not found for this merchant.')
    await transaction`
      insert into chain_reconciliations (
        chain_transaction_id, outcome, normalized_evidence, reason, verifier_version, checked_at
      ) values (
        ${row.chain_id}, ${outcome},
        ${observed ? transaction.json(observed as unknown as postgres.JSONValue) : null},
        ${reason}, ${VERIFIER_VERSION}, clock_timestamp()
      )
    `
  })
  const refreshed = await getRefund(client, parsed.data.claimPublicId)
  if (!refreshed) fail('PERSISTENCE_CONFLICT', 'The reconciled refund disappeared.')
  return refreshed
}

const HISTORY_PAGE_SIZE = 500

export type RefundOutcomeReconciliation =
  | { refund: RefundView; result: 'recovered'; transactionHash: string }
  | { refund: RefundView; result: 'ruled-out' }
  | { refund: RefundView; result: 'waiting'; headBlockNumber: number; safeAfterHeight: number }

interface UnknownAttemptRow {
  expected_data: string
  expected_recipient: string
  expected_value_luna: string
  has_chain: boolean
  id: string
  network: string
  outcome_reference_height: string | null
  state: RefundAttemptState
}

async function lockUnknownAttempt(
  transaction: postgres.TransactionSql,
  input: Omit<z.infer<typeof inputSchema>, 'hash'>,
): Promise<UnknownAttemptRow> {
  const rows = await transaction<UnknownAttemptRow[]>`
    select refund_attempts.id, refund_attempts.wallet_state as state, refund_attempts.network,
      refund_attempts.expected_recipient, refund_attempts.expected_value_luna::text,
      refund_attempts.expected_data, refund_attempts.outcome_reference_height::text,
      exists (
        select 1 from chain_transactions
        where purpose = 'refund' and resource_id = refund_attempts.id
      ) as has_chain
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
  if (attempt.state !== 'submission_outcome_unknown' || attempt.has_chain) {
    fail('STATE_CONFLICT', 'Only a refund with an unknown wallet outcome can be reconciled.')
  }
  return attempt
}

async function refundView(
  client: postgres.Sql | postgres.TransactionSql,
  claimPublicId: string,
): Promise<RefundView> {
  const view = await getRefund(client, claimPublicId)
  if (!view) fail('PERSISTENCE_CONFLICT', 'The refund disappeared.')
  return view
}

/**
 * Resolve a refund whose native wallet request returned no hash. A transaction carrying
 * this attempt's refund tag is recovered and verified like any attached hash. Otherwise a
 * new attempt is only unlocked once the chain head has passed every block at which a
 * transaction signed for the original request could still be accepted.
 */
export async function reconcileRefundOutcome(
  client: postgres.Sql,
  reader: PurchaseTransactionReader,
  search: AddressTransactionSearch,
  rawInput: unknown,
): Promise<RefundOutcomeReconciliation> {
  const parsed = inputSchema.omit({ hash: true }).safeParse(rawInput)
  if (!parsed.success) throw new RefundLifecycleError('INVALID_REQUEST', 'The refund reconciliation request is invalid.')
  const input = parsed.data
  const expectation = await client.begin((transaction) => lockUnknownAttempt(transaction, input))

  let head: { blockNumber: number; network: string }
  let history: Awaited<ReturnType<AddressTransactionSearch['listTransactionsByAddress']>>
  try {
    head = await search.getHead()
    history = await search.listTransactionsByAddress(expectation.expected_recipient, HISTORY_PAGE_SIZE)
  } catch {
    throw new RefundLifecycleError('RPC_UNAVAILABLE', 'Chain history is unavailable; the refund outcome stays unknown.')
  }
  if (head.network !== expectation.network) fail('EVIDENCE_INTEGRITY', 'The RPC network does not match the refund.')

  const candidates = history.filter((entry) => entry.data === expectation.expected_data
    && normalized(entry.recipient) === expectation.expected_recipient)
  const bound = candidates.length === 0 ? [] : await client<{ transaction_hash: string }[]>`
    select transaction_hash from chain_transactions
    where network = ${expectation.network}
      and transaction_hash in ${client(candidates.map((entry) => entry.hash))}
  `
  const boundHashes = new Set(bound.map((row) => row.transaction_hash))
  const tagged = candidates.find((entry) => !boundHashes.has(entry.hash))
  if (tagged) {
    const refund = await verifyRefundTransaction(client, reader, { ...input, hash: tagged.hash })
    return { refund, result: 'recovered', transactionHash: tagged.hash }
  }

  return client.begin(async (transaction) => {
    const attempt = await lockUnknownAttempt(transaction, input)
    let referenceHeight = attempt.outcome_reference_height === null ? null : Number(attempt.outcome_reference_height)
    if (referenceHeight === null) {
      // No height was recorded when the wallet opened, so start the safety window now.
      referenceHeight = head.blockNumber
      await transaction`
        update refund_attempts set outcome_reference_height = ${referenceHeight}
        where id = ${attempt.id} and outcome_reference_height is null
      `
    }
    const safeAfterHeight = referenceHeight + REFUND_OUTCOME_SAFETY_BLOCKS
    const oldest = history.at(-1)
    const historyCoversWindow = history.length < HISTORY_PAGE_SIZE
      || (oldest !== undefined && oldest.blockNumber < referenceHeight)
    if (head.blockNumber < safeAfterHeight || !historyCoversWindow) {
      return {
        headBlockNumber: head.blockNumber,
        refund: await refundView(transaction, input.claimPublicId),
        result: 'waiting' as const,
        safeAfterHeight,
      }
    }
    await transaction`
      update refund_attempts set
        wallet_state = 'payment_cancelled',
        outcome_ruled_out_at = clock_timestamp(),
        outcome_ruled_out_height = ${head.blockNumber}
      where id = ${attempt.id} and wallet_state = 'submission_outcome_unknown'
    `
    await transaction`
      insert into protocol_events (
        aggregate_type, aggregate_id, event_type, protocol_version, occurred_at,
        correlation_id, evidence_type, payload
      )
      select 'claim', refund_attempts.claim_id, 'refund.outcome-ruled-out', 'NR1', clock_timestamp(),
        ${randomUUID()}, 'backend',
        ${transaction.json({ headBlockNumber: head.blockNumber, referenceHeight })}
      from refund_attempts where refund_attempts.id = ${attempt.id}
    `
    return { refund: await refundView(transaction, input.claimPublicId), result: 'ruled-out' as const }
  })
}
