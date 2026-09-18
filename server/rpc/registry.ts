import { NimiqRpcClient, NimiqRpcError } from './nimiq-rpc.js'
import type { ObservedTransaction } from '../../src/lib/protocol/transaction-verification.js'
import type { AddressTransactionSummary } from './nimiq-rpc.js'

/**
 * Chain reads are routed to the node configured for that record's own network.
 * There is deliberately no fallback across networks: an unavailable node fails
 * closed rather than answering with the other chain's history (D-039).
 */
export class NimiqRpcRegistry {
  private readonly clients: ReadonlyMap<string, NimiqRpcClient>

  constructor(clients: ReadonlyMap<string, NimiqRpcClient>) {
    this.clients = clients
  }

  static fromUrls(urlsByNetwork: Readonly<Record<string, string | undefined>>): NimiqRpcRegistry {
    const clients = new Map<string, NimiqRpcClient>()
    for (const [network, url] of Object.entries(urlsByNetwork)) {
      if (url) clients.set(network, new NimiqRpcClient(url))
    }
    return new NimiqRpcRegistry(clients)
  }

  get networks(): string[] {
    return [...this.clients.keys()]
  }

  get configured(): boolean {
    return this.clients.size > 0
  }

  has(network: string): boolean {
    return this.clients.has(network)
  }

  /** Throws rather than guessing when the record's network has no configured node. */
  clientFor(network: string): NimiqRpcClient {
    const client = this.clients.get(network)
    if (!client) {
      throw new NimiqRpcError(`No Nimiq RPC node is configured for ${network}.`)
    }
    return client
  }

  getTransaction(hash: string, network: string): Promise<ObservedTransaction | null> {
    return this.clientFor(network).getTransaction(hash)
  }

  getHead(network: string): Promise<{ blockNumber: number; network: string }> {
    return this.clientFor(network).getHead()
  }

  listTransactionsByAddress(address: string, max: number, network: string): Promise<AddressTransactionSummary[]> {
    return this.clientFor(network).listTransactionsByAddress(address, max)
  }

  /** Heads for every configured network, for wallet-network detection. Unreachable nodes report null. */
  async heads(): Promise<{ blockNumber: number | null; network: string; observedNetwork: string | null }[]> {
    return Promise.all([...this.clients.entries()].map(async ([network, client]) => {
      try {
        const head = await client.getHead()
        // A node that reports a different chain than it is configured for is not trusted for that chain.
        if (head.network !== network) return { blockNumber: null, network, observedNetwork: head.network }
        return { blockNumber: head.blockNumber, network, observedNetwork: head.network }
      } catch {
        return { blockNumber: null, network, observedNetwork: null }
      }
    }))
  }
}
