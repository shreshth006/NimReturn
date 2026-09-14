import { normalizeNimiqAddress } from '../crypto/nimiq-signature.js'

export type ObservedTransactionState = 'finalized' | 'included' | 'pending' | 'unknown'

export interface ObservedTransactionFinality {
  finalizingBlockNumber: number
  headBlockNumber: number
  reached: boolean
}

export interface ExpectedTransaction {
  data: string
  hash: string
  network: string
  recipient: string
  valueLuna: number
}

export interface ObservedTransaction {
  blockNumber: number
  confirmations?: number
  data: string
  executionResult: boolean
  finality: ObservedTransactionFinality
  hash: string
  network: string
  recipient: string
  sender: string
  state: ObservedTransactionState
  valueLuna: number
}

export interface TransactionVerification {
  checks: {
    data: boolean
    execution: boolean
    finality: boolean
    hash: boolean
    network: boolean
    recipient: boolean
    sender: boolean
    value: boolean
  }
  outcome: 'inconclusive' | 'invalid' | 'pending' | 'verified'
  reason: string
}

function normalizedAddressEquals(first: string, second: string): boolean {
  try {
    return normalizeNimiqAddress(first) === normalizeNimiqAddress(second)
  } catch {
    return false
  }
}

function isValidAddress(value: string): boolean {
  try {
    normalizeNimiqAddress(value)
    return true
  } catch {
    return false
  }
}

export function verifyObservedTransaction(
  expected: ExpectedTransaction,
  observed: ObservedTransaction,
): TransactionVerification {
  const checks = {
    hash: expected.hash.toLowerCase() === observed.hash.toLowerCase(),
    network: expected.network === observed.network,
    sender: isValidAddress(observed.sender),
    recipient: normalizedAddressEquals(expected.recipient, observed.recipient),
    value:
      Number.isSafeInteger(expected.valueLuna) &&
      Number.isSafeInteger(observed.valueLuna) &&
      expected.valueLuna === observed.valueLuna,
    data: expected.data === observed.data,
    execution: observed.executionResult,
    finality:
      observed.state === 'finalized' &&
      observed.finality.reached &&
      observed.finality.headBlockNumber >= observed.finality.finalizingBlockNumber &&
      observed.finality.finalizingBlockNumber > observed.blockNumber,
  }

  const identityChecks = [
    checks.hash,
    checks.network,
    checks.sender,
    checks.recipient,
    checks.value,
    checks.data,
  ]

  if (identityChecks.some((passed) => !passed)) {
    const failed = Object.entries(checks)
      .filter(([name, passed]) => name !== 'execution' && name !== 'finality' && !passed)
      .map(([name]) => name)
      .join(', ')
    return { checks, outcome: 'invalid', reason: `Transaction mismatch: ${failed}.` }
  }

  if (!checks.execution) {
    return {
      checks,
      outcome: 'invalid',
      reason: 'Transaction was included but its on-chain executionResult is false.',
    }
  }

  if (observed.state === 'pending') {
    return { checks, outcome: 'pending', reason: 'Transaction matches but is still pending.' }
  }

  if (observed.state === 'unknown') {
    return {
      checks,
      outcome: 'inconclusive',
      reason: 'Transaction matches, but its inclusion state is unknown.',
    }
  }


  if (observed.state === 'included') {
    return {
      checks,
      outcome: 'pending',
      reason: `Transaction is included at block ${observed.blockNumber} but is not final until macro block ${observed.finality.finalizingBlockNumber}.`,
    }
  }

  if (!checks.finality) {
    return {
      checks,
      outcome: 'inconclusive',
      reason: 'Transaction finality evidence is internally inconsistent.',
    }
  }

  return {
    checks,
    outcome: 'verified',
    reason: `Transaction fields, execution, and macro-block finality match at head ${observed.finality.headBlockNumber}.`,
  }
}
