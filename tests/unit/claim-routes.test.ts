import type postgres from 'postgres'
import { afterEach, describe, expect, it } from 'vitest'

import { buildApp } from '../../server/app.js'
import type { ServerConfig } from '../../server/config.js'
import type { ClaimView } from '../../server/domain/claim-lifecycle.js'

const config: ServerConfig = {
  HOST: '127.0.0.1',
  NIMIQ_NETWORK: 'TestAlbatross',
  NODE_ENV: 'test',
  PORT: 3001,
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
})
