import { normalizeNimiqAddress } from '../../lib/crypto/nimiq-signature.js'

interface RpcApiResult {
  body: unknown
  ok: boolean
  status: number
}

export type RpcVerificationOutcome =
  | 'idle'
  | 'inconclusive'
  | 'invalid'
  | 'pending-finality'
  | 'pending-inclusion'
  | 'verified'

export interface RpcVerificationState {
  detail: string
  lastCheckedAtUtc: string | null
  outcome: RpcVerificationOutcome
}

export interface RpcObservedEvidence {
  executionResult: boolean | null
  finalityReached: boolean | null
  finalizingMacroBlock: number | null
  headBlock: number | null
  inclusionBlock: number | null
  observedData: string | null
  observedRecipient: string | null
  observedSender: string | null
  observedValueLuna: number | null
  senderIsListedWalletAccount: boolean
}

export const initialRpcVerificationState: RpcVerificationState = {
  detail: 'Not run yet.',
  lastCheckedAtUtc: null,
  outcome: 'idle',
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
}

function outcomeFromBody(body: unknown): RpcVerificationOutcome | null {
  const record = asRecord(body)
  const verification = record ? asRecord(record.verification) : null
  const value = verification?.outcome ?? record?.outcome
  return value === 'inconclusive' ||
    value === 'invalid' ||
    value === 'pending-finality' ||
    value === 'pending-inclusion' ||
    value === 'verified'
    ? value
    : null
}

function summaryFromBody(body: unknown): string | null {
  const record = asRecord(body)
  const verification = record ? asRecord(record.verification) : null
  if (typeof verification?.reason === 'string') return verification.reason
  if (typeof record?.reason === 'string') return record.reason
  if (typeof record?.message === 'string') return record.message
  return null
}

export function classifyRpcVerification(
  result: RpcApiResult,
  checkedAtUtc: string,
): RpcVerificationState {
  const outcome = outcomeFromBody(result.body) ?? 'inconclusive'
  const summary = summaryFromBody(result.body) ?? 'The API returned no verification summary.'
  return {
    outcome,
    detail: result.ok ? summary : `${summary} (HTTP ${result.status})`,
    lastCheckedAtUtc: checkedAtUtc,
  }
}

export function rpcFailureState(checkedAtUtc: string): RpcVerificationState {
  return {
    outcome: 'inconclusive',
    detail: 'The API is unreachable. The transaction remains unverified; do not send again.',
    lastCheckedAtUtc: checkedAtUtc,
  }
}

export function isRpcRetryDisabled(
  hasSubmittedTransaction: boolean,
  requestInFlight: boolean,
): boolean {
  return !hasSubmittedTransaction || requestInFlight
}

export function rpcRetryLabel(
  outcome: RpcVerificationOutcome,
  requestInFlight: boolean,
): string {
  if (requestInFlight) return 'Checking…'
  if (outcome === 'pending-finality') return 'Recheck finality'
  if (outcome === 'pending-inclusion') return 'Check again'
  if (outcome === 'inconclusive') return 'Retry independent lookup'
  return 'Verify through server RPC'
}

export function rpcOutcomeLabel(outcome: RpcVerificationOutcome): string | undefined {
  if (outcome === 'pending-finality') return 'Waiting for finality'
  if (outcome === 'pending-inclusion') return 'Waiting for inclusion'
  if (outcome === 'inconclusive') return 'Inconclusive'
  if (outcome === 'invalid') return 'Invalid'
  return undefined
}

function listedAddressMatches(address: string, walletAccounts: string[]): boolean {
  try {
    const normalized = normalizeNimiqAddress(address)
    return walletAccounts.some((account) => {
      try {
        return normalizeNimiqAddress(account) === normalized
      } catch {
        return false
      }
    })
  } catch {
    return false
  }
}

export function extractRpcObservedEvidence(
  body: unknown,
  walletAccounts: string[],
): RpcObservedEvidence | null {
  const record = asRecord(body)
  const observed = record ? asRecord(record.observed) : null
  if (!observed) return null
  const finality = asRecord(observed.finality)
  const observedSender = typeof observed.sender === 'string' ? observed.sender : null

  return {
    observedSender,
    senderIsListedWalletAccount:
      observedSender !== null && listedAddressMatches(observedSender, walletAccounts),
    observedRecipient: typeof observed.recipient === 'string' ? observed.recipient : null,
    observedValueLuna:
      typeof observed.valueLuna === 'number' && Number.isSafeInteger(observed.valueLuna)
        ? observed.valueLuna
        : null,
    observedData: typeof observed.data === 'string' ? observed.data : null,
    executionResult:
      typeof observed.executionResult === 'boolean' ? observed.executionResult : null,
    inclusionBlock:
      typeof observed.blockNumber === 'number' && Number.isSafeInteger(observed.blockNumber)
        ? observed.blockNumber
        : null,
    finalizingMacroBlock:
      typeof finality?.finalizingBlockNumber === 'number' &&
      Number.isSafeInteger(finality.finalizingBlockNumber)
        ? finality.finalizingBlockNumber
        : null,
    headBlock:
      typeof finality?.headBlockNumber === 'number' &&
      Number.isSafeInteger(finality.headBlockNumber)
        ? finality.headBlockNumber
        : null,
    finalityReached: typeof finality?.reached === 'boolean' ? finality.reached : null,
  }
}
