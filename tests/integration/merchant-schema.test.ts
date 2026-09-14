import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { migrateDatabase } from '../../server/db/migrate.js'
import { hashProtocolPayload } from '../../src/lib/crypto/nimiq-signature.js'
import { buildPolicyMessage, type PolicyPayload } from '../../src/lib/protocol/policy.js'

const databaseUrl = process.env.TEST_DATABASE_URL
const VALID_ADDRESS_A = 'NQ46KLJE5TMF4Y1A1255CJHJYG1SH0NUT604'
const VALID_ADDRESS_B = 'NQ6616JYYPSEVGXT606D6YKEEURTHE0VARDR'
const VALID_ADDRESS_C = 'NQ88Q4DE829CAQ8188FP8MGJPP3BA70XCHN6'
const VALID_ADDRESS_D = 'NQ20NTLCVQK9PVLQJB3GAN7KM9033EC237EK'
const VALID_ADDRESS_E = 'NQ55JSY8LN1TPUKTSFVQLVA5A2NVRFM10TAE'
const VALID_ADDRESS_F = 'NQ707XHXFXUTMGTAFND7MAABY7TBHKT5KFBT'

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

  async function insertProduct(merchantId: string, publicId: string, name = 'Fixture Product') {
    const rows = await client<{ id: string }[]>`
      insert into products (public_id, merchant_id, name)
      values (${publicId}, ${merchantId}, ${name})
      returning id
    `
    const product = rows[0]
    if (!product) throw new Error('Product fixture insert returned no row.')
    return product.id
  }

  async function insertPolicy(input: {
    merchantId: string
    merchantPublicId: string
    nonce: string
    policyPublicId: string
    productId: string
    productPublicId: string
    priceLuna?: number
    version?: number
  }) {
    const payload: PolicyPayload = {
      createdAt: 1_789_335_000_000,
      merchantId: input.merchantPublicId,
      nonce: input.nonce,
      policyId: input.policyPublicId,
      priceLuna: input.priceLuna ?? 500_000,
      productId: input.productPublicId,
      productName: 'Fixture Product',
      protocol: 'NR1',
      returnWindowSeconds: 604_800,
      settlementAddress: VALID_ADDRESS_B,
      type: 'POLICY',
      version: input.version ?? 1,
      warrantyTransferAllowed: false,
      warrantyWindowSeconds: 7_776_000,
    }
    const canonicalMessage = buildPolicyMessage(payload)
    const payloadHash = hashProtocolPayload(canonicalMessage)
    const rows = await client<{ id: string }[]>`
      insert into policy_versions (
        public_id, product_id, merchant_id, version, product_name, price_luna,
        return_window_seconds, warranty_window_seconds, warranty_transfer_allowed,
        protocol_version, challenge_nonce, payload, canonical_message, payload_hash,
        settlement_address
      ) values (
        ${input.policyPublicId}, ${input.productId}, ${input.merchantId}, ${payload.version},
        ${payload.productName}, ${payload.priceLuna}, ${payload.returnWindowSeconds},
        ${payload.warrantyWindowSeconds}, ${payload.warrantyTransferAllowed}, ${payload.protocol},
        ${payload.nonce}, ${client.json(payload)}, ${canonicalMessage}, ${payloadHash},
        ${payload.settlementAddress}
      )
      returning id
    `
    const policy = rows[0]
    if (!policy) throw new Error('Policy fixture insert returned no row.')
    return { canonicalMessage, payload, payloadHash, policyVersionId: policy.id }
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

  it('atomically completes first-policy identity and activates only verified policy', async () => {
    const merchantPublicId = 'HHHHHHHHHHHHHHHHHHHHHH'
    const productPublicId = 'IIIIIIIIIIIIIIIIIIIIII'
    const merchantId = await insertMerchant(merchantPublicId)
    const bootstrapRows = await client<{ id: string }[]>`
      insert into merchant_bootstrap_sessions (merchant_id, capability_hash, expires_at)
      values (${merchantId}, ${'34'.repeat(32)}, now() + interval '10 minutes')
      returning id
    `
    const bootstrapSession = bootstrapRows[0]
    if (!bootstrapSession) throw new Error('Bootstrap fixture insert returned no row.')

    const productId = await insertProduct(merchantId, productPublicId)
    const policy = await insertPolicy({
      merchantId,
      merchantPublicId,
      nonce: 'KKKKKKKKKKKKKKKKKKKKKK',
      policyPublicId: 'JJJJJJJJJJJJJJJJJJJJJJ',
      productId,
      productPublicId,
    })
    const challengeRows = await client<{ id: string }[]>`
      insert into signing_challenges (
        nonce, action, merchant_id, policy_version_id, bootstrap_session_id,
        canonical_message, payload_hash, expires_at
      ) values (
        ${policy.payload.nonce}, 'POLICY', ${merchantId}, ${policy.policyVersionId},
        ${bootstrapSession.id}, ${policy.canonicalMessage}, ${policy.payloadHash},
        now() + interval '5 minutes'
      )
      returning id
    `
    const challenge = challengeRows[0]
    if (!challenge) throw new Error('Challenge fixture insert returned no row.')

    await expect(client`
      update products
      set status = 'active', active_policy_version_id = ${policy.policyVersionId}
      where id = ${productId}
    `).rejects.toThrow(/active policy must be a verified version/u)
    await expect(client`
      update policy_versions set
        signer_address = ${VALID_ADDRESS_E}, public_key = ${'aa'.repeat(32)},
        signature = ${'bb'.repeat(64)}, verification_status = 'verified',
        verified_at = now(), verifier_version = 'integration-test'
      where id = ${policy.policyVersionId}
    `).rejects.toThrow(/does not match established merchant signer/u)

    await client.begin(async (transaction) => {
      await transaction`
        update merchants set policy_signer_address = ${VALID_ADDRESS_E} where id = ${merchantId}
      `
      await transaction`
        update policy_versions set
          signer_address = ${VALID_ADDRESS_E}, public_key = ${'aa'.repeat(32)},
          signature = ${'bb'.repeat(64)}, verification_status = 'verified',
          verified_at = now(), verifier_version = 'integration-test'
        where id = ${policy.policyVersionId}
      `
      await transaction`
        update signing_challenges set consumed_at = now() where id = ${challenge.id}
      `
      await transaction`
        update merchant_bootstrap_sessions set consumed_at = now() where id = ${bootstrapSession.id}
      `
      await transaction`
        insert into protocol_events (
          aggregate_type, aggregate_id, event_type, protocol_version, occurred_at,
          actor_address, correlation_id, evidence_type, evidence_id, payload
        ) values (
          'policy', ${policy.policyVersionId}, 'policy.verified', 'NR1', now(),
          ${VALID_ADDRESS_E}, gen_random_uuid(), 'signature', ${policy.policyVersionId},
          ${transaction.json({ version: 1 })}
        )
      `
    })

    await client`
      update products
      set status = 'active', active_policy_version_id = ${policy.policyVersionId}
      where id = ${productId}
    `
    const productRows = await client<{
      active_policy_version_id: string
      row_version: number
      status: string
    }[]>`select active_policy_version_id, row_version, status from products where id = ${productId}`
    expect(productRows[0]).toEqual({
      active_policy_version_id: policy.policyVersionId,
      row_version: 2,
      status: 'active',
    })

    await expect(client`
      update policy_versions set signer_address = ${VALID_ADDRESS_F} where id = ${policy.policyVersionId}
    `).rejects.toThrow(/terminal policy version is immutable/u)
    await expect(client`delete from policy_versions where id = ${policy.policyVersionId}`)
      .rejects.toThrow(/verified policy version is immutable/u)
    await expect(client`
      update signing_challenges set consumed_at = now() where id = ${challenge.id}
    `).rejects.toThrow(/consumption is one-way/u)
  })

  it('binds established-signer challenges and exact policy evidence', async () => {
    const merchantPublicId = 'LLLLLLLLLLLLLLLLLLLLLL'
    const productPublicId = 'MMMMMMMMMMMMMMMMMMMMMM'
    const merchantId = await insertMerchant(merchantPublicId)
    await client`update merchants set policy_signer_address = ${VALID_ADDRESS_F} where id = ${merchantId}`
    const productId = await insertProduct(merchantId, productPublicId)
    const policy = await insertPolicy({
      merchantId,
      merchantPublicId,
      nonce: 'OOOOOOOOOOOOOOOOOOOOOO',
      policyPublicId: 'NNNNNNNNNNNNNNNNNNNNNN',
      productId,
      productPublicId,
    })

    await expect(client`
      insert into signing_challenges (
        nonce, action, merchant_id, policy_version_id, expected_signer_address,
        canonical_message, payload_hash, expires_at
      ) values (
        ${policy.payload.nonce}, 'POLICY', ${merchantId}, ${policy.policyVersionId},
        ${VALID_ADDRESS_E}, ${policy.canonicalMessage}, ${policy.payloadHash},
        now() + interval '5 minutes'
      )
    `).rejects.toThrow(/does not match merchant authority/u)

    await client`
      insert into signing_challenges (
        nonce, action, merchant_id, policy_version_id, expected_signer_address,
        canonical_message, payload_hash, expires_at
      ) values (
        ${policy.payload.nonce}, 'POLICY', ${merchantId}, ${policy.policyVersionId},
        ${VALID_ADDRESS_F}, ${policy.canonicalMessage}, ${policy.payloadHash},
        now() + interval '5 minutes'
      )
    `

    const secondProductId = await insertProduct(merchantId, 'PPPPPPPPPPPPPPPPPPPPPP')
    await expect(client`
      update products set active_policy_version_id = ${policy.policyVersionId} where id = ${secondProductId}
    `).rejects.toThrow(/verified version of this product/u)
  })

  it('rejects mismatched policy ownership, payload columns, and duplicate versions', async () => {
    const merchantPublicId = 'QQQQQQQQQQQQQQQQQQQQQQ'
    const otherMerchantPublicId = 'RRRRRRRRRRRRRRRRRRRRRR'
    const productPublicId = 'SSSSSSSSSSSSSSSSSSSSSS'
    const merchantId = await insertMerchant(merchantPublicId)
    const otherMerchantId = await insertMerchant(otherMerchantPublicId)
    const productId = await insertProduct(merchantId, productPublicId)
    const policy = await insertPolicy({
      merchantId,
      merchantPublicId,
      nonce: 'UUUUUUUUUUUUUUUUUUUUUU',
      policyPublicId: 'TTTTTTTTTTTTTTTTTTTTTT',
      productId,
      productPublicId,
    })

    await expect(insertPolicy({
      merchantId: otherMerchantId,
      merchantPublicId: otherMerchantPublicId,
      nonce: 'WWWWWWWWWWWWWWWWWWWWWW',
      policyPublicId: 'VVVVVVVVVVVVVVVVVVVVVV',
      productId,
      productPublicId,
    })).rejects.toThrow(/ownership do not match/u)

    const mismatchedPayload: PolicyPayload = {
      ...policy.payload,
      nonce: '1111111111111111111111',
      policyId: 'ZZZZZZZZZZZZZZZZZZZZZZ',
      version: 2,
    }
    const mismatchedMessage = buildPolicyMessage(mismatchedPayload)
    await expect(client`
      insert into policy_versions (
        public_id, product_id, merchant_id, version, product_name, price_luna,
        return_window_seconds, warranty_window_seconds, warranty_transfer_allowed,
        protocol_version, challenge_nonce, payload, canonical_message, payload_hash,
        settlement_address
      ) values (
        ${mismatchedPayload.policyId}, ${productId}, ${merchantId}, ${mismatchedPayload.version},
        ${mismatchedPayload.productName}, ${mismatchedPayload.priceLuna + 1},
        ${mismatchedPayload.returnWindowSeconds}, ${mismatchedPayload.warrantyWindowSeconds},
        ${mismatchedPayload.warrantyTransferAllowed}, ${mismatchedPayload.protocol},
        ${mismatchedPayload.nonce}, ${client.json(mismatchedPayload)}, ${mismatchedMessage},
        ${hashProtocolPayload(mismatchedMessage)}, ${mismatchedPayload.settlementAddress}
      )
    `).rejects.toThrow(/payload does not match normalized policy columns/u)

    await expect(insertPolicy({
      merchantId,
      merchantPublicId,
      nonce: 'YYYYYYYYYYYYYYYYYYYYYY',
      policyPublicId: 'XXXXXXXXXXXXXXXXXXXXXX',
      productId,
      productPublicId,
    })).rejects.toThrow(/policy_versions_product_version_unique/u)
  })

  it('keeps protocol events append-only', async () => {
    const aggregateIdRows = await client<{ id: string }[]>`select gen_random_uuid() as id`
    const aggregateId = aggregateIdRows[0]?.id
    if (!aggregateId) throw new Error('UUID fixture query returned no row.')
    const eventRows = await client<{ id: number }[]>`
      insert into protocol_events (
        aggregate_type, aggregate_id, event_type, protocol_version, occurred_at,
        correlation_id, evidence_type, payload
      ) values (
        'merchant', ${aggregateId}, 'merchant.created', 'NR1', now(),
        gen_random_uuid(), 'backend', ${client.json({ source: 'integration-test' })}
      ) returning id
    `
    const eventId = eventRows[0]?.id
    if (!eventId) throw new Error('Event fixture insert returned no row.')

    await expect(client`
      update protocol_events set event_type = 'merchant.changed' where id = ${eventId}
    `).rejects.toThrow(/append-only/u)
    await expect(client`delete from protocol_events where id = ${eventId}`)
      .rejects.toThrow(/append-only/u)
  })
})
