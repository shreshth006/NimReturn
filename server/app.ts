import cors from '@fastify/cors'
import Fastify from 'fastify'
import type postgres from 'postgres'
import { z } from 'zod'

import { verifyObservedTransaction } from '../src/lib/protocol/transaction-verification.js'
import {
  getPublicVerifiedProduct,
  PublicProductReadError,
} from './domain/get-public-product.js'
import type { ServerConfig } from './config.js'
import { NimiqRpcError } from './rpc/nimiq-rpc.js'
import type { NimiqRpcClient } from './rpc/nimiq-rpc.js'

const publicToken = z.string().regex(/^[A-Za-z0-9_-]{22}$/u)
const transactionHash = z.string().regex(/^[0-9a-f]{64}$/iu)
const verifyBodySchema = z.object({
  data: z.string().min(1).refine((value) => new TextEncoder().encode(value).byteLength <= 64),
  hash: transactionHash,
  recipient: z.string().min(1).max(64),
  valueLuna: z.number().int().positive().safe(),
}).strict()

type PublicProductReader = typeof getPublicVerifiedProduct

export interface AppDependencies {
  database?: postgres.Sql | null
  readPublicProduct?: PublicProductReader
  rpc?: NimiqRpcClient | null
}

export async function buildApp(config: ServerConfig, dependencies: AppDependencies = {}) {
  const app = Fastify({
    bodyLimit: 16 * 1024,
    logger: {
      level: config.NODE_ENV === 'production' ? 'info' : 'warn',
      redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers.set-cookie'],
    },
    requestTimeout: 12_000,
  })

  await app.register(cors, {
    origin: config.NODE_ENV === 'production' ? config.CORS_ORIGIN ?? false : true,
  })

  const database = dependencies.database ?? null
  const readPublicProduct = dependencies.readPublicProduct ?? getPublicVerifiedProduct
  const rpc = dependencies.rpc ?? null

  app.get('/health', () => ({
    phase: 1,
    service: 'nimreturn-api',
    status: 'ok',
  }))

  app.get('/api/v1/products/:productPublicId', async (request, reply) => {
    const params = z.object({ productPublicId: publicToken }).strict().safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send({
        code: 'INVALID_PRODUCT_ID',
        message: 'The product identifier is invalid.',
      })
    }
    if (!database) {
      return reply.code(503).send({
        code: 'DATABASE_UNAVAILABLE',
        message: 'Verified policy lookup is temporarily unavailable.',
      })
    }

    try {
      const product = await readPublicProduct(database, params.data.productPublicId)
      if (!product) {
        return reply.code(404).send({
          code: 'PRODUCT_NOT_FOUND',
          message: 'No active verified policy was found for this product.',
        })
      }
      return reply.send(product)
    } catch (error) {
      request.log.warn(
        { errorType: error instanceof Error ? error.name : 'UnknownError' },
        'Verified product read failed',
      )
      return reply.code(error instanceof PublicProductReadError && error.code === 'INVALID_REQUEST' ? 400 : 503).send({
        code: error instanceof PublicProductReadError && error.code === 'INVALID_REQUEST'
          ? 'INVALID_PRODUCT_ID'
          : 'POLICY_EVIDENCE_UNAVAILABLE',
        message: error instanceof PublicProductReadError && error.code === 'INVALID_REQUEST'
          ? 'The product identifier is invalid.'
          : 'The active policy could not be safely verified.',
      })
    }
  })

  app.get('/api/v1/diagnostics/rpc', async (request, reply) => {
    if (!rpc) {
      return {
        configured: false,
        connected: false,
        expectedNetwork: config.NIMIQ_NETWORK,
      }
    }

    try {
      const head = await rpc.getHead()
      const networkMatches = head.network === config.NIMIQ_NETWORK
      return reply.code(networkMatches ? 200 : 502).send({
        configured: true,
        connected: true,
        expectedNetwork: config.NIMIQ_NETWORK,
        headBlockNumber: head.blockNumber,
        networkMatches,
        observedNetwork: head.network,
      })
    } catch (error) {
      request.log.warn({ errorType: error instanceof Error ? error.name : 'UnknownError' }, 'RPC readiness check failed')
      return reply.code(502).send({
        code: 'RPC_INCONCLUSIVE',
        configured: true,
        connected: false,
        expectedNetwork: config.NIMIQ_NETWORK,
        message: 'The configured transaction verifier is not currently reachable.',
      })
    }
  })

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
          outcome: 'pending-inclusion',
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

  return app
}
