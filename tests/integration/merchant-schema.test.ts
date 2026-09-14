import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { migrateDatabase } from '../../server/db/migrate.js'

const databaseUrl = process.env.TEST_DATABASE_URL
const VALID_ADDRESS_A = 'NQ46KLJE5TMF4Y1A1255CJHJYG1SH0NUT604'
const VALID_ADDRESS_B = 'NQ6616JYYPSEVGXT606D6YKEEURTHE0VARDR'
const VALID_ADDRESS_C = 'NQ88Q4DE829CAQ8188FP8MGJPP3BA70XCHN6'
const VALID_ADDRESS_D = 'NQ20NTLCVQK9PVLQJB3GAN7KM9033EC237EK'

function requireSafeTestDatabaseUrl(): string {
  if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required for database integration tests.')

  const parsed = new URL(databaseUrl)
  const databaseName = parsed.pathname.slice(1)
  if (!['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname) || !databaseName.endsWith('_test')) {
    throw new Error('Database integration tests require a local database whose name ends in _test.')
  }
  return databaseUrl
}

describe.skipIf(databaseUrl === undefined)('Phase 1 merchant database foundation', () => {
  const client = postgres(
    databaseUrl ?? 'postgresql://postgres:postgres@127.0.0.1:5432/nimreturn_test',
    { max: 1 },
  )

  beforeAll(async () => {
    await client.unsafe('drop schema if exists drizzle cascade')
    await client.unsafe('drop schema if exists public cascade')
    await client.unsafe('create schema public')
    await migrateDatabase(requireSafeTestDatabaseUrl())
  })

  afterAll(async () => {
    await client.end()
  })

  async function insertMerchant(publicId: string, settlementAddress = VALID_ADDRESS_B) {
    const rows = await client<{ id: string }[]>`
      insert into merchants (public_id, default_settlement_address, display_name)
      values (${publicId}, ${settlementAddress}, 'Fixture Merchant')
      returning id
    `
    const merchant = rows[0]
    if (!merchant) throw new Error('Merchant fixture insert returned no row.')
    return merchant.id
  }

  it('stores distinct settlement and proof-derived signer addresses', async () => {
    const merchantId = await insertMerchant('AAAAAAAAAAAAAAAAAAAAAA')
    await client`
      update merchants set policy_signer_address = ${VALID_ADDRESS_A} where id = ${merchantId}
    `
    const rows = await client<{
      default_settlement_address: string
      policy_signer_address: string
    }[]>`
      select default_settlement_address, policy_signer_address from merchants where id = ${merchantId}
    `
    expect(rows[0]).toEqual({
      default_settlement_address: VALID_ADDRESS_B,
      policy_signer_address: VALID_ADDRESS_A,
    })
  })

  it('rejects malformed IDs, addresses, and blank display names', async () => {
    await expect(client`
      insert into merchants (public_id, default_settlement_address, display_name)
      values ('short', ${VALID_ADDRESS_B}, 'Fixture')
    `).rejects.toThrow(/merchants_public_id_format/u)
    await expect(client`
      insert into merchants (public_id, default_settlement_address, display_name)
      values ('BBBBBBBBBBBBBBBBBBBBBB', 'NQ INVALID', 'Fixture')
    `).rejects.toThrow(/merchants_default_settlement_address_format/u)
    await expect(client`
      insert into merchants (public_id, default_settlement_address, display_name)
      values ('CCCCCCCCCCCCCCCCCCCCCC', ${VALID_ADDRESS_B}, '   ')
    `).rejects.toThrow(/merchants_display_name_not_blank/u)
  })

  it('makes an established signer immutable and unique', async () => {
    const merchantA = await insertMerchant('DDDDDDDDDDDDDDDDDDDDDD')
    const merchantB = await insertMerchant('EEEEEEEEEEEEEEEEEEEEEE')
    await client`update merchants set policy_signer_address = ${VALID_ADDRESS_C} where id = ${merchantA}`

    await expect(client`
      update merchants set policy_signer_address = ${VALID_ADDRESS_D} where id = ${merchantA}
    `).rejects.toThrow(/cannot be changed or cleared/u)
    await expect(client`
      update merchants set policy_signer_address = null where id = ${merchantA}
    `).rejects.toThrow(/cannot be changed or cleared/u)
    await expect(client`
      update merchants set policy_signer_address = ${VALID_ADDRESS_C} where id = ${merchantB}
    `).rejects.toThrow(/merchants_policy_signer_address_unique/u)
    await expect(client`delete from merchants where id = ${merchantA}`)
      .rejects.toThrow(/policy signer is immutable/u)
  })

  it('enforces one immutable unconsumed bootstrap capability per merchant', async () => {
    const merchantId = await insertMerchant('FFFFFFFFFFFFFFFFFFFFFF')
    const firstHash = 'ab'.repeat(32)
    const secondHash = 'cd'.repeat(32)
    const sessions = await client<{ id: string }[]>`
      insert into merchant_bootstrap_sessions (merchant_id, capability_hash, expires_at)
      values (${merchantId}, ${firstHash}, now() + interval '10 minutes')
      returning id
    `
    const session = sessions[0]
    if (!session) throw new Error('Bootstrap fixture insert returned no row.')

    await expect(client`
      insert into merchant_bootstrap_sessions (merchant_id, capability_hash, expires_at)
      values (${merchantId}, ${secondHash}, now() + interval '10 minutes')
    `).rejects.toThrow(/one_unconsumed_per_merchant/u)
    await expect(client`
      update merchant_bootstrap_sessions set capability_hash = ${secondHash} where id = ${session.id}
    `).rejects.toThrow(/session identity is immutable/u)

    await client`
      update merchant_bootstrap_sessions set consumed_at = now() where id = ${session.id}
    `
    await client`
      insert into merchant_bootstrap_sessions (merchant_id, capability_hash, expires_at)
      values (${merchantId}, ${secondHash}, now() + interval '10 minutes')
    `
    await expect(client`
      update merchant_bootstrap_sessions set consumed_at = null where id = ${session.id}
    `).rejects.toThrow(/consumed merchant bootstrap session is immutable/u)
  })

  it('rejects malformed/expired bootstrap rows and bootstrap after signer establishment', async () => {
    const merchantId = await insertMerchant('GGGGGGGGGGGGGGGGGGGGGG')
    await expect(client`
      insert into merchant_bootstrap_sessions (merchant_id, capability_hash, expires_at)
      values (${merchantId}, 'AB', now() + interval '10 minutes')
    `).rejects.toThrow(/capability_hash_format/u)
    await expect(client`
      insert into merchant_bootstrap_sessions (merchant_id, capability_hash, expires_at)
      values (${merchantId}, ${'ef'.repeat(32)}, now() - interval '1 second')
    `).rejects.toThrow(/valid_times/u)

    await client`update merchants set policy_signer_address = ${VALID_ADDRESS_D} where id = ${merchantId}`
    await expect(client`
      insert into merchant_bootstrap_sessions (merchant_id, capability_hash, expires_at)
      values (${merchantId}, ${'12'.repeat(32)}, now() + interval '10 minutes')
    `).rejects.toThrow(/cannot bootstrap an established merchant/u)
  })
})
