import type postgres from 'postgres'
import { afterEach, describe, expect, it } from 'vitest'

import { buildApp } from '../../server/app.js'
import type { ServerConfig } from '../../server/config.js'
import type { PurchaseOrderView } from '../../server/domain/purchase-order.js'
import {
  MerchantSessionRecoveryError,
  type MerchantSessionRecoveryErrorCode,
} from '../../server/domain/merchant-session-recovery.js'

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
const ORDER_PUBLIC_ID = 'EEEEEEEEEEEEEEEEEEEEEE'
const PASSPORT_PUBLIC_ID = 'FFFFFFFFFFFFFFFFFFFFFF'
const SETTLEMENT_ADDRESS = 'NQ15A4YFKG7PU2KLJ7R0K3HE36PLPCC9ND0F'
const TRANSACTION_HASH = 'a'.repeat(64)
const MERCHANT_ORIGIN = 'https://merchant.example'

function purchaseOrder(overrides: Partial<PurchaseOrderView> = {}): PurchaseOrderView {
  return {
    buyerAddress: null,
    claimKey: null,
    createdAt: new Date('2026-09-15T10:30:00.000Z'),
    expiresAt: new Date('2026-09-15T10:50:00.000Z'),
    expectedPayment: {
      data: `NR1:P:${ORDER_PUBLIC_ID}`,
      network: 'TestAlbatross',
      recipient: SETTLEMENT_ADDRESS,
      valueLuna: 1_000,
    },
    failureCode: null,
    merchant: { displayName: 'North Star', publicId: MERCHANT_PUBLIC_ID },
    passport: null,
    paymentState: 'payment_requested',
    policy: { payloadHash: 'b'.repeat(64), publicId: POLICY_ID, version: 1 },
    product: { description: 'A dependable cup.', name: 'Trail cup', publicId: PRODUCT_PUBLIC_ID },
    publicId: ORDER_PUBLIC_ID,
    rowVersion: 1,
    transaction: null,
    ...overrides,
  }
}

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
  it('reports the active implementation phase without claiming database readiness', async () => {
    const app = await buildApp(config)
    apps.push(app)

    const response = await app.inject({ method: 'GET', url: '/health' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ phase: 5, service: 'nimreturn-api', status: 'ok' })
  })

  it('sets restrictive browser security headers in production', async () => {
    const app = await buildApp({
      ...writerConfig,
      CORS_ORIGIN: 'https://staging.example.com',
      DATABASE_URL: 'postgresql://runtime:secret@database.example.com:5432/nimreturn',
      NIMIQ_RPC_URL: 'https://rpc.example.com',
      NODE_ENV: 'production',
    })
    apps.push(app)

    const response = await app.inject({ method: 'GET', url: '/health' })

    expect(response.headers['content-security-policy']).toContain("default-src 'self'")
    expect(response.headers['permissions-policy']).toBe('camera=(), geolocation=(), microphone=()')
    expect(response.headers['strict-transport-security']).toContain('max-age=31536000')
    expect(response.headers['x-content-type-options']).toBe('nosniff')
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
      policyVersions: [],
      product: { description: 'A dependable cup.', publicId: 'AAAAAAAAAAAAAAAAAAAAAA' },
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
    const publishCookies = Array.isArray(publishResponse.headers['set-cookie'])
      ? publishResponse.headers['set-cookie']
      : [publishResponse.headers['set-cookie']]
    expect(publishCookies).toHaveLength(1)
    expect(String(publishCookies[0])).not.toContain(
      'nimreturn_merchant_bootstrap=',
    )
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

  it('restores a protected merchant session only through a no-store signer challenge', async () => {
    const sessionInputs: unknown[] = []
    const policyInputs: unknown[] = []
    const createdAt = Date.now()
    const expiresAt = new Date(createdAt + 300_000)
    const authPayload = {
      audience: MERCHANT_ORIGIN,
      createdAt,
      expiresAt: expiresAt.getTime(),
      merchantId: MERCHANT_PUBLIC_ID,
      nonce: POLICY_NONCE,
      policySignerAddress: SETTLEMENT_ADDRESS,
      type: 'MERCHANT_SESSION' as const,
      version: 1 as const,
    }
    const proof = {
      canonicalMessage: 'NIMRETURN/AUTH/1/MERCHANT_SESSION\n{}',
      payloadHash: 'a'.repeat(64),
      publicKey: 'b'.repeat(64),
      signature: 'c'.repeat(128),
    }
    const policyPayload = {
      createdAt,
      merchantId: MERCHANT_PUBLIC_ID,
      nonce: POLICY_NONCE,
      policyId: POLICY_ID,
      priceLuna: 2_000,
      productId: PRODUCT_PUBLIC_ID,
      productName: 'Trail cup',
      protocol: 'NR1' as const,
      returnWindowSeconds: 86_400,
      settlementAddress: SETTLEMENT_ADDRESS,
      type: 'POLICY' as const,
      version: 2,
      warrantyTransferAllowed: false,
      warrantyWindowSeconds: 2_592_000,
    }
    const app = await buildApp({
      ...writerConfig,
      CORS_ORIGIN: MERCHANT_ORIGIN,
      DATABASE_URL: 'postgresql://runtime:secret@database.example.com:5432/nimreturn',
      NIMIQ_RPC_URL: 'https://rpc.example.com',
      NODE_ENV: 'production',
    }, {
      createMerchantSessionChallenge: (_database, input) => {
        sessionInputs.push(input)
        return Promise.resolve({
          canonicalMessage: proof.canonicalMessage,
          expectedSignerAddress: SETTLEMENT_ADDRESS,
          expiresAt,
          merchantId: '00000000-0000-0000-0000-000000000001',
          nonce: POLICY_NONCE,
          payload: authPayload,
          payloadHash: proof.payloadHash,
        })
      },
      createPolicyChallenge: (_database, input) => {
        policyInputs.push(input)
        return Promise.resolve({
          canonicalMessage: 'NIMRETURN/1/POLICY\n{}',
          expiresAt,
          merchantId: '00000000-0000-0000-0000-000000000001',
          nonce: POLICY_NONCE,
          payload: policyPayload,
          payloadHash: 'd'.repeat(64),
          policyVersionId: '00000000-0000-0000-0000-000000000003',
          productId: '00000000-0000-0000-0000-000000000002',
        })
      },
      database: {} as postgres.Sql,
      restoreMerchantSession: (_database, input) => {
        sessionInputs.push(input)
        return Promise.resolve({
          merchantId: '00000000-0000-0000-0000-000000000001',
          merchantPublicId: MERCHANT_PUBLIC_ID,
          signerAddress: SETTLEMENT_ADDRESS,
        })
      },
    })
    apps.push(app)

    const challengeResponse = await app.inject({
      headers: { origin: MERCHANT_ORIGIN },
      method: 'POST',
      payload: {},
      url: `/api/v1/merchants/${MERCHANT_PUBLIC_ID}/session/challenges`,
    })
    expect(challengeResponse.statusCode).toBe(201)
    expect(challengeResponse.headers['cache-control']).toBe('no-store')
    expect(sessionInputs[0]).toEqual({
      audience: MERCHANT_ORIGIN,
      merchantPublicId: MERCHANT_PUBLIC_ID,
    })

    const restoreResponse = await app.inject({
      headers: { origin: MERCHANT_ORIGIN },
      method: 'POST',
      payload: { challengeNonce: POLICY_NONCE, proof },
      url: `/api/v1/merchants/${MERCHANT_PUBLIC_ID}/session`,
    })
    expect(restoreResponse.statusCode).toBe(200)
    expect(restoreResponse.headers['cache-control']).toBe('no-store')
    expect(restoreResponse.body).not.toContain(proof.signature)
    expect(restoreResponse.json()).toMatchObject({
      authenticated: true,
      merchantPublicId: MERCHANT_PUBLIC_ID,
      signerAddress: SETTLEMENT_ADDRESS,
    })
    const sessionCookie = cookiePair(
      restoreResponse.headers['set-cookie'],
      'nimreturn_merchant_session',
    )
    const rawSetCookie = String(restoreResponse.headers['set-cookie'])
    expect(rawSetCookie).toContain('HttpOnly')
    expect(rawSetCookie).toContain('Secure')
    expect(rawSetCookie).toContain('SameSite=Strict')
    expect(rawSetCookie).toContain('Max-Age=')
    expect(rawSetCookie).toContain('Expires=')

    const v2Response = await app.inject({
      cookies: { nimreturn_merchant_session: sessionCookie.split('=')[1] ?? '' },
      headers: { origin: MERCHANT_ORIGIN },
      method: 'POST',
      payload: {
        priceLuna: 2_000,
        returnWindowSeconds: 86_400,
        settlementAddress: SETTLEMENT_ADDRESS,
        warrantyTransferAllowed: false,
        warrantyWindowSeconds: 2_592_000,
      },
      url: `/api/v1/merchants/${MERCHANT_PUBLIC_ID}/products/${PRODUCT_PUBLIC_ID}/policies/challenges`,
    })
    expect(v2Response.statusCode).toBe(201)
    expect(policyInputs).toHaveLength(1)
    expect(sessionInputs[1]).toEqual({
      challengeNonce: POLICY_NONCE,
      merchantPublicId: MERCHANT_PUBLIC_ID,
      proof,
    })
  })

  it('rejects merchant session recovery from an unconfigured production origin', async () => {
    const app = await buildApp({
      ...writerConfig,
      CORS_ORIGIN: MERCHANT_ORIGIN,
      NODE_ENV: 'production',
    }, { database: {} as postgres.Sql })
    apps.push(app)

    const response = await app.inject({
      headers: { origin: 'https://attacker.example' },
      method: 'POST',
      payload: {},
      url: `/api/v1/merchants/${MERCHANT_PUBLIC_ID}/session/challenges`,
    })

    expect(response.statusCode).toBe(403)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.json()).toMatchObject({ code: 'ORIGIN_FORBIDDEN' })
  })

  it('bounds anonymous merchant draft creation per client', async () => {
    const app = await buildApp(writerConfig, {
      createDraft: () => Promise.resolve({
        bootstrapCapability: 'A'.repeat(43),
        bootstrapExpiresAt: new Date(Date.now() + 300_000),
        displayName: 'North Star',
        merchantPublicId: MERCHANT_PUBLIC_ID,
        productName: 'Trail cup',
        productPublicId: PRODUCT_PUBLIC_ID,
      }),
      database: {} as postgres.Sql,
    })
    apps.push(app)
    const request = {
      method: 'POST' as const,
      payload: {
        defaultSettlementAddress: SETTLEMENT_ADDRESS,
        displayName: 'North Star',
        productName: 'Trail cup',
      },
      url: '/api/v1/merchants',
    }

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(app.inject(request)).resolves.toMatchObject({ statusCode: 201 })
    }
    const limited = await app.inject(request)
    expect(limited.statusCode).toBe(429)
    expect(limited.json()).toMatchObject({ code: 'RATE_LIMITED' })
    expect(limited.json<{ message: string }>().message).toMatch(/Wait about \d+ minutes? before retrying/u)
  })

  it('maps failed merchant session proofs without issuing a cookie', async () => {
    let nextError: MerchantSessionRecoveryErrorCode = 'SIGNER_MISMATCH'
    const app = await buildApp(writerConfig, {
      database: {} as postgres.Sql,
      restoreMerchantSession: () => Promise.reject(
        new MerchantSessionRecoveryError(nextError, 'rejected'),
      ),
    })
    apps.push(app)
    const proof = {
      canonicalMessage: 'NIMRETURN/AUTH/1/MERCHANT_SESSION\n{}',
      payloadHash: 'a'.repeat(64),
      publicKey: 'b'.repeat(64),
      signature: 'c'.repeat(128),
    }
    const restore = (payload: unknown) => app.inject({
      method: 'POST',
      payload: payload as Record<string, unknown>,
      url: `/api/v1/merchants/${MERCHANT_PUBLIC_ID}/session`,
    })

    const expectations: [MerchantSessionRecoveryErrorCode, number][] = [
      ['SIGNER_MISMATCH', 422],
      ['MESSAGE_MISMATCH', 422],
      ['INVALID_SIGNATURE', 422],
      ['CHALLENGE_EXPIRED', 410],
      ['CHALLENGE_CONSUMED', 409],
      ['MERCHANT_NOT_FOUND', 404],
    ]
    for (const [code, statusCode] of expectations) {
      nextError = code
      const response = await restore({ challengeNonce: POLICY_NONCE, proof })
      expect(response.statusCode).toBe(statusCode)
      expect(response.json()).toMatchObject({ code })
      expect(response.headers['set-cookie']).toBeUndefined()
      expect(response.headers['cache-control']).toBe('no-store')
    }

    for (const payload of [
      { challengeNonce: POLICY_NONCE },
      { challengeNonce: POLICY_NONCE, proof: { ...proof, signature: 'zz' } },
      { challengeNonce: POLICY_NONCE, proof, signerAddress: SETTLEMENT_ADDRESS },
    ]) {
      const response = await restore(payload)
      expect(response.statusCode).toBe(400)
      expect(response.headers['set-cookie']).toBeUndefined()
    }
  })

  it('bounds merchant session recovery challenges separately per client', async () => {
    const app = await buildApp(writerConfig, {
      createMerchantSessionChallenge: () => Promise.reject(
        new MerchantSessionRecoveryError('MERCHANT_NOT_FOUND', 'missing'),
      ),
      database: {} as postgres.Sql,
    })
    apps.push(app)
    const request = {
      headers: { origin: 'http://localhost:5173' },
      method: 'POST' as const,
      payload: {},
      url: `/api/v1/merchants/${MERCHANT_PUBLIC_ID}/session/challenges`,
    }
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(app.inject(request)).resolves.toMatchObject({ statusCode: 404 })
    }
    const limited = await app.inject(request)
    expect(limited.statusCode).toBe(429)
    expect(limited.json()).toMatchObject({ code: 'RATE_LIMITED' })
  })

  it('creates a purchase order from only the public product identifier and server network', async () => {
    const inputs: unknown[] = []
    const app = await buildApp(config, {
      createOrder: (_database, input) => {
        inputs.push(input)
        return Promise.resolve(purchaseOrder())
      },
      database: {} as postgres.Sql,
    })
    apps.push(app)

    const response = await app.inject({
      method: 'POST',
      payload: {},
      url: `/api/v1/products/${PRODUCT_PUBLIC_ID}/orders`,
    })

    expect(response.statusCode).toBe(201)
    expect(inputs).toEqual([{ network: 'TestAlbatross', productPublicId: PRODUCT_PUBLIC_ID }])
    expect(response.json()).toMatchObject({
      expectedPayment: { data: `NR1:P:${ORDER_PUBLIC_ID}`, valueLuna: 1_000 },
      paymentState: 'payment_requested',
      publicId: ORDER_PUBLIC_ID,
    })
  })

  it('accepts only a transaction hash and never a client-claimed sender', async () => {
    const inputs: unknown[] = []
    const app = await buildApp(config, {
      database: {} as postgres.Sql,
      verifyPurchase: (_database, _reader, input) => {
        inputs.push(input)
        return Promise.resolve(purchaseOrder({
          paymentState: 'payment_pending',
          transaction: {
            blockNumber: null,
            blockTimestamp: null,
            executionResult: null,
            finalizingBlockNumber: null,
            hash: TRANSACTION_HASH,
            headBlockNumber: null,
            observedState: 'absent',
            reason: 'Not observed yet.',
            reconciliation: null,
            sender: null,
          },
        }))
      },
    })
    apps.push(app)

    const rejected = await app.inject({
      method: 'POST',
      payload: { hash: TRANSACTION_HASH, sender: SETTLEMENT_ADDRESS },
      url: `/api/v1/orders/${ORDER_PUBLIC_ID}/transactions`,
    })
    expect(rejected.statusCode).toBe(400)
    expect(inputs).toHaveLength(0)

    const accepted = await app.inject({
      method: 'POST',
      payload: { hash: TRANSACTION_HASH },
      url: `/api/v1/orders/${ORDER_PUBLIC_ID}/transactions`,
    })
    expect(accepted.statusCode).toBe(202)
    expect(inputs).toEqual([{ hash: TRANSACTION_HASH, orderPublicId: ORDER_PUBLIC_ID }])
  })

  it('serves a Passport only through its strict public identifier', async () => {
    const app = await buildApp(config, {
      database: {} as postgres.Sql,
      readPassport: (_database, publicId) => Promise.resolve({
        publicId,
        status: 'active',
      } as never),
    })
    apps.push(app)

    const invalid = await app.inject({ method: 'GET', url: '/api/v1/passports/not-valid' })
    expect(invalid.statusCode).toBe(400)

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/passports/${PASSPORT_PUBLIC_ID}`,
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ publicId: PASSPORT_PUBLIC_ID, status: 'active' })
  })
})
