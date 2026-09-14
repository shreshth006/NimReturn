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
})
