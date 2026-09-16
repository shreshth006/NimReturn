import {
  init,
  type ErrorResponse,
  type NimiqProvider,
  type SignatureResult,
} from '@nimiq/mini-app-sdk'

export type WalletErrorKind =
  | 'cancelled'
  | 'consensus-unavailable'
  | 'invalid-response'
  | 'provider-unavailable'
  | 'unknown'

export class WalletOperationError extends Error {
  override readonly name = 'WalletOperationError'

  constructor(
    readonly kind: WalletErrorKind,
    message: string,
  ) {
    super(message)
  }
}

export interface ProviderNetworkSnapshot {
  blockNumber: number
  consensus: boolean
}

function isErrorResponse(value: unknown): value is ErrorResponse {
  if (typeof value !== 'object' || value === null || !('error' in value)) return false
  const error = (value as { error?: unknown }).error
  return typeof error === 'object'
    && error !== null
    && 'message' in error
    && typeof (error as { message?: unknown }).message === 'string'
}

function unwrap<T>(value: ErrorResponse | T): T {
  if (isErrorResponse(value)) {
    throw normalizeWalletError(value.error)
  }
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function walletErrorFields(error: unknown): {
  code: number | string | null
  message: string
  normalized: string
} {
  const outer = isRecord(error) ? error : null
  const nested = outer && isRecord(outer.error) ? outer.error : null
  const records = [outer, nested].filter((value): value is Record<string, unknown> => value !== null)
  const firstString = (key: string): string | undefined => records
    .map((record) => record[key])
    .find((value): value is string => typeof value === 'string' && value.trim().length > 0)
  const firstCode = records
    .map((record) => record.code)
    .find((value): value is number | string => typeof value === 'number' || typeof value === 'string')
  const message = error instanceof Error
    ? error.message
    : typeof error === 'string' && error.trim().length > 0
      ? error
      : firstString('message') ?? 'The wallet request failed.'
  const descriptors = [
    error instanceof Error ? error.name : undefined,
    firstString('name'),
    firstString('type'),
    message,
  ].filter((value): value is string => typeof value === 'string')

  return {
    code: firstCode ?? null,
    message,
    normalized: descriptors.join(' ').toLowerCase(),
  }
}

export function normalizeWalletError(error: unknown): WalletOperationError {
  if (error instanceof WalletOperationError) return error

  const { code, message, normalized } = walletErrorFields(error)

  if (
    code === 4001
    || code === '4001'
    || /cancel|permission[ _-]*denied|user[ _-]*reject|request[ _-]*reject/u.test(normalized)
  ) {
    return new WalletOperationError('cancelled', 'The wallet request was cancelled. Nothing was approved.')
  }
  if (/not injected|inside a nimiq app|timed?\s*out|timeout/u.test(normalized)) {
    return new WalletOperationError(
      'provider-unavailable',
      'Nimiq Pay did not provide a wallet connection. Open this page inside Nimiq Pay and retry.',
    )
  }
  return new WalletOperationError('unknown', message)
}

export async function initializeNimiqProvider(timeout = 10_000): Promise<NimiqProvider> {
  try {
    return await init({ timeout })
  } catch (error) {
    throw normalizeWalletError(error)
  }
}

export async function requestAccounts(provider: NimiqProvider): Promise<string[]> {
  try {
    const accounts = unwrap(await provider.listAccounts())
    if (!Array.isArray(accounts) || accounts.some((account) => typeof account !== 'string')) {
      throw new WalletOperationError('invalid-response', 'Nimiq Pay returned an invalid account list.')
    }
    if (accounts.length === 0) {
      throw new WalletOperationError('invalid-response', 'Nimiq Pay returned no available NIM account.')
    }
    return accounts
  } catch (error) {
    throw normalizeWalletError(error)
  }
}

export async function requestSignature(
  provider: NimiqProvider,
  message: string,
): Promise<SignatureResult> {
  try {
    const result = unwrap(await provider.sign(message))
    if (
      typeof result !== 'object' ||
      result === null ||
      typeof result.publicKey !== 'string' ||
      typeof result.signature !== 'string'
    ) {
      throw new WalletOperationError('invalid-response', 'Nimiq Pay returned an invalid signature proof.')
    }
    return result
  } catch (error) {
    throw normalizeWalletError(error)
  }
}

export async function readProviderNetwork(provider: NimiqProvider): Promise<ProviderNetworkSnapshot> {
  try {
    const [consensus, blockNumber] = await Promise.all([
      provider.isConsensusEstablished(),
      provider.getBlockNumber(),
    ])
    if (typeof consensus !== 'boolean' || !Number.isSafeInteger(blockNumber) || blockNumber < 0) {
      throw new WalletOperationError('invalid-response', 'Nimiq Pay returned invalid network status.')
    }
    return { consensus, blockNumber }
  } catch (error) {
    throw normalizeWalletError(error)
  }
}

export function assertWalletConsensusForPayment(snapshot: ProviderNetworkSnapshot): void {
  if (!snapshot.consensus) {
    throw new WalletOperationError(
      'consensus-unavailable',
      'The wallet provider is reachable and returned a head, but consensus is not established. No payment request was opened; wait and retry the network check.',
    )
  }
}

export async function sendTransactionWithData(
  provider: NimiqProvider,
  network: ProviderNetworkSnapshot,
  request: {
    data: string
    recipient: string
    validityStartHeight: number
    value: number
  },
): Promise<string> {
  assertWalletConsensusForPayment(network)
  try {
    const result = unwrap(await provider.sendBasicTransactionWithData(request))
    if (typeof result !== 'string' || !/^[0-9a-f]{64}$/iu.test(result)) {
      throw new WalletOperationError(
        'invalid-response',
        'Nimiq Pay did not return the expected 32-byte transaction hash.',
      )
    }
    return result.toLowerCase()
  } catch (error) {
    throw normalizeWalletError(error)
  }
}
