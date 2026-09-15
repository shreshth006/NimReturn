import type postgres from 'postgres'
import { afterEach, describe, expect, it } from 'vitest'

import { buildApp } from '../../server/app.js'
import type { ServerConfig } from '../../server/config.js'
import type { ClaimView } from '../../server/domain/claim-lifecycle.js'
import type {
  MerchantClaimQueueItem,
  ResolutionView,
} from '../../server/domain/resolution-lifecycle.js'
import { createMerchantSessionToken } from '../../server/http/merchant-session.js'

const config: ServerConfig = {
  HOST: '127.0.0.1',
  NIMIQ_NETWORK: 'TestAlbatross',
  NODE_ENV: 'test',
  PORT: 3001,
}
const writerConfig: ServerConfig = {
  ...config,
  SESSION_SECRET: 'claim-routes-test-session-secret-at-least-32-bytes',
}
const PASSPORT_ID = 'AAAAAAAAAAAAAAAAAAAAAA'
const CLAIM_ID = 'BBBBBBBBBBBBBBBBBBBBBB'
const AUTHORIZATION_ID = 'CCCCCCCCCCCCCCCCCCCCCC'
const ORDER_ID = 'DDDDDDDDDDDDDDDDDDDDDD'
const MERCHANT_ID = 'EEEEEEEEEEEEEEEEEEEEEE'
const ADDRESS = 'NQ6616JYYPSEVGXT606D6YKEEURTHE0VARDR'
const CANONICAL_MESSAGE = 'NIMRETURN/1/CLAIM\n{}'
const PROOF = {
  canonicalMessage: CANONICAL_MESSAGE,
  payloadHash: 'ab'.repeat(32),
  publicKey: 'cd'.repeat(32),
  signature: 'ef'.repeat(64),
}

function claimView(overrides: Partial<ClaimView> = {}): ClaimView {
  return {
    authorization: null,
    challenge: {
      canonicalMessage: CANONICAL_MESSAGE,
      expiresAt: new Date('2026-09-15T12:10:00.000Z'),
      nonce: 'FFFFFFFFFFFFFFFFFFFFFF',
    },
    claimSignerAddress: null,
    claimTime: new Date('2026-09-15T12:00:00.000Z'),
    claimType: 'RETURN',
    createdAt: new Date('2026-09-15T12:00:00.000Z'),
    eligibility: null,
    merchantPublicId: MERCHANT_ID,
    orderPublicId: ORDER_ID,
    passportPublicId: PASSPORT_ID,
    payloadHash: PROOF.payloadHash,
    policyVersion: 1,
    publicId: CLAIM_ID,
    purchaseSenderAddress: ADDRESS,
    reasonCode: 'DEFECTIVE',
    signatureStatus: 'pending',
    workflowState: 'signature_requested',
    ...overrides,
  }
}

function resolutionView(overrides: Partial<ResolutionView> = {}): ResolutionView {
  return {
    approvedRefundLuna: 500_000,
    canonicalMessage: 'NIMRETURN/1/RESOLUTION\n{}',
    claimPublicId: CLAIM_ID,
    createdAt: new Date('2026-09-15T12:30:00.000Z'),
    decision: 'APPROVED',
    expiresAt: new Date('2026-09-15T12:40:00.000Z'),
    note: 'Approved under policy',
    payloadHash: '12'.repeat(32),
    policySignerAddress: ADDRESS,
    publicId: AUTHORIZATION_ID,
    reasonCode: 'POLICY_ACCEPTED',
    resolutionTime: new Date('2026-09-15T12:30:00.000Z'),
    signerAddress: null,
    status: 'pending',
    verifiedAt: null,
    ...overrides,
  }
}

const apps: Awaited<ReturnType<typeof buildApp>>[] = []

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()))
})

describe('claim routes', () => {
  it('creates a server-bound claim without accepting an address or timestamp', async () => {
    const inputs: unknown[] = []
    const app = await buildApp(config, {
      createClaim: (_database, input) => {
        inputs.push(input)
        return Promise.resolve(claimView())
      },
      database: {} as postgres.Sql,
    })
    apps.push(app)

    const response = await app.inject({
      method: 'POST',
      payload: { claimType: 'RETURN', note: 'Defective', reasonCode: 'DEFECTIVE' },
      url: `/api/v1/passports/${PASSPORT_ID}/claims/challenges`,
    })
    expect(response.statusCode).toBe(201)
    expect(inputs).toEqual([{
      claimType: 'RETURN',
      note: 'Defective',
      passportPublicId: PASSPORT_ID,
      reasonCode: 'DEFECTIVE',
    }])

    const rejected = await app.inject({
      method: 'POST',
      payload: {
        claimType: 'RETURN',
        purchaseSenderAddress: ADDRESS,
        reasonCode: 'DEFECTIVE',
      },
      url: `/api/v1/passports/${PASSPORT_ID}/claims/challenges`,
    })
    expect(rejected.statusCode).toBe(400)
  })

  it('passes only the strict proof envelope to claim submission', async () => {
    const inputs: unknown[] = []
    const app = await buildApp(config, {
      database: {} as postgres.Sql,
      submitClaim: (_database, input) => {
        inputs.push(input)
        return Promise.resolve(claimView({ signatureStatus: 'verified', workflowState: 'authorization_pending' }))
      },
    })
    apps.push(app)
    const response = await app.inject({
      method: 'POST',
      payload: { proof: PROOF },
      url: `/api/v1/claims/${CLAIM_ID}/submit`,
    })
    expect(response.statusCode).toBe(200)
    expect(inputs).toEqual([{ claimPublicId: CLAIM_ID, proof: PROOF }])
  })

  it('binds authorization submission to both path identifiers', async () => {
    const inputs: unknown[] = []
    const app = await buildApp(config, {
      authorizeClaim: (_database, input) => {
        inputs.push(input)
        return Promise.resolve(claimView({
          authorization: {
            canonicalMessage: 'NIMRETURN/1/CLAIM_AUTHORIZATION\n{}',
            expiresAt: new Date('2026-09-15T12:10:00.000Z'),
            mode: 'delegated',
            nonce: 'FFFFFFFFFFFFFFFFFFFFFF',
            publicId: AUTHORIZATION_ID,
            requiredSignerAddress: ADDRESS,
            status: 'verified',
          },
          signatureStatus: 'verified',
          workflowState: 'eligible',
        }))
      },
      database: {} as postgres.Sql,
    })
    apps.push(app)
    const response = await app.inject({
      method: 'POST',
      payload: { proof: PROOF },
      url: `/api/v1/claims/${CLAIM_ID}/authorizations/${AUTHORIZATION_ID}/submit`,
    })
    expect(response.statusCode).toBe(200)
    expect(inputs).toEqual([{
      authorizationPublicId: AUTHORIZATION_ID,
      claimPublicId: CLAIM_ID,
      proof: PROOF,
    }])
  })

  it('fails closed without storage and rejects malformed public identifiers', async () => {
    const app = await buildApp(config)
    apps.push(app)
    const unavailable = await app.inject({ method: 'GET', url: `/api/v1/claims/${CLAIM_ID}` })
    expect(unavailable.statusCode).toBe(503)
    const malformed = await app.inject({ method: 'GET', url: '/api/v1/claims/not-valid' })
    expect(malformed.statusCode).toBe(400)
  })

  it('protects the merchant claim queue and resolution writers with the merchant session', async () => {
    const queue: MerchantClaimQueueItem[] = [{
      claim: {
        claimSignerAddress: ADDRESS,
        claimTime: new Date('2026-09-15T12:00:00.000Z'),
        claimType: 'RETURN',
        eligibility: 'eligible',
        note: 'Defective',
        publicId: CLAIM_ID,
        purchaseSenderAddress: ADDRESS,
        reasonCode: 'DEFECTIVE',
        workflowState: 'eligible',
      },
      passportPublicId: PASSPORT_ID,
      productName: 'Wireless mouse',
      resolution: null,
    }]
    const challengeInputs: unknown[] = []
    const publishInputs: unknown[] = []
    const app = await buildApp(writerConfig, {
      createResolution: (_database, input) => {
        challengeInputs.push(input)
        return Promise.resolve(resolutionView())
      },
      database: {} as postgres.Sql,
      publishResolution: (_database, input) => {
        publishInputs.push(input)
        return Promise.resolve(resolutionView({
          signerAddress: ADDRESS,
          status: 'verified',
          verifiedAt: new Date('2026-09-15T12:31:00.000Z'),
        }))
      },
      readMerchantClaims: () => Promise.resolve(queue),
    })
    apps.push(app)

    const unauthenticated = await app.inject({
      method: 'GET',
      url: `/api/v1/merchants/${MERCHANT_ID}/claims`,
    })
    expect(unauthenticated.statusCode).toBe(401)

    const token = createMerchantSessionToken({
      merchantPublicId: MERCHANT_ID,
      secret: writerConfig.SESSION_SECRET ?? '',
    }).token
    const cookies = { nimreturn_merchant_session: token }
    const queueResponse = await app.inject({
      cookies,
      method: 'GET',
      url: `/api/v1/merchants/${MERCHANT_ID}/claims`,
    })
    expect(queueResponse.statusCode).toBe(200)
    expect(queueResponse.json()).toMatchObject({ claims: [{ productName: 'Wireless mouse' }] })

    const challenge = await app.inject({
      cookies,
      method: 'POST',
      payload: {
        decision: 'APPROVED',
        note: 'Approved under policy',
        reasonCode: 'POLICY_ACCEPTED',
      },
      url: `/api/v1/merchants/${MERCHANT_ID}/claims/${CLAIM_ID}/resolutions/challenges`,
    })
    expect(challenge.statusCode).toBe(201)
    expect(challengeInputs).toEqual([{
      claimPublicId: CLAIM_ID,
      decision: 'APPROVED',
      merchantPublicId: MERCHANT_ID,
      note: 'Approved under policy',
      reasonCode: 'POLICY_ACCEPTED',
    }])

    const published = await app.inject({
      cookies,
      method: 'POST',
      payload: { proof: PROOF },
      url: `/api/v1/merchants/${MERCHANT_ID}/claims/${CLAIM_ID}/resolutions/${AUTHORIZATION_ID}/publish`,
    })
    expect(published.statusCode).toBe(200)
    expect(publishInputs).toEqual([{
      claimPublicId: CLAIM_ID,
      merchantPublicId: MERCHANT_ID,
      proof: PROOF,
      resolutionPublicId: AUTHORIZATION_ID,
    }])
  })

  it('exposes a resolution read without exposing merchant queue notes', async () => {
    const app = await buildApp(config, {
      database: {} as postgres.Sql,
      readResolution: () => Promise.resolve(resolutionView({ status: 'verified' })),
    })
    apps.push(app)
    const response = await app.inject({ method: 'GET', url: `/api/v1/claims/${CLAIM_ID}/resolution` })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ decision: 'APPROVED', status: 'verified' })
  })
})
