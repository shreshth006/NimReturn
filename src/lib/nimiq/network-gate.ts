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

const verifiedNetworkSchema = z.object({
  blockNumber: z.number().int().nonnegative().safe().nullable(),
  label: z.string().min(1).max(40),
  network: z.string().min(1).max(24),
}).strict()

const networkStatusSchema = z.object({
  expectedNetwork: z.string().min(1).max(24),
  headBlockNumber: z.number().int().nonnegative().safe().nullable(),
  label: z.string().min(1).max(40),
  // Every chain this deployment can verify against. Older servers omit it.
  networks: z.array(verifiedNetworkSchema).max(8).optional(),
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

export function wrongNetworkMessage(labels: string | string[]): string {
  const list = typeof labels === 'string' ? [labels] : labels
  if (list.length <= 1) {
    const only = list[0] ?? 'the verified Nimiq network'
    return `NimReturn currently runs on ${only}. Switch Nimiq Pay to ${only} to continue. Nothing was signed or paid.`
  }
  const readable = `${list.slice(0, -1).join(', ')} or ${list[list.length - 1]}`
  return `NimReturn verifies purchases on ${readable}. Switch Nimiq Pay to one of them to continue. Nothing was signed or paid.`
}

export interface WalletNetworkIdentity {
  label: string
  network: string
  snapshot: ProviderNetworkSnapshot
}

/** The chains the server can verify, tolerating a server that predates multi-network support. */
function verifiedNetworks(status: NetworkStatus): { blockNumber: number; label: string; network: string }[] {
  const listed = (status.networks ?? []).flatMap((entry) => entry.blockNumber === null
    ? []
    : [{ blockNumber: entry.blockNumber, label: entry.label, network: entry.network }])
  if (listed.length > 0) return listed
  return status.headBlockNumber === null
    ? []
    : [{ blockNumber: status.headBlockNumber, label: status.label, network: status.expectedNetwork }]
}

/**
 * Works out which verified chain the wallet is on, because Nimiq Pay reports only the
 * constant name "nimiq". Fails closed: an unreadable status, a chain that cannot be
 * confirmed, or a head matching more than one chain all refuse rather than guess.
 */
export async function identifyWalletNetwork(
  provider: NimiqProvider,
  readStatus: () => Promise<NetworkStatus> = fetchNetworkStatus,
): Promise<WalletNetworkIdentity> {
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
  const available = verifiedNetworks(status)
  if (available.length === 0) {
    throw new WalletOperationError(
      'network-unverified',
      `NimReturn could not confirm ${status.label} right now. Nothing was signed or paid; retry shortly.`,
    )
  }
  assertWalletConsensusForPayment(snapshot)
  const matches = available.filter((entry) => walletMatchesNetwork(snapshot.blockNumber, entry.blockNumber))
  if (matches.length === 0) {
    throw new WalletOperationError('wrong-network', wrongNetworkMessage(available.map((entry) => entry.label)))
  }
  if (matches.length > 1) {
    throw new WalletOperationError(
      'network-unverified',
      'NimReturn could not tell which Nimiq network this wallet is on. Nothing was signed or paid; retry shortly.',
    )
  }
  const identified = matches[0]
  if (!identified) {
    throw new WalletOperationError(
      'network-unverified',
      'NimReturn could not confirm the Nimiq network right now. Nothing was signed or paid; retry shortly.',
    )
  }
  return { label: identified.label, network: identified.network, snapshot }
}

/**
 * Must run before every signature or payment request. It never opens a wallet prompt;
 * it only reads the wallet head and fails closed when the network cannot be confirmed.
 */
export async function assertWalletOnExpectedNetwork(
  provider: NimiqProvider,
  readStatus: () => Promise<NetworkStatus> = fetchNetworkStatus,
): Promise<ProviderNetworkSnapshot> {
  return (await identifyWalletNetwork(provider, readStatus)).snapshot
}
