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
import { getPurchaseOrder } from './domain/get-purchase-order.js'
import { getPurchasePassport } from './domain/get-purchase-passport.js'
import type { ServerConfig } from './config.js'
import { PolicyPublishError, publishVerifiedPolicy } from './domain/publish-policy.js'
import { createPurchaseOrder, PurchaseOrderError } from './domain/purchase-order.js'
import { recordPurchaseWalletState } from './domain/purchase-wallet-state.js'
import {
  recheckPurchaseTransaction,
  verifyPurchaseTransaction,
  type PurchaseTransactionReader,
} from './domain/verify-purchase.js'
import {
  ClaimLifecycleError,
  createClaimChallenge,
  getClaim,
  submitClaimAuthorization,
  submitClaimProof,
} from './domain/claim-lifecycle.js'
import {
  createMerchantSessionToken,
  readMerchantSessionToken,
} from './http/merchant-session.js'
import {
  createResolutionChallenge,
  getClaimResolution,
  listMerchantClaims,
  publishResolution,
  ResolutionLifecycleError,
} from './domain/resolution-lifecycle.js'
import { NimiqRpcError } from './rpc/nimiq-rpc.js'
import type { NimiqRpcClient } from './rpc/nimiq-rpc.js'
import {
  createRefundAttempt,
  getRefund,
  recordRefundWalletState,
  RefundLifecycleError,
} from './domain/refund-lifecycle.js'
import {
  recheckRefundTransaction,
  verifyRefundTransaction,
} from './domain/verify-refund.js'
import {
  getPromiseLedger,
  PromiseLedgerReadError,
} from './domain/get-promise-ledger.js'

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
const productParamsSchema = z.object({ productPublicId: publicToken }).strict()
const orderParamsSchema = z.object({ orderPublicId: publicToken }).strict()
const passportParamsSchema = z.object({ passportPublicId: publicToken }).strict()
const claimParamsSchema = z.object({ claimPublicId: publicToken }).strict()
const claimAuthorizationParamsSchema = z.object({
  authorizationPublicId: publicToken,
  claimPublicId: publicToken,
}).strict()
const createClaimBodySchema = z.object({
  claimType: z.enum(['RETURN', 'WARRANTY']),
  note: z.string().max(2_048).optional(),
  reasonCode: z.enum(['CHANGED_MIND', 'DEFECTIVE', 'NOT_AS_DESCRIBED', 'OTHER']),
}).strict()
const claimProofBodySchema = z.object({ proof: policyProofEnvelopeSchema }).strict()
const resolutionChallengeBodySchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  note: z.string().max(2_048).optional(),
  reasonCode: z.enum([
    'INSUFFICIENT_INFORMATION',
    'POLICY_ACCEPTED',
    'POLICY_NOT_APPLICABLE',
    'OTHER',
  ]),
}).strict()
const resolutionParamsSchema = z.object({
  claimPublicId: publicToken,
  merchantPublicId: publicToken,
}).strict()
const publishResolutionParamsSchema = z.object({
  claimPublicId: publicToken,
  merchantPublicId: publicToken,
  resolutionPublicId: publicToken,
}).strict()
const refundParamsSchema = z.object({
  claimPublicId: publicToken,
  merchantPublicId: publicToken,
}).strict()
const refundAttemptParamsSchema = z.object({
  attemptPublicId: publicToken,
  claimPublicId: publicToken,
  merchantPublicId: publicToken,
}).strict()
const refundWalletStateBodySchema = z.object({
  event: z.enum(['wallet-request-started', 'wallet-cancelled', 'submission-outcome-unknown']),
}).strict()
const merchantParamsSchema = z.object({ merchantPublicId: publicToken }).strict()
const emptyBodySchema = z.object({}).strict()
const walletStateBodySchema = z.object({
  event: z.enum(['wallet-request-started', 'wallet-cancelled', 'submission-outcome-unknown']),
}).strict()
const attachTransactionBodySchema = z.object({ hash: transactionHash }).strict()

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

function purchaseError(error: unknown): WriterError {
  const code = error instanceof PurchaseOrderError ? error.code : 'PURCHASE_UNAVAILABLE'
  if (code === 'INVALID_REQUEST') {
    return { code, message: 'The purchase request is invalid.', statusCode: 400 }
  }
  if (code === 'ORDER_NOT_FOUND' || code === 'PRODUCT_NOT_AVAILABLE') {
    return { code, message: 'The verified product or purchase was not found.', statusCode: 404 }
  }
  if (code === 'ORDER_EXPIRED') {
    return { code, message: 'The purchase request expired.', statusCode: 410 }
  }
  if (code === 'STATE_CONFLICT') {
    return { code, message: 'The purchase state conflicts with this action.', statusCode: 409 }
  }
  if (code === 'EVIDENCE_INTEGRITY') {
    return { code, message: 'The purchase evidence could not be verified safely.', statusCode: 503 }
  }
  return {
    code: 'PURCHASE_UNAVAILABLE',
    message: 'The purchase request could not be completed safely.',
    statusCode: 503,
  }
}

function claimError(error: unknown): WriterError {
  const code = error instanceof ClaimLifecycleError ? error.code : 'CLAIM_UNAVAILABLE'
  if (code === 'INVALID_REQUEST') {
    return { code, message: 'The claim request is invalid.', statusCode: 400 }
  }
  if (code === 'CLAIM_NOT_FOUND' || code === 'AUTHORIZATION_NOT_FOUND') {
    return { code, message: 'The claim or authorization was not found.', statusCode: 404 }
  }
  if (code === 'PASSPORT_NOT_AVAILABLE') {
    return { code, message: 'The verified Purchase Passport is unavailable.', statusCode: 404 }
  }
  if (code === 'CLAIM_TYPE_UNAVAILABLE' || code === 'CHALLENGE_EXPIRED') {
    return { code, message: 'This claim action is unavailable or expired.', statusCode: 410 }
  }
  if (
    code === 'INVALID_PROOF'
    || code === 'INVALID_SIGNATURE'
    || code === 'MESSAGE_MISMATCH'
    || code === 'PAYLOAD_HASH_MISMATCH'
    || code === 'SIGNER_MISMATCH'
  ) {
    return { code, message: 'The submitted claim proof did not verify.', statusCode: 422 }
  }
  if (code === 'CHALLENGE_CONSUMED' || code === 'STATE_CONFLICT') {
    return { code, message: 'The claim state conflicts with this action.', statusCode: 409 }
  }
  if (code === 'EVIDENCE_INTEGRITY') {
    return { code, message: 'The claim evidence could not be verified safely.', statusCode: 503 }
  }
  return {
    code: 'CLAIM_UNAVAILABLE',
    message: 'The claim request could not be completed safely.',
    statusCode: 503,
  }
}

function resolutionError(error: unknown): WriterError {
  const code = error instanceof ResolutionLifecycleError ? error.code : 'RESOLUTION_UNAVAILABLE'
  if (code === 'INVALID_REQUEST') {
    return { code, message: 'The resolution request is invalid.', statusCode: 400 }
  }
  if (code === 'CLAIM_NOT_FOUND' || code === 'RESOLUTION_NOT_FOUND') {
    return { code, message: 'The claim or resolution was not found.', statusCode: 404 }
  }
  if (code === 'CHALLENGE_EXPIRED') {
    return { code, message: 'The resolution challenge expired.', statusCode: 410 }
  }
  if (
    code === 'INVALID_PROOF'
    || code === 'INVALID_SIGNATURE'
    || code === 'MESSAGE_MISMATCH'
    || code === 'PAYLOAD_HASH_MISMATCH'
    || code === 'SIGNER_MISMATCH'
  ) {
    return { code, message: 'The submitted resolution proof did not verify.', statusCode: 422 }
  }
  if (code === 'CHALLENGE_CONSUMED' || code === 'STATE_CONFLICT') {
    return { code, message: 'The claim or resolution state conflicts with this action.', statusCode: 409 }
  }
  if (code === 'EVIDENCE_INTEGRITY') {
    return { code, message: 'The resolution evidence could not be verified safely.', statusCode: 503 }
  }
  return {
    code: 'RESOLUTION_UNAVAILABLE',
    message: 'The resolution request could not be completed safely.',
    statusCode: 503,
  }
}

function refundError(error: unknown): WriterError {
  const code = error instanceof RefundLifecycleError ? error.code : 'REFUND_UNAVAILABLE'
  if (code === 'INVALID_REQUEST') return { code, message: 'The refund request is invalid.', statusCode: 400 }
  if (code === 'REFUND_NOT_AVAILABLE') return { code, message: 'No verified approved refund was found.', statusCode: 404 }
  if (code === 'STATE_CONFLICT') return { code, message: 'The refund state conflicts with this action.', statusCode: 409 }
  if (code === 'EVIDENCE_INTEGRITY') return { code, message: 'The refund evidence could not be verified safely.', statusCode: 503 }
  return { code: 'REFUND_UNAVAILABLE', message: 'The refund request could not be completed safely.', statusCode: 503 }
}

export interface AppDependencies {
  createDraft?: typeof createMerchantDraft
  createOrder?: typeof createPurchaseOrder
  createPolicyChallenge?: typeof createPolicyChallenge
  database?: postgres.Sql | null
  publishPolicy?: typeof publishVerifiedPolicy
  createClaim?: typeof createClaimChallenge
  readClaim?: typeof getClaim
  readOrder?: typeof getPurchaseOrder
  readPassport?: typeof getPurchasePassport
  readPublicProduct?: PublicProductReader
  recordWalletState?: typeof recordPurchaseWalletState
  rpc?: NimiqRpcClient | null
  verifyPurchase?: typeof verifyPurchaseTransaction
  submitClaim?: typeof submitClaimProof
  authorizeClaim?: typeof submitClaimAuthorization
  createResolution?: typeof createResolutionChallenge
  publishResolution?: typeof publishResolution
  readResolution?: typeof getClaimResolution
  readMerchantClaims?: typeof listMerchantClaims
  createRefund?: typeof createRefundAttempt
  readRefund?: typeof getRefund
  recordRefundState?: typeof recordRefundWalletState
  verifyRefund?: typeof verifyRefundTransaction
  recheckRefund?: typeof recheckRefundTransaction
  readPromiseLedger?: typeof getPromiseLedger
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
  const createOrder = dependencies.createOrder ?? createPurchaseOrder
  const createClaim = dependencies.createClaim ?? createClaimChallenge
  const issuePolicyChallenge = dependencies.createPolicyChallenge ?? createPolicyChallenge
  const publishPolicy = dependencies.publishPolicy ?? publishVerifiedPolicy
  const readPublicProduct = dependencies.readPublicProduct ?? getPublicVerifiedProduct
  const readOrder = dependencies.readOrder ?? getPurchaseOrder
  const readPassport = dependencies.readPassport ?? getPurchasePassport
  const readClaim = dependencies.readClaim ?? getClaim
  const updateWalletState = dependencies.recordWalletState ?? recordPurchaseWalletState
  const verifyPurchase = dependencies.verifyPurchase ?? verifyPurchaseTransaction
  const submitClaim = dependencies.submitClaim ?? submitClaimProof
  const authorizeClaim = dependencies.authorizeClaim ?? submitClaimAuthorization
  const createResolution = dependencies.createResolution ?? createResolutionChallenge
  const publishClaimResolution = dependencies.publishResolution ?? publishResolution
  const readResolution = dependencies.readResolution ?? getClaimResolution
  const readMerchantClaims = dependencies.readMerchantClaims ?? listMerchantClaims
  const createRefund = dependencies.createRefund ?? createRefundAttempt
  const readRefund = dependencies.readRefund ?? getRefund
  const updateRefundState = dependencies.recordRefundState ?? recordRefundWalletState
  const verifyRefund = dependencies.verifyRefund ?? verifyRefundTransaction
  const recheckRefund = dependencies.recheckRefund ?? recheckRefundTransaction
  const readPromiseLedger = dependencies.readPromiseLedger ?? getPromiseLedger
  const rpc = dependencies.rpc ?? null
  const purchaseReader: PurchaseTransactionReader = rpc ?? {
    getTransaction: () => Promise.reject(new Error('RPC is not configured.')),
  }
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
    phase: 4,
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
    const params = productParamsSchema.safeParse(request.params)
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

  app.post('/api/v1/products/:productPublicId/orders', {
    config: { rateLimit: { max: 20, timeWindow: '10 minutes' } },
  }, async (request, reply) => {
    if (!writerOriginAllowed(request.headers.origin)) {
      return reply.code(403).send({ code: 'ORIGIN_FORBIDDEN', message: 'The request origin is not allowed.' })
    }
    const params = productParamsSchema.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send({ code: 'INVALID_REQUEST', message: 'The product identifier is invalid.' })
    }
    if (!database) {
      return reply.code(503).send({ code: 'PURCHASE_UNAVAILABLE', message: 'Purchase creation is temporarily unavailable.' })
    }
    try {
      const order = await createOrder(database, {
        network: config.NIMIQ_NETWORK,
        productPublicId: params.data.productPublicId,
      })
      return reply.code(201).send(order)
    } catch (error) {
      request.log.warn({ errorType: error instanceof Error ? error.name : 'UnknownError' }, 'Purchase order creation failed')
      const response = purchaseError(error)
      return reply.code(response.statusCode).send({ code: response.code, message: response.message })
    }
  })

  app.get('/api/v1/orders/:orderPublicId', async (request, reply) => {
    const params = orderParamsSchema.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send({ code: 'INVALID_REQUEST', message: 'The purchase identifier is invalid.' })
    }
    if (!database) {
      return reply.code(503).send({ code: 'PURCHASE_UNAVAILABLE', message: 'Purchase status is temporarily unavailable.' })
    }
    try {
      const order = await readOrder(database, params.data.orderPublicId)
      if (!order) return reply.code(404).send({ code: 'ORDER_NOT_FOUND', message: 'The purchase was not found.' })
      return reply.send(order)
    } catch (error) {
      const response = purchaseError(error)
      return reply.code(response.statusCode).send({ code: response.code, message: response.message })
    }
  })

  app.post('/api/v1/orders/:orderPublicId/wallet-state', {
    config: { rateLimit: { max: 30, timeWindow: '10 minutes' } },
  }, async (request, reply) => {
    if (!writerOriginAllowed(request.headers.origin)) {
      return reply.code(403).send({ code: 'ORIGIN_FORBIDDEN', message: 'The request origin is not allowed.' })
    }
    const params = orderParamsSchema.safeParse(request.params)
    const body = walletStateBodySchema.safeParse(request.body)
    if (!params.success || !body.success) {
      return reply.code(400).send({ code: 'INVALID_REQUEST', message: 'The wallet state is invalid.' })
    }
    if (!database) {
      return reply.code(503).send({ code: 'PURCHASE_UNAVAILABLE', message: 'Purchase recovery is temporarily unavailable.' })
    }
    try {
      return reply.send(await updateWalletState(database, {
        event: body.data.event,
        orderPublicId: params.data.orderPublicId,
      }))
    } catch (error) {
      const response = purchaseError(error)
      return reply.code(response.statusCode).send({ code: response.code, message: response.message })
    }
  })

  app.post('/api/v1/orders/:orderPublicId/transactions', {
    config: { rateLimit: { max: 30, timeWindow: '10 minutes' } },
  }, async (request, reply) => {
    if (!writerOriginAllowed(request.headers.origin)) {
      return reply.code(403).send({ code: 'ORIGIN_FORBIDDEN', message: 'The request origin is not allowed.' })
    }
    const params = orderParamsSchema.safeParse(request.params)
    const body = attachTransactionBodySchema.safeParse(request.body)
    if (!params.success || !body.success) {
      return reply.code(400).send({ code: 'INVALID_REQUEST', message: 'The transaction attachment is invalid.' })
    }
    if (!database) {
      return reply.code(503).send({ code: 'PURCHASE_UNAVAILABLE', message: 'Transaction verification is temporarily unavailable.' })
    }
    try {
      const order = await verifyPurchase(database, purchaseReader, {
        hash: body.data.hash,
        orderPublicId: params.data.orderPublicId,
      })
      return reply.code(order.paymentState === 'payment_pending' ? 202 : 200).send(order)
    } catch (error) {
      request.log.warn({ errorType: error instanceof Error ? error.name : 'UnknownError' }, 'Purchase verification failed')
      const response = purchaseError(error)
      return reply.code(response.statusCode).send({ code: response.code, message: response.message })
    }
  })

  app.post('/api/v1/orders/:orderPublicId/verify', {
    config: { rateLimit: { max: 30, timeWindow: '10 minutes' } },
  }, async (request, reply) => {
    if (!writerOriginAllowed(request.headers.origin)) {
      return reply.code(403).send({ code: 'ORIGIN_FORBIDDEN', message: 'The request origin is not allowed.' })
    }
    const params = orderParamsSchema.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send({ code: 'INVALID_REQUEST', message: 'The purchase identifier is invalid.' })
    }
    if (!database) {
      return reply.code(503).send({ code: 'PURCHASE_UNAVAILABLE', message: 'Transaction verification is temporarily unavailable.' })
    }
    try {
      const order = await recheckPurchaseTransaction(database, purchaseReader, params.data.orderPublicId)
      return reply.code(order.paymentState === 'payment_pending' ? 202 : 200).send(order)
    } catch (error) {
      request.log.warn({ errorType: error instanceof Error ? error.name : 'UnknownError' }, 'Purchase recheck failed')
      const response = purchaseError(error)
      return reply.code(response.statusCode).send({ code: response.code, message: response.message })
    }
  })

  app.get('/api/v1/passports/:passportPublicId', async (request, reply) => {
    const params = passportParamsSchema.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send({ code: 'INVALID_REQUEST', message: 'The Passport identifier is invalid.' })
    }
    if (!database) {
      return reply.code(503).send({ code: 'PURCHASE_UNAVAILABLE', message: 'Passport lookup is temporarily unavailable.' })
    }
    try {
      const passport = await readPassport(database, params.data.passportPublicId)
      if (!passport) return reply.code(404).send({ code: 'PASSPORT_NOT_FOUND', message: 'The Passport was not found.' })
      return reply.send(passport)
    } catch (error) {
      request.log.warn({ errorType: error instanceof Error ? error.name : 'UnknownError' }, 'Passport read failed')
      const response = purchaseError(error)
      return reply.code(response.statusCode).send({ code: response.code, message: response.message })
    }
  })

  app.post('/api/v1/passports/:passportPublicId/claims/challenges', {
    config: { rateLimit: { max: 10, timeWindow: '10 minutes' } },
  }, async (request, reply) => {
    if (!writerOriginAllowed(request.headers.origin)) {
      return reply.code(403).send({ code: 'ORIGIN_FORBIDDEN', message: 'The request origin is not allowed.' })
    }
    const params = passportParamsSchema.safeParse(request.params)
    const body = createClaimBodySchema.safeParse(request.body)
    if (!params.success || !body.success) {
      return reply.code(400).send({ code: 'INVALID_REQUEST', message: 'The claim request is invalid.' })
    }
    if (!database) {
      return reply.code(503).send({ code: 'CLAIM_UNAVAILABLE', message: 'Claim creation is temporarily unavailable.' })
    }
    try {
      return reply.code(201).send(await createClaim(database, {
        ...body.data,
        passportPublicId: params.data.passportPublicId,
      }))
    } catch (error) {
      request.log.warn({ errorType: error instanceof Error ? error.name : 'UnknownError' }, 'Claim challenge creation failed')
      const response = claimError(error)
      return reply.code(response.statusCode).send({ code: response.code, message: response.message })
    }
  })

  app.get('/api/v1/claims/:claimPublicId', async (request, reply) => {
    const params = claimParamsSchema.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send({ code: 'INVALID_REQUEST', message: 'The claim identifier is invalid.' })
    }
    if (!database) {
      return reply.code(503).send({ code: 'CLAIM_UNAVAILABLE', message: 'Claim lookup is temporarily unavailable.' })
    }
    try {
      const claim = await readClaim(database, params.data.claimPublicId)
      if (!claim) return reply.code(404).send({ code: 'CLAIM_NOT_FOUND', message: 'The claim was not found.' })
      return reply.send(claim)
    } catch (error) {
      const response = claimError(error)
      return reply.code(response.statusCode).send({ code: response.code, message: response.message })
    }
  })

  app.post('/api/v1/claims/:claimPublicId/submit', {
    config: { rateLimit: { max: 20, timeWindow: '10 minutes' } },
  }, async (request, reply) => {
    if (!writerOriginAllowed(request.headers.origin)) {
      return reply.code(403).send({ code: 'ORIGIN_FORBIDDEN', message: 'The request origin is not allowed.' })
    }
    const params = claimParamsSchema.safeParse(request.params)
    const body = claimProofBodySchema.safeParse(request.body)
    if (!params.success || !body.success) {
      return reply.code(400).send({ code: 'INVALID_REQUEST', message: 'The claim proof is invalid.' })
    }
    if (!database) {
      return reply.code(503).send({ code: 'CLAIM_UNAVAILABLE', message: 'Claim submission is temporarily unavailable.' })
    }
    try {
      return reply.send(await submitClaim(database, {
        claimPublicId: params.data.claimPublicId,
        proof: body.data.proof,
      }))
    } catch (error) {
      request.log.warn({ errorType: error instanceof Error ? error.name : 'UnknownError' }, 'Claim proof submission failed')
      const response = claimError(error)
      return reply.code(response.statusCode).send({ code: response.code, message: response.message })
    }
  })

  app.post('/api/v1/claims/:claimPublicId/authorizations/:authorizationPublicId/submit', {
    config: { rateLimit: { max: 20, timeWindow: '10 minutes' } },
  }, async (request, reply) => {
    if (!writerOriginAllowed(request.headers.origin)) {
      return reply.code(403).send({ code: 'ORIGIN_FORBIDDEN', message: 'The request origin is not allowed.' })
    }
    const params = claimAuthorizationParamsSchema.safeParse(request.params)
    const body = claimProofBodySchema.safeParse(request.body)
    if (!params.success || !body.success) {
      return reply.code(400).send({ code: 'INVALID_REQUEST', message: 'The authorization proof is invalid.' })
    }
    if (!database) {
      return reply.code(503).send({ code: 'CLAIM_UNAVAILABLE', message: 'Claim authorization is temporarily unavailable.' })
    }
    try {
      return reply.send(await authorizeClaim(database, {
        authorizationPublicId: params.data.authorizationPublicId,
        claimPublicId: params.data.claimPublicId,
        proof: body.data.proof,
      }))
    } catch (error) {
      request.log.warn({ errorType: error instanceof Error ? error.name : 'UnknownError' }, 'Claim authorization failed')
      const response = claimError(error)
      return reply.code(response.statusCode).send({ code: response.code, message: response.message })
    }
  })

  app.get('/api/v1/claims/:claimPublicId/resolution', async (request, reply) => {
    const params = claimParamsSchema.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send({ code: 'INVALID_REQUEST', message: 'The claim identifier is invalid.' })
    }
    if (!database) {
      return reply.code(503).send({ code: 'RESOLUTION_UNAVAILABLE', message: 'Resolution lookup is temporarily unavailable.' })
    }
    try {
      const resolution = await readResolution(database, params.data.claimPublicId)
      if (!resolution || resolution.status !== 'verified') {
        return reply.code(404).send({ code: 'RESOLUTION_NOT_FOUND', message: 'No verified resolution was found.' })
      }
      return reply.send(resolution)
    } catch (error) {
      const response = resolutionError(error)
      return reply.code(response.statusCode).send({ code: response.code, message: response.message })
    }
  })

  app.get('/api/v1/merchants/:merchantPublicId/claims/:claimPublicId/resolution', async (request, reply) => {
    const params = resolutionParamsSchema.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send({ code: 'INVALID_REQUEST', message: 'The resolution identifiers are invalid.' })
    }
    if (!database || !config.SESSION_SECRET) {
      return reply.code(503).send({ code: 'RESOLUTION_UNAVAILABLE', message: 'Resolution lookup is temporarily unavailable.' })
    }
    if (!merchantAuthorization(request.cookies, params.data.merchantPublicId)?.sessionAuthorized) {
      return reply.code(401).send({ code: 'MERCHANT_AUTH_REQUIRED', message: 'Merchant authorization is missing or expired.' })
    }
    try {
      const resolution = await readResolution(database, params.data.claimPublicId)
      if (!resolution) return reply.code(404).send({ code: 'RESOLUTION_NOT_FOUND', message: 'No resolution was found.' })
      return reply.send(resolution)
    } catch (error) {
      const response = resolutionError(error)
      return reply.code(response.statusCode).send({ code: response.code, message: response.message })
    }
  })

  app.get('/api/v1/merchants/:merchantPublicId/claims', async (request, reply) => {
    const params = merchantParamsSchema.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send({ code: 'INVALID_REQUEST', message: 'The merchant identifier is invalid.' })
    }
    if (!database || !config.SESSION_SECRET) {
      return reply.code(503).send({ code: 'RESOLUTION_UNAVAILABLE', message: 'The merchant claim queue is temporarily unavailable.' })
    }
    if (!merchantAuthorization(request.cookies, params.data.merchantPublicId)?.sessionAuthorized) {
      return reply.code(401).send({ code: 'MERCHANT_AUTH_REQUIRED', message: 'Merchant authorization is missing or expired.' })
    }
    try {
      return reply.send({ claims: await readMerchantClaims(database, params.data.merchantPublicId) })
    } catch (error) {
      const response = resolutionError(error)
      return reply.code(response.statusCode).send({ code: response.code, message: response.message })
    }
  })

  app.get('/api/v1/merchants/:merchantPublicId/promise-ledger', async (request, reply) => {
    const params = merchantParamsSchema.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send({ code: 'INVALID_REQUEST', message: 'The merchant identifier is invalid.' })
    }
    if (!database) {
      return reply.code(503).send({ code: 'LEDGER_UNAVAILABLE', message: 'The Promise Ledger is temporarily unavailable.' })
    }
    try {
      const ledger = await readPromiseLedger(database, params.data.merchantPublicId)
      if (!ledger) return reply.code(404).send({ code: 'MERCHANT_NOT_FOUND', message: 'No verified merchant was found.' })
      return reply.send(ledger)
    } catch (error) {
      request.log.warn({ errorType: error instanceof Error ? error.name : 'UnknownError' }, 'Promise Ledger read failed')
      if (error instanceof PromiseLedgerReadError && error.code === 'INVALID_REQUEST') {
        return reply.code(400).send({ code: 'INVALID_REQUEST', message: 'The merchant identifier is invalid.' })
      }
      return reply.code(503).send({
        code: 'LEDGER_EVIDENCE_UNAVAILABLE',
        message: 'The Promise Ledger could not be safely derived from verified evidence.',
      })
    }
  })

  app.post('/api/v1/merchants/:merchantPublicId/claims/:claimPublicId/resolutions/challenges', {
    config: { rateLimit: { max: 20, timeWindow: '10 minutes' } },
  }, async (request, reply) => {
    if (!writerOriginAllowed(request.headers.origin)) {
      return reply.code(403).send({ code: 'ORIGIN_FORBIDDEN', message: 'The request origin is not allowed.' })
    }
    const params = resolutionParamsSchema.safeParse(request.params)
    const body = resolutionChallengeBodySchema.safeParse(request.body)
    if (!params.success || !body.success) {
      return reply.code(400).send({ code: 'INVALID_REQUEST', message: 'The resolution request is invalid.' })
    }
    if (!database || !config.SESSION_SECRET) {
      return reply.code(503).send({ code: 'RESOLUTION_UNAVAILABLE', message: 'Resolution signing is temporarily unavailable.' })
    }
    if (!merchantAuthorization(request.cookies, params.data.merchantPublicId)?.sessionAuthorized) {
      return reply.code(401).send({ code: 'MERCHANT_AUTH_REQUIRED', message: 'Merchant authorization is missing or expired.' })
    }
    try {
      return reply.code(201).send(await createResolution(database, {
        ...body.data,
        claimPublicId: params.data.claimPublicId,
        merchantPublicId: params.data.merchantPublicId,
      }))
    } catch (error) {
      request.log.warn({ errorType: error instanceof Error ? error.name : 'UnknownError' }, 'Resolution challenge creation failed')
      const response = resolutionError(error)
      return reply.code(response.statusCode).send({ code: response.code, message: response.message })
    }
  })

  app.post('/api/v1/merchants/:merchantPublicId/claims/:claimPublicId/resolutions/:resolutionPublicId/publish', {
    config: { rateLimit: { max: 20, timeWindow: '10 minutes' } },
  }, async (request, reply) => {
    if (!writerOriginAllowed(request.headers.origin)) {
      return reply.code(403).send({ code: 'ORIGIN_FORBIDDEN', message: 'The request origin is not allowed.' })
    }
    const params = publishResolutionParamsSchema.safeParse(request.params)
    const body = claimProofBodySchema.safeParse(request.body)
    if (!params.success || !body.success) {
      return reply.code(400).send({ code: 'INVALID_REQUEST', message: 'The resolution proof is invalid.' })
    }
    if (!database || !config.SESSION_SECRET) {
      return reply.code(503).send({ code: 'RESOLUTION_UNAVAILABLE', message: 'Resolution publication is temporarily unavailable.' })
    }
    if (!merchantAuthorization(request.cookies, params.data.merchantPublicId)?.sessionAuthorized) {
      return reply.code(401).send({ code: 'MERCHANT_AUTH_REQUIRED', message: 'Merchant authorization is missing or expired.' })
    }
    try {
      return reply.send(await publishClaimResolution(database, {
        claimPublicId: params.data.claimPublicId,
        merchantPublicId: params.data.merchantPublicId,
        proof: body.data.proof,
        resolutionPublicId: params.data.resolutionPublicId,
      }))
    } catch (error) {
      request.log.warn({ errorType: error instanceof Error ? error.name : 'UnknownError' }, 'Resolution publication failed')
      const response = resolutionError(error)
      return reply.code(response.statusCode).send({ code: response.code, message: response.message })
    }
  })

  app.get('/api/v1/claims/:claimPublicId/refund', async (request, reply) => {
    const params = claimParamsSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send({ code: 'INVALID_REQUEST', message: 'The claim identifier is invalid.' })
    if (!database) return reply.code(503).send({ code: 'REFUND_UNAVAILABLE', message: 'Refund lookup is temporarily unavailable.' })
    try {
      const refund = await readRefund(database, params.data.claimPublicId)
      if (!refund) return reply.code(404).send({ code: 'REFUND_NOT_AVAILABLE', message: 'No approved refund was found.' })
      return reply.send(refund)
    } catch (error) {
      const response = refundError(error)
      return reply.code(response.statusCode).send({ code: response.code, message: response.message })
    }
  })

  app.post('/api/v1/merchants/:merchantPublicId/claims/:claimPublicId/refunds', {
    config: { rateLimit: { max: 20, timeWindow: '10 minutes' } },
  }, async (request, reply) => {
    if (!writerOriginAllowed(request.headers.origin)) return reply.code(403).send({ code: 'ORIGIN_FORBIDDEN', message: 'The request origin is not allowed.' })
    const params = refundParamsSchema.safeParse(request.params)
    const body = emptyBodySchema.safeParse(request.body ?? {})
    if (!params.success || !body.success) return reply.code(400).send({ code: 'INVALID_REQUEST', message: 'The refund request is invalid.' })
    if (!database || !config.SESSION_SECRET) return reply.code(503).send({ code: 'REFUND_UNAVAILABLE', message: 'Refund creation is temporarily unavailable.' })
    if (!merchantAuthorization(request.cookies, params.data.merchantPublicId)?.sessionAuthorized) {
      return reply.code(401).send({ code: 'MERCHANT_AUTH_REQUIRED', message: 'Merchant authorization is missing or expired.' })
    }
    try {
      return reply.code(201).send(await createRefund(database, {
        claimPublicId: params.data.claimPublicId,
        merchantPublicId: params.data.merchantPublicId,
        network: config.NIMIQ_NETWORK,
      }))
    } catch (error) {
      const response = refundError(error)
      return reply.code(response.statusCode).send({ code: response.code, message: response.message })
    }
  })

  app.post('/api/v1/merchants/:merchantPublicId/claims/:claimPublicId/refunds/:attemptPublicId/wallet-state', {
    config: { rateLimit: { max: 30, timeWindow: '10 minutes' } },
  }, async (request, reply) => {
    if (!writerOriginAllowed(request.headers.origin)) return reply.code(403).send({ code: 'ORIGIN_FORBIDDEN', message: 'The request origin is not allowed.' })
    const params = refundAttemptParamsSchema.safeParse(request.params)
    const body = refundWalletStateBodySchema.safeParse(request.body)
    if (!params.success || !body.success) return reply.code(400).send({ code: 'INVALID_REQUEST', message: 'The refund wallet state is invalid.' })
    if (!database || !config.SESSION_SECRET) return reply.code(503).send({ code: 'REFUND_UNAVAILABLE', message: 'Refund recovery is temporarily unavailable.' })
    if (!merchantAuthorization(request.cookies, params.data.merchantPublicId)?.sessionAuthorized) {
      return reply.code(401).send({ code: 'MERCHANT_AUTH_REQUIRED', message: 'Merchant authorization is missing or expired.' })
    }
    try {
      return reply.send(await updateRefundState(database, { ...params.data, event: body.data.event }))
    } catch (error) {
      const response = refundError(error)
      return reply.code(response.statusCode).send({ code: response.code, message: response.message })
    }
  })

  app.post('/api/v1/merchants/:merchantPublicId/claims/:claimPublicId/refunds/:attemptPublicId/transactions', {
    config: { rateLimit: { max: 30, timeWindow: '10 minutes' } },
  }, async (request, reply) => {
    if (!writerOriginAllowed(request.headers.origin)) return reply.code(403).send({ code: 'ORIGIN_FORBIDDEN', message: 'The request origin is not allowed.' })
    const params = refundAttemptParamsSchema.safeParse(request.params)
    const body = attachTransactionBodySchema.safeParse(request.body)
    if (!params.success || !body.success) return reply.code(400).send({ code: 'INVALID_REQUEST', message: 'The refund transaction attachment is invalid.' })
    if (!database || !config.SESSION_SECRET) return reply.code(503).send({ code: 'REFUND_UNAVAILABLE', message: 'Refund verification is temporarily unavailable.' })
    if (!merchantAuthorization(request.cookies, params.data.merchantPublicId)?.sessionAuthorized) {
      return reply.code(401).send({ code: 'MERCHANT_AUTH_REQUIRED', message: 'Merchant authorization is missing or expired.' })
    }
    try {
      const refund = await verifyRefund(database, purchaseReader, { ...params.data, hash: body.data.hash })
      return reply.code(refund.attempt?.state === 'payment_pending' ? 202 : 200).send(refund)
    } catch (error) {
      const response = refundError(error)
      return reply.code(response.statusCode).send({ code: response.code, message: response.message })
    }
  })

  app.post('/api/v1/merchants/:merchantPublicId/claims/:claimPublicId/refunds/:attemptPublicId/recheck', {
    config: { rateLimit: { max: 30, timeWindow: '10 minutes' } },
  }, async (request, reply) => {
    if (!writerOriginAllowed(request.headers.origin)) return reply.code(403).send({ code: 'ORIGIN_FORBIDDEN', message: 'The request origin is not allowed.' })
    const params = refundAttemptParamsSchema.safeParse(request.params)
    const body = emptyBodySchema.safeParse(request.body ?? {})
    if (!params.success || !body.success) return reply.code(400).send({ code: 'INVALID_REQUEST', message: 'The refund recheck request is invalid.' })
    if (!database || !config.SESSION_SECRET) return reply.code(503).send({ code: 'REFUND_UNAVAILABLE', message: 'Refund verification is temporarily unavailable.' })
    if (!merchantAuthorization(request.cookies, params.data.merchantPublicId)?.sessionAuthorized) {
      return reply.code(401).send({ code: 'MERCHANT_AUTH_REQUIRED', message: 'Merchant authorization is missing or expired.' })
    }
    try {
      const refund = await recheckRefund(database, purchaseReader, params.data)
      return reply.code(refund.attempt?.state === 'payment_pending' ? 202 : 200).send(refund)
    } catch (error) {
      const response = refundError(error)
      return reply.code(response.statusCode).send({ code: response.code, message: response.message })
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
