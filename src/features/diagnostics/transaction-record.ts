import { z } from 'zod'

import { normalizeNimiqAddress } from '../../lib/crypto/nimiq-signature.js'
import type { ProviderNetworkSnapshot } from '../../lib/nimiq/provider.js'
import type { RpcVerificationOutcome } from './rpc-verification.js'

export const DEFAULT_DIAGNOSTIC_VALUE_LUNA = 1_000
export const PHASE_ZERO_TRANSACTION_STORAGE_KEY = 'nimreturn.phase0.transaction.v2'

const addressSchema = z.string().refine((value) => {
  try {
    normalizeNimiqAddress(value)
    return true
  } catch {
    return false
  }
}, 'Invalid Nimiq address.')

const transactionContextSchema = z.object({
  data: z.string().regex(/^NR1:P:[A-Za-z0-9_-]{22}$/u),
  network: z.object({
    blockNumber: z.number().int().nonnegative().safe(),
    consensus: z.literal(true),
  }).strict(),
  recipient: addressSchema,
  submittedAtUtc: z.string().datetime({ offset: true }),
  validityStartHeight: z.number().int().nonnegative().safe(),
  valueLuna: z.number().int().positive().safe(),
  walletAccounts: z.array(addressSchema).min(1),
}).strict()

const submittedTransactionSchema = transactionContextSchema.extend({
  hash: z.string().regex(/^[0-9a-f]{64}$/u),
  status: z.literal('submitted'),
}).strict()

const unknownSubmissionSchema = transactionContextSchema.extend({
  status: z.literal('submission-outcome-unknown'),
}).strict()

const paymentRecordSchema = z.discriminatedUnion('status', [
  submittedTransactionSchema,
  unknownSubmissionSchema,
])

export type PhaseZeroSentTransaction = z.infer<typeof submittedTransactionSchema>
export type PhaseZeroUnknownSubmission = z.infer<typeof unknownSubmissionSchema>
export type PhaseZeroPaymentRecord = z.infer<typeof paymentRecordSchema>

type SessionStorage = Pick<Storage, 'getItem' | 'removeItem' | 'setItem'>

function browserSessionStorage(): SessionStorage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

export function createSubmittedTransaction(input: {
  data: string
  hash: string
  network: ProviderNetworkSnapshot
  recipient: string
  submittedAtUtc: string
  validityStartHeight: number
  valueLuna: number
  walletAccounts: string[]
}): PhaseZeroSentTransaction {
  return submittedTransactionSchema.parse({ ...input, status: 'submitted' })
}

export function createUnknownSubmission(input: {
  data: string
  network: ProviderNetworkSnapshot
  recipient: string
  submittedAtUtc: string
  validityStartHeight: number
  valueLuna: number
  walletAccounts: string[]
}): PhaseZeroUnknownSubmission {
  return unknownSubmissionSchema.parse({ ...input, status: 'submission-outcome-unknown' })
}

export function loadPhaseZeroPaymentRecord(
  storage: SessionStorage | null = browserSessionStorage(),
): PhaseZeroPaymentRecord | null {
  if (!storage) return null
  try {
    const serialized = storage.getItem(PHASE_ZERO_TRANSACTION_STORAGE_KEY)
    if (!serialized) return null
    const parsed: unknown = JSON.parse(serialized)
    const result = paymentRecordSchema.safeParse(parsed)
    return result.success ? result.data : null
  } catch {
    return null
  }
}

export function persistPhaseZeroPaymentRecord(
  record: PhaseZeroPaymentRecord,
  storage: SessionStorage | null = browserSessionStorage(),
): boolean {
  if (!storage) return false
  try {
    storage.setItem(PHASE_ZERO_TRANSACTION_STORAGE_KEY, JSON.stringify(record))
    return true
  } catch {
    return false
  }
}

export function clearPhaseZeroPaymentRecord(
  storage: SessionStorage | null = browserSessionStorage(),
): boolean {
  if (!storage) return false
  try {
    storage.removeItem(PHASE_ZERO_TRANSACTION_STORAGE_KEY)
    return true
  } catch {
    return false
  }
}

export function submittedTransactionFromRecord(
  record: PhaseZeroPaymentRecord | null,
): PhaseZeroSentTransaction | null {
  return record?.status === 'submitted' ? record : null
}

export function isDiagnosticPaymentLocked(record: PhaseZeroPaymentRecord | null): boolean {
  return record !== null
}

export function requiresClearConfirmation(
  record: PhaseZeroPaymentRecord,
  rpcOutcome: RpcVerificationOutcome,
): boolean {
  return record.status === 'submission-outcome-unknown' || rpcOutcome !== 'verified'
}
