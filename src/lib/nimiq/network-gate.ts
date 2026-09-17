import type { NimiqProvider } from '@nimiq/mini-app-sdk'
import { z } from 'zod'

import {
  assertWalletConsensusForPayment,
  readProviderNetwork,
  WalletOperationError,
  type ProviderNetworkSnapshot,
} from './provider.js'

const baseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/u, '') ?? ''

// Nimiq Pay's provider reports only the constant "nimiq", so the wallet's network is
// identified by comparing its chain head with the head of the network NimReturn verifies.
export const WALLET_HEAD_TOLERANCE_BLOCKS = 600

const networkStatusSchema = z.object({
  expectedNetwork: z.string().min(1).max(24),
  headBlockNumber: z.number().int().nonnegative().safe().nullable(),
  label: z.string().min(1).max(40),
}).strict()

export type NetworkStatus = z.infer<typeof networkStatusSchema>

export async function fetchNetworkStatus(): Promise<NetworkStatus> {
  const response = await fetch(`${baseUrl}/api/v1/network`, { headers: { accept: 'application/json' } })
  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new Error('NimReturn returned an unreadable network status.')
  }
  const parsed = networkStatusSchema.safeParse(body)
  if (!response.ok || !parsed.success) throw new Error('NimReturn returned an invalid network status.')
  return parsed.data
}

export function walletMatchesNetwork(
  walletHeight: number,
  expectedHeight: number,
  tolerance = WALLET_HEAD_TOLERANCE_BLOCKS,
): boolean {
  return Math.abs(walletHeight - expectedHeight) <= tolerance
}

export function wrongNetworkMessage(label: string): string {
  return `NimReturn currently runs on ${label}. Switch Nimiq Pay to ${label} to continue. Nothing was signed or paid.`
}

/**
 * Must run before every signature or payment request. It never opens a wallet prompt;
 * it only reads the wallet head and fails closed when the network cannot be confirmed.
 */
export async function assertWalletOnExpectedNetwork(
  provider: NimiqProvider,
  readStatus: () => Promise<NetworkStatus> = fetchNetworkStatus,
): Promise<ProviderNetworkSnapshot> {
  const snapshot = await readProviderNetwork(provider)
  let status: NetworkStatus
  try {
    status = await readStatus()
  } catch {
    throw new WalletOperationError(
      'network-unverified',
      'NimReturn could not confirm the Nimiq network right now. Nothing was signed or paid; retry shortly.',
    )
  }
  if (status.headBlockNumber === null) {
    throw new WalletOperationError(
      'network-unverified',
      `NimReturn could not confirm ${status.label} right now. Nothing was signed or paid; retry shortly.`,
    )
  }
  assertWalletConsensusForPayment(snapshot)
  if (!walletMatchesNetwork(snapshot.blockNumber, status.headBlockNumber)) {
    throw new WalletOperationError('wrong-network', wrongNetworkMessage(status.label))
  }
  return snapshot
}
