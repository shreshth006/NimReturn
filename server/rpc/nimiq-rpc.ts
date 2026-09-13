import type { ObservedTransaction, ObservedTransactionState } from '../../src/lib/protocol/transaction-verification.js'

interface JsonRpcSuccess {
  result?: {
    data?: unknown
  }
}

interface JsonRpcFailure {
  error?: {
    code?: number
    data?: unknown
    message?: string
  }
}

export class NimiqRpcError extends Error {
  override readonly name = 'NimiqRpcError'
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
}

function firstString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    if (typeof record[key] === 'string') return record[key]
  }
  return undefined
}

function firstNumber(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    if (typeof record[key] === 'number' && Number.isSafeInteger(record[key])) {
      return record[key]
    }
  }
  return undefined
}

function hexToText(value: string): string | null {
  const hex = value.startsWith('0x') ? value.slice(2) : value
  if (hex.length % 2 !== 0 || !/^[0-9a-f]+$/iu.test(hex)) return null

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(
      hex.match(/.{2}/gu) ?? [],
      (byte) => Number.parseInt(byte, 16),
    ))
  } catch {
    return null
  }
}

function readData(record: Record<string, unknown>): string | undefined {
  const direct = firstString(record, ['recipientData', 'recipient_data', 'data'])
  if (direct !== undefined) {
    if (direct.startsWith('NR1:')) return direct
    return hexToText(direct) ?? direct
  }

  const data = asRecord(record.data)
  if (!data) return undefined
  const raw = firstString(data, ['raw'])
  return raw === undefined ? undefined : (hexToText(raw) ?? raw)
}

function readState(record: Record<string, unknown>): ObservedTransactionState {
  const rawState = firstString(record, ['state'])?.toLowerCase()
  if (rawState === 'confirmed') return 'confirmed'
  if (rawState === 'included' || rawState === 'mined') return 'included'
  if (rawState === 'pending' || rawState === 'mempool' || rawState === 'new') return 'pending'

  const confirmations = firstNumber(record, ['confirmations'])
  if (confirmations !== undefined && confirmations > 0) return 'confirmed'
  const blockNumber = firstNumber(record, ['blockNumber', 'block_number'])
  return blockNumber !== undefined && blockNumber > 0 ? 'included' : 'unknown'
}

export function normalizeRpcTransaction(value: unknown, network: string): ObservedTransaction {
  const record = asRecord(value)
  if (!record) throw new NimiqRpcError('RPC transaction result was not an object')

  const hash = firstString(record, ['hash', 'transactionHash', 'transaction_hash'])
  const sender = firstString(record, ['from', 'sender'])
  const recipient = firstString(record, ['to', 'recipient'])
  const valueLuna = firstNumber(record, ['value', 'valueLuna', 'value_luna'])
  const data = readData(record)

  if (!hash || !sender || !recipient || valueLuna === undefined || data === undefined) {
    throw new NimiqRpcError('RPC transaction omitted a required verification field')
  }

  const confirmations = firstNumber(record, ['confirmations'])
  return {
    hash,
    sender,
    recipient,
    valueLuna,
    data,
    network: firstString(record, ['network']) ?? network,
    state: readState(record),
    ...(confirmations === undefined ? {} : { confirmations }),
  }
}

export class NimiqRpcClient {
  constructor(
    private readonly url: string,
    private readonly timeoutMs = 8_000,
  ) {}

  private async call(method: string, params: unknown[]): Promise<unknown> {
    let response: Response
    try {
      response = await fetch(this.url, {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: crypto.randomUUID(), method, params }),
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch {
      throw new NimiqRpcError('Nimiq RPC request failed or timed out')
    }

    if (!response.ok) {
      throw new NimiqRpcError(`Nimiq RPC returned HTTP ${response.status}`)
    }

    const body = (await response.json()) as JsonRpcSuccess & JsonRpcFailure
    if (body.error) {
      throw new NimiqRpcError(body.error.message ?? 'Nimiq RPC returned an error')
    }
    if (!body.result || !Object.hasOwn(body.result, 'data')) {
      throw new NimiqRpcError('Nimiq RPC response had no result data')
    }
    return body.result.data
  }

  async getNetwork(): Promise<string> {
    const latest = asRecord(await this.call('getLatestBlock', [false]))
    const network = latest ? firstString(latest, ['network']) : undefined
    if (!network) throw new NimiqRpcError('Latest block did not report its network')
    return network
  }

  async getTransaction(hash: string): Promise<ObservedTransaction | null> {
    const [network, transaction] = await Promise.all([
      this.getNetwork(),
      this.call('getTransactionByHash', [hash]),
    ])
    if (transaction === null) return null
    return normalizeRpcTransaction(transaction, network)
  }
}
