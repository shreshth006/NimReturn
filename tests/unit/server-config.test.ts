import { describe, expect, it } from 'vitest'

import { parseServerConfig } from '../../server/config.js'

const productionEnvironment = {
  CORS_ORIGIN: 'https://staging.example.com',
  DATABASE_URL: 'postgresql://runtime:secret@database.example.com:5432/nimreturn',
  NIMIQ_NETWORK: 'TestAlbatross',
  NIMIQ_RPC_URL: 'https://rpc.example.com',
  NODE_ENV: 'production',
  SESSION_SECRET: '0123456789abcdef0123456789abcdef',
}

describe('server production configuration', () => {
  it('requires every dependency used by the staging lifecycle', () => {
    for (const field of ['CORS_ORIGIN', 'DATABASE_URL', 'NIMIQ_RPC_URL', 'SESSION_SECRET']) {
      const environment = { ...productionEnvironment, [field]: '' }
      expect(() => parseServerConfig(environment)).toThrow(`${field} is required in production`)
    }
  })

  it('accepts a complete HTTPS TestAlbatross configuration', () => {
    expect(parseServerConfig(productionEnvironment)).toMatchObject({
      CORS_ORIGIN: productionEnvironment.CORS_ORIGIN,
      NIMIQ_NETWORK: 'TestAlbatross',
      NIMIQ_RPC_URL: productionEnvironment.NIMIQ_RPC_URL,
      NODE_ENV: 'production',
    })
  })

  it('keeps the optional featured Passport identifier strict and out of defaults', () => {
    expect(parseServerConfig(productionEnvironment).FEATURED_PASSPORT_ID).toBeUndefined()
    expect(parseServerConfig({
      ...productionEnvironment,
      FEATURED_PASSPORT_ID: 'AAAAAAAAAAAAAAAAAAAAAA',
    }).FEATURED_PASSPORT_ID).toBe('AAAAAAAAAAAAAAAAAAAAAA')
    expect(() => parseServerConfig({
      ...productionEnvironment,
      FEATURED_PASSPORT_ID: 'not-a-public-id',
    })).toThrow('FEATURED_PASSPORT_ID')
  })

  it('derives the exact public origin from Render without weakening production validation', () => {
    expect(parseServerConfig({
      ...productionEnvironment,
      CORS_ORIGIN: '',
      RENDER_EXTERNAL_HOSTNAME: 'nimreturn-staging-cycle2.onrender.com',
    }).CORS_ORIGIN).toBe('https://nimreturn-staging-cycle2.onrender.com')
  })
})
