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
})
