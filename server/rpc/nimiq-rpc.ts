import type { ObservedTransaction } from '../../src/lib/protocol/transaction-verification.js'

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

function firstBoolean(record: Record<string, unknown>, keys: string[]): boolean | undefined {
  for (const key of keys) {
    if (typeof record[key] === 'boolean') return record[key]
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

export interface RpcFinalityContext {
  finalizingBlockNumber: number
  headBlockNumber: number
  network: string
}

export function normalizeRpcTransaction(
  value: unknown,
  context: RpcFinalityContext,
): ObservedTransaction {
  const record = asRecord(value)
  if (!record) throw new NimiqRpcError('RPC transaction result was not an object')

  const hash = firstString(record, ['hash', 'transactionHash', 'transaction_hash'])
  const sender = firstString(record, ['from', 'sender'])
  const recipient = firstString(record, ['to', 'recipient'])
  const valueLuna = firstNumber(record, ['value', 'valueLuna', 'value_luna'])
  const data = readData(record)
  const blockNumber = firstNumber(record, ['blockNumber', 'block_number'])
  const executionResult = firstBoolean(record, ['executionResult', 'execution_result'])

  if (
    !hash ||
    !sender ||
    !recipient ||
    valueLuna === undefined ||
    data === undefined ||
    blockNumber === undefined ||
    executionResult === undefined
  ) {
    throw new NimiqRpcError('RPC transaction omitted a required verification field')
  }

  if (
    !Number.isSafeInteger(context.headBlockNumber) ||
    !Number.isSafeInteger(context.finalizingBlockNumber) ||
    context.headBlockNumber < blockNumber ||
    context.finalizingBlockNumber <= blockNumber
  ) {
    throw new NimiqRpcError('RPC returned invalid transaction finality evidence')
  }

  const confirmations = firstNumber(record, ['confirmations'])
  const finalityReached = context.headBlockNumber >= context.finalizingBlockNumber
  return {
    blockNumber,
    hash,
    sender,
    recipient,
    valueLuna,
    data,
    executionResult,
    finality: {
      finalizingBlockNumber: context.finalizingBlockNumber,
      headBlockNumber: context.headBlockNumber,
      reached: finalityReached,
    },
    network: firstString(record, ['network']) ?? context.network,
    state: finalityReached ? 'finalized' : 'included',
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

  async getHead(): Promise<{ blockNumber: number; network: string }> {
    const latest = asRecord(await this.call('getLatestBlock', [false]))
    const network = latest ? firstString(latest, ['network']) : undefined
    const blockNumber = latest ? firstNumber(latest, ['number', 'blockNumber']) : undefined
    if (!network || blockNumber === undefined) {
      throw new NimiqRpcError('Latest block did not report its network and height')
    }
    return { blockNumber, network }
  }

  async getNetwork(): Promise<string> {
    return (await this.getHead()).network
  }

  async getTransaction(hash: string): Promise<ObservedTransaction | null> {
    const [head, transaction] = await Promise.all([
      this.getHead(),
      this.call('getTransactionByHash', [hash]),
    ])
    if (transaction === null) return null

    const record = asRecord(transaction)
    const blockNumber = record ? firstNumber(record, ['blockNumber', 'block_number']) : undefined
    if (blockNumber === undefined) {
      throw new NimiqRpcError('RPC transaction omitted its inclusion block')
    }

    const finalizingBlockNumber = await this.call('getMacroBlockAfter', [blockNumber])
    if (typeof finalizingBlockNumber !== 'number' || !Number.isSafeInteger(finalizingBlockNumber)) {
      throw new NimiqRpcError('RPC did not return the finalizing macro block')
    }

    return normalizeRpcTransaction(transaction, {
      finalizingBlockNumber,
      headBlockNumber: head.blockNumber,
      network: head.network,
    })
  }
}
