import type postgres from 'postgres'
import { afterEach, describe, expect, it } from 'vitest'

import { buildApp } from '../../server/app.js'
import type { ServerConfig } from '../../server/config.js'

const config: ServerConfig = {
  HOST: '127.0.0.1',
  NIMIQ_NETWORK: 'TestAlbatross',
  NODE_ENV: 'test',
  PORT: 3001,
}
const writerConfig: ServerConfig = {
  ...config,
  SESSION_SECRET: 'server-app-test-session-secret-with-32-bytes',
}
const MERCHANT_PUBLIC_ID = 'BBBBBBBBBBBBBBBBBBBBBB'
const PRODUCT_PUBLIC_ID = 'AAAAAAAAAAAAAAAAAAAAAA'
const POLICY_NONCE = 'CCCCCCCCCCCCCCCCCCCCCC'
const POLICY_ID = 'DDDDDDDDDDDDDDDDDDDDDD'
const SETTLEMENT_ADDRESS = 'NQ15A4YFKG7PU2KLJ7R0K3HE36PLPCC9ND0F'

function cookiePair(headers: string | string[] | undefined, name: string): string {
  const values = Array.isArray(headers) ? headers : headers ? [headers] : []
  const value = values.find((header) => header.startsWith(`${name}=`))
  if (!value) throw new Error(`Missing ${name} response cookie.`)
  return value.split(';')[0] ?? ''
}

const apps: Awaited<ReturnType<typeof buildApp>>[] = []

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()))
})

describe('server app', () => {
  it('reports Phase 1 health without claiming database readiness', async () => {
    const app = await buildApp(config)
    apps.push(app)

    const response = await app.inject({ method: 'GET', url: '/health' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ phase: 1, service: 'nimreturn-api', status: 'ok' })
  })

  it('rejects malformed public product identifiers before database access', async () => {
    const app = await buildApp(config)
    apps.push(app)

    const response = await app.inject({ method: 'GET', url: '/api/v1/products/not-valid' })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({ code: 'INVALID_PRODUCT_ID' })
  })

  it('fails closed when verified policy storage is unavailable', async () => {
    const app = await buildApp(config)
    apps.push(app)

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/products/AAAAAAAAAAAAAAAAAAAAAA',
    })

    expect(response.statusCode).toBe(503)
    expect(response.json()).toMatchObject({ code: 'DATABASE_UNAVAILABLE' })
  })

  it('serializes only the verified public projection returned by the domain reader', async () => {
    const verifiedAt = new Date('2026-09-15T10:30:00.000Z')
    const product = {
      merchant: { displayName: 'North Star', publicId: 'BBBBBBBBBBBBBBBBBBBBBB' },
      policy: {
        payload: {
          createdAt: 1_789_469_400_000,
          merchantId: 'BBBBBBBBBBBBBBBBBBBBBB',
          nonce: 'CCCCCCCCCCCCCCCCCCCCCC',
          policyId: 'DDDDDDDDDDDDDDDDDDDDDD',
          priceLuna: 1_000,
          productId: 'AAAAAAAAAAAAAAAAAAAAAA',
          productName: 'Trail cup',
          protocol: 'NR1' as const,
          returnWindowSeconds: 86_400,
          settlementAddress: 'NQ15A4YFKG7PU2KLJ7R0K3HE36PLPCC9ND0F',
          type: 'POLICY' as const,
          version: 1,
          warrantyTransferAllowed: false,
          warrantyWindowSeconds: 2_592_000,
        },
        proof: {
          canonicalMessage: 'NIMRETURN/1/POLICY\n{}',
          payloadHash: 'a'.repeat(64),
          publicKey: 'b'.repeat(64),
          signature: 'c'.repeat(128),
        },
        publicId: 'DDDDDDDDDDDDDDDDDDDDDD',
        signerAddress: 'NQ15A4YFKG7PU2KLJ7R0K3HE36PLPCC9ND0F',
        verifiedAt,
      },
      product: { publicId: 'AAAAAAAAAAAAAAAAAAAAAA' },
    }
    const app = await buildApp(config, {
      database: {} as postgres.Sql,
      readPublicProduct: () => Promise.resolve(product),
    })
    apps.push(app)

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/products/AAAAAAAAAAAAAAAAAAAAAA',
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      ...product,
      policy: { ...product.policy, verifiedAt: verifiedAt.toISOString() },
    })
  })

  it('keeps bootstrap capability out of JSON and upgrades it to a merchant session after publish', async () => {
    const challengeInputs: unknown[] = []
    const publishInputs: unknown[] = []
    const payload = {
      createdAt: 1_789_469_400_000,
      merchantId: MERCHANT_PUBLIC_ID,
      nonce: POLICY_NONCE,
      policyId: POLICY_ID,
      priceLuna: 1_000,
      productId: PRODUCT_PUBLIC_ID,
      productName: 'Trail cup',
      protocol: 'NR1' as const,
      returnWindowSeconds: 86_400,
      settlementAddress: SETTLEMENT_ADDRESS,
      type: 'POLICY' as const,
      version: 1,
      warrantyTransferAllowed: false,
      warrantyWindowSeconds: 2_592_000,
    }
    const proof = {
      canonicalMessage: 'NIMRETURN/1/POLICY\n{}',
      payloadHash: 'a'.repeat(64),
      publicKey: 'b'.repeat(64),
      signature: 'c'.repeat(128),
    }
    const app = await buildApp(writerConfig, {
      createDraft: () => Promise.resolve({
        bootstrapCapability: 'A'.repeat(43),
        bootstrapExpiresAt: new Date(Date.now() + 300_000),
        displayName: 'North Star',
        merchantPublicId: MERCHANT_PUBLIC_ID,
        productName: 'Trail cup',
        productPublicId: PRODUCT_PUBLIC_ID,
      }),
      createPolicyChallenge: (_database, input) => {
        challengeInputs.push(input)
        return Promise.resolve({
          canonicalMessage: proof.canonicalMessage,
          expiresAt: new Date(Date.now() + 300_000),
          merchantId: '00000000-0000-0000-0000-000000000001',
          nonce: POLICY_NONCE,
          payload,
          payloadHash: proof.payloadHash,
          policyVersionId: '00000000-0000-0000-0000-000000000003',
          productId: '00000000-0000-0000-0000-000000000002',
        })
      },
      database: {} as postgres.Sql,
      publishPolicy: (_database, input) => {
        publishInputs.push(input)
        return Promise.resolve({
          actualSignerAddress: SETTLEMENT_ADDRESS,
          firstPolicyForMerchant: true,
          merchantId: '00000000-0000-0000-0000-000000000001',
          policyVersionId: '00000000-0000-0000-0000-000000000003',
          productId: '00000000-0000-0000-0000-000000000002',
          protocolEventId: '00000000-0000-0000-0000-000000000004',
        })
      },
    })
    apps.push(app)

    const draftResponse = await app.inject({
      method: 'POST',
      payload: {
        defaultSettlementAddress: SETTLEMENT_ADDRESS,
        displayName: 'North Star',
        productName: 'Trail cup',
      },
      url: '/api/v1/merchants',
    })
    expect(draftResponse.statusCode).toBe(201)
    expect(draftResponse.body).not.toContain('A'.repeat(43))
    const bootstrapCookie = cookiePair(
      draftResponse.headers['set-cookie'],
      'nimreturn_merchant_bootstrap',
    )
    expect(String(draftResponse.headers['set-cookie'])).toContain('HttpOnly')
    expect(String(draftResponse.headers['set-cookie'])).toContain('SameSite=Strict')

    const terms = {
      priceLuna: 1_000,
      returnWindowSeconds: 86_400,
      settlementAddress: SETTLEMENT_ADDRESS,
      warrantyTransferAllowed: false,
      warrantyWindowSeconds: 2_592_000,
    }
    const challengeResponse = await app.inject({
      cookies: { nimreturn_merchant_bootstrap: bootstrapCookie.split('=')[1] ?? '' },
      method: 'POST',
      payload: terms,
      url: `/api/v1/merchants/${MERCHANT_PUBLIC_ID}/products/${PRODUCT_PUBLIC_ID}/policies/challenges`,
    })
    expect(challengeResponse.statusCode).toBe(201)
    expect(challengeInputs[0]).toMatchObject({
      bootstrapCapability: 'A'.repeat(43),
      merchantPublicId: MERCHANT_PUBLIC_ID,
      productPublicId: PRODUCT_PUBLIC_ID,
    })

    const publishResponse = await app.inject({
      cookies: { nimreturn_merchant_bootstrap: bootstrapCookie.split('=')[1] ?? '' },
      method: 'POST',
      payload: { challengeNonce: POLICY_NONCE, proof },
      url: `/api/v1/merchants/${MERCHANT_PUBLIC_ID}/products/${PRODUCT_PUBLIC_ID}/policies/publish`,
    })
    expect(publishResponse.statusCode).toBe(200)
    expect(publishInputs[0]).toMatchObject({
      bootstrapCapability: 'A'.repeat(43),
      merchantPublicId: MERCHANT_PUBLIC_ID,
      productPublicId: PRODUCT_PUBLIC_ID,
    })
    const merchantSessionCookie = cookiePair(
      publishResponse.headers['set-cookie'],
      'nimreturn_merchant_session',
    )

    const v2ChallengeResponse = await app.inject({
      cookies: { nimreturn_merchant_session: merchantSessionCookie.split('=')[1] ?? '' },
      method: 'POST',
      payload: { ...terms, priceLuna: 2_000 },
      url: `/api/v1/merchants/${MERCHANT_PUBLIC_ID}/products/${PRODUCT_PUBLIC_ID}/policies/challenges`,
    })
    expect(v2ChallengeResponse.statusCode).toBe(201)
    expect(challengeInputs[1]).toEqual({
      ...terms,
      merchantPublicId: MERCHANT_PUBLIC_ID,
      priceLuna: 2_000,
      productPublicId: PRODUCT_PUBLIC_ID,
    })
  })

  it('does not issue policy challenges without merchant authorization', async () => {
    const app = await buildApp(writerConfig, { database: {} as postgres.Sql })
    apps.push(app)

    const response = await app.inject({
      method: 'POST',
      payload: {
        priceLuna: 1_000,
        returnWindowSeconds: 0,
        settlementAddress: SETTLEMENT_ADDRESS,
        warrantyTransferAllowed: false,
        warrantyWindowSeconds: 0,
      },
      url: `/api/v1/merchants/${MERCHANT_PUBLIC_ID}/products/${PRODUCT_PUBLIC_ID}/policies/challenges`,
    })

    expect(response.statusCode).toBe(401)
    expect(response.json()).toMatchObject({ code: 'MERCHANT_AUTH_REQUIRED' })
  })
})
