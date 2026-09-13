import cors from '@fastify/cors'
import Fastify from 'fastify'
import { existsSync } from 'node:fs'
import { loadEnvFile } from 'node:process'
import { z } from 'zod'

import { verifyObservedTransaction } from '../src/lib/protocol/transaction-verification.js'
import { NimiqRpcClient, NimiqRpcError } from './rpc/nimiq-rpc.js'

if (existsSync('.env')) loadEnvFile('.env')

const optionalUrl = z.preprocess(
  (value) => value === '' ? undefined : value,
  z.string().url().optional(),
)

const configSchema = z.object({
  CORS_ORIGIN: optionalUrl,
  HOST: z.string().min(1).default('127.0.0.1'),
  NIMIQ_NETWORK: z.string().min(1).default('TestAlbatross'),
  NIMIQ_RPC_URL: optionalUrl,
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
})

const parsedConfig = configSchema.safeParse(process.env)
if (!parsedConfig.success) {
  throw new Error(`Invalid server environment: ${z.prettifyError(parsedConfig.error)}`)
}
const config = parsedConfig.data

const transactionHash = z.string().regex(/^[0-9a-f]{64}$/iu)
const verifyBodySchema = z.object({
  data: z.string().min(1).refine((value) => new TextEncoder().encode(value).byteLength <= 64),
  hash: transactionHash,
  recipient: z.string().min(1).max(64),
  sender: z.string().min(1).max(64),
  valueLuna: z.number().int().positive().safe(),
}).strict()

const app = Fastify({
  bodyLimit: 16 * 1024,
  logger: {
    level: config.NODE_ENV === 'production' ? 'info' : 'warn',
    redact: ['req.headers.authorization'],
  },
  requestTimeout: 12_000,
})

await app.register(cors, {
  origin: config.NODE_ENV === 'production' ? config.CORS_ORIGIN ?? false : true,
})

const rpc = config.NIMIQ_RPC_URL ? new NimiqRpcClient(config.NIMIQ_RPC_URL) : null

app.get('/health', () => ({
  service: 'nimreturn-api',
  status: 'ok',
  phase: 0,
}))

app.get('/api/v1/diagnostics/rpc', () => ({
  configured: rpc !== null,
  expectedNetwork: config.NIMIQ_NETWORK,
}))

app.post('/api/v1/diagnostics/transactions/verify', async (request, reply) => {
  const parsed = verifyBodySchema.safeParse(request.body)
  if (!parsed.success) {
    return reply.code(400).send({
      code: 'INVALID_DIAGNOSTIC_REQUEST',
      message: 'Transaction expectations were invalid.',
    })
  }

  if (!rpc) {
    return reply.code(503).send({
      code: 'RPC_NOT_CONFIGURED',
      message: 'Server-side transaction lookup is unavailable until NIMIQ_RPC_URL is configured.',
    })
  }

  try {
    const observed = await rpc.getTransaction(parsed.data.hash.toLowerCase())
    if (!observed) {
      return reply.code(202).send({
        outcome: 'pending',
        reason: 'The configured node has not returned this transaction yet.',
      })
    }

    const verification = verifyObservedTransaction({
      ...parsed.data,
      hash: parsed.data.hash.toLowerCase(),
      network: config.NIMIQ_NETWORK,
    }, observed)

    return reply.send({ observed, verification })
  } catch (error) {
    request.log.warn({ errorType: error instanceof Error ? error.name : 'UnknownError' }, 'RPC diagnostic failed')
    return reply.code(502).send({
      code: error instanceof NimiqRpcError ? 'RPC_INCONCLUSIVE' : 'VERIFICATION_INCONCLUSIVE',
      message: 'The transaction could not be independently verified yet.',
    })
  }
})

await app.listen({ host: config.HOST, port: config.PORT })
