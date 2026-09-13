import { normalizeNimiqAddress } from '../crypto/nimiq-signature.js'

export type ObservedTransactionState = 'confirmed' | 'included' | 'pending' | 'unknown'

export interface ExpectedTransaction {
  data: string
  hash: string
  network: string
  recipient: string
  sender: string
  valueLuna: number
}

export interface ObservedTransaction {
  confirmations?: number
  data: string
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
    hash: boolean
    network: boolean
    recipient: boolean
    sender: boolean
    state: boolean
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

export function verifyObservedTransaction(
  expected: ExpectedTransaction,
  observed: ObservedTransaction,
): TransactionVerification {
  const checks = {
    hash: expected.hash.toLowerCase() === observed.hash.toLowerCase(),
    network: expected.network === observed.network,
    sender: normalizedAddressEquals(expected.sender, observed.sender),
    recipient: normalizedAddressEquals(expected.recipient, observed.recipient),
    value:
      Number.isSafeInteger(expected.valueLuna) &&
      Number.isSafeInteger(observed.valueLuna) &&
      expected.valueLuna === observed.valueLuna,
    data: expected.data === observed.data,
    state: observed.state === 'included' || observed.state === 'confirmed',
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
      .filter(([name, passed]) => name !== 'state' && !passed)
      .map(([name]) => name)
      .join(', ')
    return { checks, outcome: 'invalid', reason: `Transaction mismatch: ${failed}.` }
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

  return {
    checks,
    outcome: 'verified',
    reason: 'Transaction fields and included state match the diagnostic request.',
  }
}
