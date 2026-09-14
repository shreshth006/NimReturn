import cors from '@fastify/cors'
import cookie from '@fastify/cookie'
import rateLimit from '@fastify/rate-limit'
import Fastify from 'fastify'
import type postgres from 'postgres'
import { z } from 'zod'

import { verifyObservedTransaction } from '../src/lib/protocol/transaction-verification.js'
import { policyProofEnvelopeSchema } from '../src/lib/protocol/policy.js'
import {
  createMerchantDraft,
  MerchantDraftCreationError,
} from './domain/create-merchant-draft.js'
import {
  createPolicyChallenge,
  PolicyChallengeCreationError,
} from './domain/create-policy-challenge.js'
import {
  getPublicVerifiedProduct,
  PublicProductReadError,
} from './domain/get-public-product.js'
import type { ServerConfig } from './config.js'
import { PolicyPublishError, publishVerifiedPolicy } from './domain/publish-policy.js'
import {
  createMerchantSessionToken,
  readMerchantSessionToken,
} from './http/merchant-session.js'
import { NimiqRpcError } from './rpc/nimiq-rpc.js'
import type { NimiqRpcClient } from './rpc/nimiq-rpc.js'

const publicToken = z.string().regex(/^[A-Za-z0-9_-]{22}$/u)
const resourceParamsSchema = z.object({
  merchantPublicId: publicToken,
  productPublicId: publicToken,
}).strict()
const createMerchantBodySchema = z.object({
  defaultSettlementAddress: z.string().min(1).max(64),
  description: z.string().max(2_048).optional(),
  displayName: z.string().min(1).max(512),
  productName: z.string().min(1).max(512),
}).strict()
const policyTermsBodySchema = z.object({
  priceLuna: z.number().int().safe().positive(),
  returnWindowSeconds: z.number().int().safe().min(0).max(157_680_000),
  settlementAddress: z.string().min(1).max(64),
  warrantyTransferAllowed: z.boolean(),
  warrantyWindowSeconds: z.number().int().safe().min(0).max(157_680_000),
}).strict()
const publishPolicyBodySchema = z.object({
  challengeNonce: publicToken,
  proof: policyProofEnvelopeSchema,
}).strict()
const transactionHash = z.string().regex(/^[0-9a-f]{64}$/iu)
const verifyBodySchema = z.object({
  data: z.string().min(1).refine((value) => new TextEncoder().encode(value).byteLength <= 64),
  hash: transactionHash,
  recipient: z.string().min(1).max(64),
  valueLuna: z.number().int().positive().safe(),
}).strict()

type PublicProductReader = typeof getPublicVerifiedProduct
const BOOTSTRAP_COOKIE = 'nimreturn_merchant_bootstrap'
const MERCHANT_SESSION_COOKIE = 'nimreturn_merchant_session'

type WriterError = {
  code: string
  message: string
  statusCode: number
}

function writerError(error: unknown): WriterError {
  const code = error instanceof MerchantDraftCreationError
    || error instanceof PolicyChallengeCreationError
    || error instanceof PolicyPublishError
    ? error.code
    : 'WRITER_UNAVAILABLE'
  if (code === 'INVALID_REQUEST') {
    return { code, message: 'The merchant request is invalid.', statusCode: 400 }
  }
  if (code === 'RESOURCE_NOT_FOUND' || code === 'POLICY_NOT_FOUND') {
    return { code, message: 'The merchant product or challenge was not found.', statusCode: 404 }
  }
  if (code === 'BOOTSTRAP_MISMATCH' || code === 'BOOTSTRAP_REQUIRED') {
    return { code: 'MERCHANT_AUTH_REQUIRED', message: 'Merchant authorization is missing or expired.', statusCode: 401 }
  }
  if (code === 'CHALLENGE_EXPIRED') {
    return { code, message: 'The signing challenge expired. Request a fresh challenge.', statusCode: 410 }
  }
  if (code === 'INVALID_PROOF' || code === 'INVALID_SIGNATURE' || code === 'MESSAGE_MISMATCH'
    || code === 'PAYLOAD_HASH_MISMATCH' || code === 'SIGNER_MISMATCH') {
    return { code, message: 'The submitted wallet proof did not verify.', statusCode: 422 }
  }
  if (code === 'CHALLENGE_CONSUMED' || code === 'POLICY_STATE_CONFLICT'
    || code === 'RESOURCE_STATE_CONFLICT' || code === 'PERSISTENCE_CONFLICT') {
    return { code, message: 'The merchant resource changed or was already used.', statusCode: 409 }
  }
  return {
    code: 'WRITER_UNAVAILABLE',
    message: 'The merchant request could not be completed safely.',
    statusCode: 503,
  }
}

export interface AppDependencies {
  createDraft?: typeof createMerchantDraft
  createPolicyChallenge?: typeof createPolicyChallenge
  database?: postgres.Sql | null
  publishPolicy?: typeof publishVerifiedPolicy
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
    credentials: true,
    origin: config.NODE_ENV === 'production' ? config.CORS_ORIGIN ?? false : true,
  })
  await app.register(cookie)
  await app.register(rateLimit, {
    errorResponseBuilder: () => ({
      code: 'RATE_LIMITED',
      message: 'Too many merchant requests. Wait before retrying.',
      statusCode: 429,
    }),
    global: false,
  })

  const database = dependencies.database ?? null
  const createDraft = dependencies.createDraft ?? createMerchantDraft
  const issuePolicyChallenge = dependencies.createPolicyChallenge ?? createPolicyChallenge
  const publishPolicy = dependencies.publishPolicy ?? publishVerifiedPolicy
  const readPublicProduct = dependencies.readPublicProduct ?? getPublicVerifiedProduct
  const rpc = dependencies.rpc ?? null
  const cookieOptions = {
    httpOnly: true,
    path: '/',
    sameSite: 'strict' as const,
    secure: config.NODE_ENV === 'production',
  }

  function writerOriginAllowed(origin: string | undefined): boolean {
    return config.NODE_ENV !== 'production' || origin === config.CORS_ORIGIN
  }

  function merchantAuthorization(
    cookies: Record<string, string | undefined>,
    merchantPublicId: string,
  ): { bootstrapCapability?: string; sessionAuthorized: boolean } | null {
    if (!config.SESSION_SECRET) return null
    const session = readMerchantSessionToken({
      secret: config.SESSION_SECRET,
      token: cookies[MERCHANT_SESSION_COOKIE],
    })
    if (session?.merchantPublicId === merchantPublicId) {
      return { sessionAuthorized: true }
    }
    const bootstrapCapability = cookies[BOOTSTRAP_COOKIE]
    return bootstrapCapability ? { bootstrapCapability, sessionAuthorized: false } : null
  }

  app.get('/health', () => ({
    phase: 1,
    service: 'nimreturn-api',
    status: 'ok',
  }))

  app.post('/api/v1/merchants', {
    config: { rateLimit: { max: 5, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    if (!writerOriginAllowed(request.headers.origin)) {
      return reply.code(403).send({ code: 'ORIGIN_FORBIDDEN', message: 'The request origin is not allowed.' })
    }
    const body = createMerchantBodySchema.safeParse(request.body)
    if (!body.success) {
      return reply.code(400).send({ code: 'INVALID_REQUEST', message: 'The merchant draft is invalid.' })
    }
    if (!database || !config.SESSION_SECRET) {
      return reply.code(503).send({ code: 'WRITER_UNAVAILABLE', message: 'Merchant creation is temporarily unavailable.' })
    }

    try {
      const created = await createDraft(database, body.data)
      reply.setCookie(BOOTSTRAP_COOKIE, created.bootstrapCapability, {
        ...cookieOptions,
        expires: created.bootstrapExpiresAt,
      })
      return reply.code(201).send({
        bootstrapExpiresAt: created.bootstrapExpiresAt,
        merchant: { displayName: created.displayName, publicId: created.merchantPublicId },
        product: { name: created.productName, publicId: created.productPublicId },
      })
    } catch (error) {
      request.log.warn({ errorType: error instanceof Error ? error.name : 'UnknownError' }, 'Merchant draft creation failed')
      const response = writerError(error)
      return reply.code(response.statusCode).send({ code: response.code, message: response.message })
    }
  })

  app.post(
    '/api/v1/merchants/:merchantPublicId/products/:productPublicId/policies/challenges',
    { config: { rateLimit: { max: 12, timeWindow: '10 minutes' } } },
    async (request, reply) => {
      if (!writerOriginAllowed(request.headers.origin)) {
        return reply.code(403).send({ code: 'ORIGIN_FORBIDDEN', message: 'The request origin is not allowed.' })
      }
      const params = resourceParamsSchema.safeParse(request.params)
      const body = policyTermsBodySchema.safeParse(request.body)
      if (!params.success || !body.success) {
        return reply.code(400).send({ code: 'INVALID_REQUEST', message: 'The policy terms are invalid.' })
      }
      if (!database || !config.SESSION_SECRET) {
        return reply.code(503).send({ code: 'WRITER_UNAVAILABLE', message: 'Policy signing is temporarily unavailable.' })
      }
      const authorization = merchantAuthorization(request.cookies, params.data.merchantPublicId)
      if (!authorization) {
        return reply.code(401).send({ code: 'MERCHANT_AUTH_REQUIRED', message: 'Merchant authorization is missing or expired.' })
      }

      try {
        const created = await issuePolicyChallenge(database, {
          ...(authorization.bootstrapCapability
            ? { bootstrapCapability: authorization.bootstrapCapability }
            : {}),
          ...body.data,
          merchantPublicId: params.data.merchantPublicId,
          productPublicId: params.data.productPublicId,
        })
        return reply.code(201).send({
          canonicalMessage: created.canonicalMessage,
          expiresAt: created.expiresAt,
          nonce: created.nonce,
          payload: created.payload,
          payloadHash: created.payloadHash,
        })
      } catch (error) {
        request.log.warn({ errorType: error instanceof Error ? error.name : 'UnknownError' }, 'Policy challenge creation failed')
        const response = writerError(error)
        return reply.code(response.statusCode).send({ code: response.code, message: response.message })
      }
    },
  )

  app.post(
    '/api/v1/merchants/:merchantPublicId/products/:productPublicId/policies/publish',
    { config: { rateLimit: { max: 20, timeWindow: '10 minutes' } } },
    async (request, reply) => {
      if (!writerOriginAllowed(request.headers.origin)) {
        return reply.code(403).send({ code: 'ORIGIN_FORBIDDEN', message: 'The request origin is not allowed.' })
      }
      const params = resourceParamsSchema.safeParse(request.params)
      const body = publishPolicyBodySchema.safeParse(request.body)
      if (!params.success || !body.success) {
        return reply.code(400).send({ code: 'INVALID_REQUEST', message: 'The policy proof is invalid.' })
      }
      if (!database || !config.SESSION_SECRET) {
        return reply.code(503).send({ code: 'WRITER_UNAVAILABLE', message: 'Policy publication is temporarily unavailable.' })
      }
      const authorization = merchantAuthorization(request.cookies, params.data.merchantPublicId)
      if (!authorization) {
        return reply.code(401).send({ code: 'MERCHANT_AUTH_REQUIRED', message: 'Merchant authorization is missing or expired.' })
      }

      try {
        const published = await publishPolicy(database, {
          ...(authorization.bootstrapCapability
            ? { bootstrapCapability: authorization.bootstrapCapability }
            : {}),
          ...body.data,
          merchantPublicId: params.data.merchantPublicId,
          productPublicId: params.data.productPublicId,
        })
        const session = createMerchantSessionToken({
          merchantPublicId: params.data.merchantPublicId,
          secret: config.SESSION_SECRET,
        })
        reply.clearCookie(BOOTSTRAP_COOKIE, cookieOptions)
        reply.setCookie(MERCHANT_SESSION_COOKIE, session.token, {
          ...cookieOptions,
          expires: session.expiresAt,
        })
        return reply.send({
          firstPolicyForMerchant: published.firstPolicyForMerchant,
          productPublicId: params.data.productPublicId,
          signerAddress: published.actualSignerAddress,
          verified: true,
        })
      } catch (error) {
        request.log.warn({ errorType: error instanceof Error ? error.name : 'UnknownError' }, 'Policy publication failed')
        const response = writerError(error)
        return reply.code(response.statusCode).send({ code: response.code, message: response.message })
      }
    },
  )

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
