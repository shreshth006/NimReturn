import { Hash, KeyPair, PrivateKey } from '@nimiq/core'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { migrateDatabase } from '../../server/db/migrate.js'
import { buildApp } from '../../server/app.js'
import type { ServerConfig } from '../../server/config.js'
import { createMerchantDraft } from '../../server/domain/create-merchant-draft.js'
import { createPolicyChallenge } from '../../server/domain/create-policy-challenge.js'
import { expireStalePolicyChallenges } from '../../server/domain/expire-policy-challenges.js'
import { getPublicVerifiedProduct } from '../../server/domain/get-public-product.js'
import { hashMerchantBootstrapCapability } from '../../server/domain/merchant-bootstrap.js'
import { publishVerifiedPolicy } from '../../server/domain/publish-policy.js'
import { hashProtocolPayload } from '../../src/lib/crypto/nimiq-signature.js'
import { buildPolicyMessage, type PolicyPayload } from '../../src/lib/protocol/policy.js'

const databaseUrl = process.env.TEST_DATABASE_URL
const VALID_ADDRESS_A = 'NQ46KLJE5TMF4Y1A1255CJHJYG1SH0NUT604'
const VALID_ADDRESS_B = 'NQ6616JYYPSEVGXT606D6YKEEURTHE0VARDR'
const VALID_ADDRESS_C = 'NQ88Q4DE829CAQ8188FP8MGJPP3BA70XCHN6'
const VALID_ADDRESS_D = 'NQ20NTLCVQK9PVLQJB3GAN7KM9033EC237EK'
const VALID_ADDRESS_E = 'NQ55JSY8LN1TPUKTSFVQLVA5A2NVRFM10TAE'
const VALID_ADDRESS_F = 'NQ707XHXFXUTMGTAFND7MAABY7TBHKT5KFBT'
const PRIVATE_KEY_POLICY_FIRST = '202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f'
const PRIVATE_KEY_POLICY_ESTABLISHED = '404142434445464748494a4b4c4d4e4f505152535455565758595a5b5c5d5e5f'
const PRIVATE_KEY_POLICY_CONCURRENT = '606162636465666768696a6b6c6d6e6f707172737475767778797a7b7c7d7e7f'
const PRIVATE_KEY_POLICY_API_JOURNEY = '0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20'
const UTF8_ENCODER = new TextEncoder()
const SIGNED_MESSAGE_PREFIX = '\x16Nimiq Signed Message:\n'

function createPolicyProof(privateKeyHex: string, canonicalMessage: string) {
  const messageBytes = UTF8_ENCODER.encode(canonicalMessage)
  const header = UTF8_ENCODER.encode(SIGNED_MESSAGE_PREFIX + messageBytes.byteLength.toString(10))
  const preimage = new Uint8Array(header.byteLength + messageBytes.byteLength)
  preimage.set(header)
  preimage.set(messageBytes, header.byteLength)

  const privateKey = PrivateKey.fromHex(privateKeyHex)
  const keyPair = KeyPair.derive(privateKey)
  const signature = keyPair.sign(Hash.computeSha256(preimage))
  const address = keyPair.toAddress()
  try {
    return {
      address: address.toUserFriendlyAddress().replaceAll(' ', '').toUpperCase(),
      proof: {
        canonicalMessage,
        payloadHash: hashProtocolPayload(canonicalMessage),
        publicKey: keyPair.publicKey.toHex(),
        signature: signature.toHex(),
      },
    }
  } finally {
    address.free()
    signature.free()
    keyPair.free()
    privateKey.free()
  }
}

function requireSafeTestDatabaseUrl(): string {
  if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required for database integration tests.')

  const parsed = new URL(databaseUrl)
  const databaseName = parsed.pathname.slice(1)
  if (!['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname) || !databaseName.endsWith('_test')) {
    throw new Error('Database integration tests require a local database whose name ends in _test.')
  }
  return databaseUrl
}

function responseCookie(
  headers: string | string[] | undefined,
  name: string,
): { name: string; value: string } {
  const values = Array.isArray(headers) ? headers : headers ? [headers] : []
  const rawCookie = values.find((value) => value.startsWith(`${name}=`))
  if (!rawCookie) throw new Error(`Missing ${name} response cookie.`)
  const pair = rawCookie.split(';')[0]
  const separator = pair?.indexOf('=') ?? -1
  if (!pair || separator < 1) throw new Error(`Invalid ${name} response cookie.`)
  return { name: pair.slice(0, separator), value: pair.slice(separator + 1) }
}

describe.skipIf(databaseUrl === undefined)('Phase 1 merchant database foundation', () => {
  const client = postgres(
    databaseUrl ?? 'postgresql://postgres:postgres@127.0.0.1:5432/nimreturn_test',
    { max: 4 },
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
    await expect(client`
      insert into merchants (
        public_id, policy_signer_address, default_settlement_address, display_name
      ) values (
        'mmmmmmmmmmmmmmmmmmmmmm', ${VALID_ADDRESS_E}, ${VALID_ADDRESS_B}, 'Fixture'
      )
    `).rejects.toThrow(/new merchant must begin without a policy signer/u)
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

    const competingProductPublicId = '2222222222222222222222'
    const competingProductId = await insertProduct(merchantId, competingProductPublicId)
    const competingPolicy = await insertPolicy({
      merchantId,
      merchantPublicId,
      nonce: '3333333333333333333333',
      policyPublicId: '4444444444444444444444',
      productId: competingProductId,
      productPublicId: competingProductPublicId,
    })
    await expect(client`
      insert into signing_challenges (
        nonce, action, merchant_id, policy_version_id, bootstrap_session_id,
        canonical_message, payload_hash, expires_at
      ) values (
        ${competingPolicy.payload.nonce}, 'POLICY', ${merchantId},
        ${competingPolicy.policyVersionId}, ${bootstrapSession.id},
        ${competingPolicy.canonicalMessage}, ${competingPolicy.payloadHash},
        now() + interval '5 minutes'
      )
    `).rejects.toThrow(/signing_challenges_bootstrap_session_unique/u)

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

    const preverifiedPayload: PolicyPayload = {
      ...policy.payload,
      nonce: 'oooooooooooooooooooooo',
      policyId: 'nnnnnnnnnnnnnnnnnnnnnn',
      version: 2,
    }
    const preverifiedMessage = buildPolicyMessage(preverifiedPayload)
    await expect(client`
      insert into policy_versions (
        public_id, product_id, merchant_id, version, product_name, price_luna,
        return_window_seconds, warranty_window_seconds, warranty_transfer_allowed,
        protocol_version, challenge_nonce, payload, canonical_message, payload_hash,
        settlement_address, signer_address, public_key, signature,
        verification_status, verified_at, verifier_version
      ) values (
        ${preverifiedPayload.policyId}, ${productId}, ${merchantId}, ${preverifiedPayload.version},
        ${preverifiedPayload.productName}, ${preverifiedPayload.priceLuna},
        ${preverifiedPayload.returnWindowSeconds}, ${preverifiedPayload.warrantyWindowSeconds},
        ${preverifiedPayload.warrantyTransferAllowed}, ${preverifiedPayload.protocol},
        ${preverifiedPayload.nonce}, ${client.json(preverifiedPayload)}, ${preverifiedMessage},
        ${hashProtocolPayload(preverifiedMessage)}, ${preverifiedPayload.settlementAddress},
        ${VALID_ADDRESS_E}, ${'aa'.repeat(32)}, ${'bb'.repeat(64)},
        'verified', now(), 'bypass-attempt'
      )
    `).rejects.toThrow(/new policy version must begin pending without proof/u)

    await expect(insertPolicy({
      merchantId,
      merchantPublicId,
      nonce: 'YYYYYYYYYYYYYYYYYYYYYY',
      policyPublicId: 'XXXXXXXXXXXXXXXXXXXXXX',
      productId,
      productPublicId,
    })).rejects.toThrow(/policy_versions_product_version_unique/u)

    await expect(client`
      update products set public_id = 'gggggggggggggggggggggg' where id = ${productId}
    `).rejects.toThrow(/product identity and ownership are immutable/u)
    await expect(client`
      update products set merchant_id = ${otherMerchantId} where id = ${productId}
    `).rejects.toThrow(/product identity and ownership are immutable/u)
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

  it('publishes a first policy atomically and rolls back invalid attempts', async () => {
    const merchantPublicId = '5555555555555555555555'
    const productPublicId = '6666666666666666666666'
    const merchantId = await insertMerchant(merchantPublicId)
    const bootstrapCapability = 'A'.repeat(43)
    const bootstrapRows = await client<{ id: string }[]>`
      insert into merchant_bootstrap_sessions (merchant_id, capability_hash, expires_at)
      values (
        ${merchantId}, ${hashMerchantBootstrapCapability(bootstrapCapability)},
        now() + interval '10 minutes'
      )
      returning id
    `
    const bootstrap = bootstrapRows[0]
    if (!bootstrap) throw new Error('Bootstrap fixture insert returned no row.')

    const productId = await insertProduct(merchantId, productPublicId)
    const policy = await insertPolicy({
      merchantId,
      merchantPublicId,
      nonce: '8888888888888888888888',
      policyPublicId: '7777777777777777777777',
      productId,
      productPublicId,
    })
    await client`
      insert into signing_challenges (
        nonce, action, merchant_id, policy_version_id, bootstrap_session_id,
        canonical_message, payload_hash, expires_at
      ) values (
        ${policy.payload.nonce}, 'POLICY', ${merchantId}, ${policy.policyVersionId},
        ${bootstrap.id}, ${policy.canonicalMessage}, ${policy.payloadHash},
        now() + interval '5 minutes'
      )
    `
    const validFixture = createPolicyProof(PRIVATE_KEY_POLICY_FIRST, policy.canonicalMessage)
    const validProof = validFixture.proof

    await expect(publishVerifiedPolicy(client, {
      bootstrapCapability: 'B'.repeat(43),
      challengeNonce: policy.payload.nonce,
      merchantPublicId,
      proof: validProof,
      productPublicId,
    })).rejects.toMatchObject({ code: 'BOOTSTRAP_MISMATCH', name: 'PolicyPublishError' })

    const changedByte = validProof.signature.startsWith('00') ? '01' : '00'
    await expect(publishVerifiedPolicy(client, {
      bootstrapCapability,
      challengeNonce: policy.payload.nonce,
      merchantPublicId,
      proof: { ...validProof, signature: changedByte + validProof.signature.slice(2) },
      productPublicId,
    })).rejects.toMatchObject({ code: 'INVALID_SIGNATURE', name: 'PolicyPublishError' })

    const beforeSuccess = await client<{
      bootstrap_consumed_at: Date | null
      challenge_consumed_at: Date | null
      policy_signer_address: string | null
      verification_status: string
    }[]>`
      select
        merchants.policy_signer_address,
        policy_versions.verification_status,
        signing_challenges.consumed_at as challenge_consumed_at,
        merchant_bootstrap_sessions.consumed_at as bootstrap_consumed_at
      from policy_versions
      join merchants on merchants.id = policy_versions.merchant_id
      join signing_challenges on signing_challenges.policy_version_id = policy_versions.id
      join merchant_bootstrap_sessions
        on merchant_bootstrap_sessions.id = signing_challenges.bootstrap_session_id
      where policy_versions.id = ${policy.policyVersionId}
    `
    expect(beforeSuccess[0]).toEqual({
      bootstrap_consumed_at: null,
      challenge_consumed_at: null,
      policy_signer_address: null,
      verification_status: 'pending',
    })

    const published = await publishVerifiedPolicy(client, {
      bootstrapCapability,
      challengeNonce: policy.payload.nonce,
      merchantPublicId,
      proof: validProof,
      productPublicId,
    })
    expect(published).toMatchObject({
      actualSignerAddress: validFixture.address,
      firstPolicyForMerchant: true,
      merchantId,
      policyVersionId: policy.policyVersionId,
      productId,
    })
    expect(published.protocolEventId).toMatch(/^[0-9a-f-]{36}$/u)

    const afterSuccess = await client<{
      active_policy_version_id: string
      bootstrap_consumed_at: Date | null
      challenge_consumed_at: Date | null
      policy_signer_address: string | null
      signer_address: string | null
      status: string
      verification_status: string
    }[]>`
      select
        merchants.policy_signer_address,
        policy_versions.signer_address,
        policy_versions.verification_status,
        products.status,
        products.active_policy_version_id,
        signing_challenges.consumed_at as challenge_consumed_at,
        merchant_bootstrap_sessions.consumed_at as bootstrap_consumed_at
      from policy_versions
      join merchants on merchants.id = policy_versions.merchant_id
      join products on products.id = policy_versions.product_id
      join signing_challenges on signing_challenges.policy_version_id = policy_versions.id
      join merchant_bootstrap_sessions
        on merchant_bootstrap_sessions.id = signing_challenges.bootstrap_session_id
      where policy_versions.id = ${policy.policyVersionId}
    `
    expect(afterSuccess[0]).toMatchObject({
      active_policy_version_id: policy.policyVersionId,
      policy_signer_address: validFixture.address,
      signer_address: validFixture.address,
      status: 'active',
      verification_status: 'verified',
    })
    expect(afterSuccess[0]?.challenge_consumed_at).toBeInstanceOf(Date)
    expect(afterSuccess[0]?.bootstrap_consumed_at).toBeInstanceOf(Date)

    await expect(publishVerifiedPolicy(client, {
      bootstrapCapability,
      challengeNonce: policy.payload.nonce,
      merchantPublicId,
      proof: validProof,
      productPublicId,
    })).rejects.toMatchObject({ code: 'CHALLENGE_CONSUMED', name: 'PolicyPublishError' })
  })

  it('rejects a valid proof from the wrong established policy signer', async () => {
    const merchantPublicId = '9999999999999999999999'
    const productPublicId = '0000000000000000000000'
    const merchantId = await insertMerchant(merchantPublicId)
    const signerFixture = createPolicyProof(
      PRIVATE_KEY_POLICY_ESTABLISHED,
      'signer-address-fixture',
    )
    await client`
      update merchants set policy_signer_address = ${signerFixture.address} where id = ${merchantId}
    `
    const productId = await insertProduct(merchantId, productPublicId)
    const policy = await insertPolicy({
      merchantId,
      merchantPublicId,
      nonce: 'aaaaaaaaaaaaaaaaaaaaaa',
      policyPublicId: 'bbbbbbbbbbbbbbbbbbbbbb',
      productId,
      productPublicId,
    })
    await client`
      insert into signing_challenges (
        nonce, action, merchant_id, policy_version_id, expected_signer_address,
        canonical_message, payload_hash, expires_at
      ) values (
        ${policy.payload.nonce}, 'POLICY', ${merchantId}, ${policy.policyVersionId},
        ${signerFixture.address}, ${policy.canonicalMessage}, ${policy.payloadHash},
        now() + interval '5 minutes'
      )
    `

    const wrongProof = createPolicyProof(PRIVATE_KEY_POLICY_FIRST, policy.canonicalMessage).proof
    await expect(publishVerifiedPolicy(client, {
      challengeNonce: policy.payload.nonce,
      merchantPublicId,
      proof: wrongProof,
      productPublicId,
    })).rejects.toMatchObject({ code: 'SIGNER_MISMATCH', name: 'PolicyPublishError' })
    const pendingRows = await client<{
      consumed_at: Date | null
      verification_status: string
    }[]>`
      select signing_challenges.consumed_at, policy_versions.verification_status
      from signing_challenges
      join policy_versions on policy_versions.id = signing_challenges.policy_version_id
      where signing_challenges.nonce = ${policy.payload.nonce}
    `
    expect(pendingRows[0]).toEqual({ consumed_at: null, verification_status: 'pending' })

    const validProof = createPolicyProof(
      PRIVATE_KEY_POLICY_ESTABLISHED,
      policy.canonicalMessage,
    ).proof
    await expect(publishVerifiedPolicy(client, {
      challengeNonce: policy.payload.nonce,
      merchantPublicId,
      proof: validProof,
      productPublicId,
    })).resolves.toMatchObject({
      actualSignerAddress: signerFixture.address,
      firstPolicyForMerchant: false,
    })
  })

  it('serializes concurrent submissions so exactly one consumes the first-policy proof', async () => {
    const merchantPublicId = 'cccccccccccccccccccccc'
    const productPublicId = 'dddddddddddddddddddddd'
    const merchantId = await insertMerchant(merchantPublicId)
    const bootstrapCapability = 'C'.repeat(43)
    const bootstrapRows = await client<{ id: string }[]>`
      insert into merchant_bootstrap_sessions (merchant_id, capability_hash, expires_at)
      values (
        ${merchantId}, ${hashMerchantBootstrapCapability(bootstrapCapability)},
        now() + interval '10 minutes'
      )
      returning id
    `
    const bootstrap = bootstrapRows[0]
    if (!bootstrap) throw new Error('Bootstrap fixture insert returned no row.')
    const productId = await insertProduct(merchantId, productPublicId)
    const policy = await insertPolicy({
      merchantId,
      merchantPublicId,
      nonce: 'eeeeeeeeeeeeeeeeeeeeee',
      policyPublicId: 'ffffffffffffffffffffff',
      productId,
      productPublicId,
    })
    await client`
      insert into signing_challenges (
        nonce, action, merchant_id, policy_version_id, bootstrap_session_id,
        canonical_message, payload_hash, expires_at
      ) values (
        ${policy.payload.nonce}, 'POLICY', ${merchantId}, ${policy.policyVersionId},
        ${bootstrap.id}, ${policy.canonicalMessage}, ${policy.payloadHash},
        now() + interval '5 minutes'
      )
    `
    const proof = createPolicyProof(PRIVATE_KEY_POLICY_CONCURRENT, policy.canonicalMessage).proof
    const submission = {
      bootstrapCapability,
      challengeNonce: policy.payload.nonce,
      merchantPublicId,
      proof,
      productPublicId,
    }

    const results = await Promise.allSettled([
      publishVerifiedPolicy(client, submission),
      publishVerifiedPolicy(client, submission),
    ])
    const fulfilled = results.filter((result) => result.status === 'fulfilled')
    const rejected = results.filter((result) => result.status === 'rejected')
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(rejected[0]).toMatchObject({
      reason: { code: 'CHALLENGE_CONSUMED', name: 'PolicyPublishError' },
    })
  })

  it('server-issues an exact first-policy challenge only for the matching bootstrap', async () => {
    const merchantPublicId = 'hhhhhhhhhhhhhhhhhhhhhh'
    const productPublicId = 'iiiiiiiiiiiiiiiiiiiiii'
    const merchantId = await insertMerchant(merchantPublicId)
    const productId = await insertProduct(merchantId, productPublicId)
    const bootstrapCapability = 'D'.repeat(43)
    const bootstrapRows = await client<{ expires_at: Date; id: string }[]>`
      insert into merchant_bootstrap_sessions (merchant_id, capability_hash, expires_at)
      values (
        ${merchantId}, ${hashMerchantBootstrapCapability(bootstrapCapability)},
        now() + interval '4 minutes'
      )
      returning id, expires_at
    `
    const bootstrap = bootstrapRows[0]
    if (!bootstrap) throw new Error('Bootstrap fixture insert returned no row.')
    const formattedSettlementAddress = VALID_ADDRESS_B.match(/.{1,4}/gu)?.join(' ')
    if (!formattedSettlementAddress) throw new Error('Address fixture formatting failed.')
    const input = {
      bootstrapCapability,
      merchantPublicId,
      priceLuna: 700_000,
      productPublicId,
      returnWindowSeconds: 86_400,
      settlementAddress: formattedSettlementAddress,
      warrantyTransferAllowed: true,
      warrantyWindowSeconds: 2_592_000,
    }

    await expect(createPolicyChallenge(client, {
      ...input,
      bootstrapCapability: 'E'.repeat(43),
    })).rejects.toMatchObject({ code: 'BOOTSTRAP_MISMATCH', name: 'PolicyChallengeCreationError' })
    const failedAttemptRows = await client<{ count: number }[]>`
      select count(*)::integer as count from policy_versions where product_id = ${productId}
    `
    expect(failedAttemptRows[0]?.count).toBe(0)

    const created = await createPolicyChallenge(client, input)
    expect(created).toMatchObject({
      merchantId,
      payload: {
        merchantId: merchantPublicId,
        priceLuna: input.priceLuna,
        productId: productPublicId,
        settlementAddress: VALID_ADDRESS_B,
        version: 1,
      },
      productId,
    })
    expect(created.nonce).toMatch(/^[A-Za-z0-9_-]{22}$/u)
    expect(created.payload.policyId).toMatch(/^[A-Za-z0-9_-]{22}$/u)
    expect(created.canonicalMessage).toBe(buildPolicyMessage(created.payload))
    expect(created.payloadHash).toBe(hashProtocolPayload(created.canonicalMessage))
    expect(created.expiresAt.getTime()).toBeLessThanOrEqual(bootstrap.expires_at.getTime())

    const storedRows = await client<{
      bootstrap_session_id: string | null
      expected_signer_address: string | null
      payload: PolicyPayload
      verification_status: string
    }[]>`
      select
        signing_challenges.bootstrap_session_id,
        signing_challenges.expected_signer_address,
        policy_versions.payload,
        policy_versions.verification_status
      from signing_challenges
      join policy_versions on policy_versions.id = signing_challenges.policy_version_id
      where signing_challenges.nonce = ${created.nonce}
    `
    expect(storedRows[0]).toEqual({
      bootstrap_session_id: bootstrap.id,
      expected_signer_address: null,
      payload: created.payload,
      verification_status: 'pending',
    })
  })

  it('allocates monotonic policy versions under concurrent established-signer requests', async () => {
    const merchantPublicId = 'jjjjjjjjjjjjjjjjjjjjjj'
    const productPublicId = 'kkkkkkkkkkkkkkkkkkkkkk'
    const merchantId = await insertMerchant(merchantPublicId)
    const signerFixture = createPolicyProof(
      '808182838485868788898a8b8c8d8e8f909192939495969798999a9b9c9d9e9f',
      'challenge-allocator-signer',
    )
    await client`
      update merchants set policy_signer_address = ${signerFixture.address} where id = ${merchantId}
    `
    const productId = await insertProduct(merchantId, productPublicId)
    const input = {
      merchantPublicId,
      productPublicId,
      returnWindowSeconds: 604_800,
      settlementAddress: VALID_ADDRESS_B,
      warrantyTransferAllowed: false,
      warrantyWindowSeconds: 7_776_000,
    }

    const created = await Promise.all([
      createPolicyChallenge(client, { ...input, priceLuna: 800_000 }),
      createPolicyChallenge(client, { ...input, priceLuna: 900_000 }),
    ])
    expect(created.map((challenge) => challenge.payload.version).sort()).toEqual([1, 2])
    expect(new Set(created.map((challenge) => challenge.nonce))).toHaveProperty('size', 2)
    expect(new Set(created.map((challenge) => challenge.payload.policyId))).toHaveProperty('size', 2)

    const storedRows = await client<{
      expected_signer_address: string | null
      product_id: string
      version: number
    }[]>`
      select
        signing_challenges.expected_signer_address,
        policy_versions.product_id,
        policy_versions.version
      from policy_versions
      join signing_challenges on signing_challenges.policy_version_id = policy_versions.id
      where policy_versions.product_id = ${productId}
      order by policy_versions.version
    `
    expect(storedRows).toEqual([
      { expected_signer_address: signerFixture.address, product_id: productId, version: 1 },
      { expected_signer_address: signerFixture.address, product_id: productId, version: 2 },
    ])
  })

  it('lets the runtime role publish normally but denies direct evidence mutation', async () => {
    const merchantPublicId = 'pppppppppppppppppppppp'
    const productPublicId = 'qqqqqqqqqqqqqqqqqqqqqq'
    const merchantId = await insertMerchant(merchantPublicId)
    const signerFixture = createPolicyProof(
      'a0a1a2a3a4a5a6a7a8a9aaabacadaeafb0b1b2b3b4b5b6b7b8b9babbbcbdbebf',
      'runtime-role-signer',
    )
    await client`
      update merchants set policy_signer_address = ${signerFixture.address} where id = ${merchantId}
    `
    await insertProduct(merchantId, productPublicId)
    const challenge = await createPolicyChallenge(client, {
      merchantPublicId,
      priceLuna: 1_000_000,
      productPublicId,
      returnWindowSeconds: 604_800,
      settlementAddress: VALID_ADDRESS_B,
      warrantyTransferAllowed: false,
      warrantyWindowSeconds: 7_776_000,
    })
    const proof = createPolicyProof(
      'a0a1a2a3a4a5a6a7a8a9aaabacadaeafb0b1b2b3b4b5b6b7b8b9babbbcbdbebf',
      challenge.canonicalMessage,
    ).proof

    const runtime = postgres(requireSafeTestDatabaseUrl(), {
      connection: { options: '-c role=nimreturn_runtime' },
      max: 1,
    })
    try {
      await expect(publishVerifiedPolicy(runtime, {
        challengeNonce: challenge.nonce,
        merchantPublicId,
        proof,
        productPublicId,
      })).resolves.toMatchObject({
        actualSignerAddress: signerFixture.address,
        policyVersionId: challenge.policyVersionId,
      })

      await expect(runtime`
        update policy_versions
        set verifier_version = 'tampered'
        where id = ${challenge.policyVersionId}
      `).rejects.toThrow(/terminal policy version is immutable/u)
      await expect(runtime`
        update policy_versions set price_luna = 1 where id = ${challenge.policyVersionId}
      `).rejects.toThrow(/permission denied/u)
      await expect(runtime`
        delete from policy_versions where id = ${challenge.policyVersionId}
      `).rejects.toThrow(/permission denied/u)
      await expect(runtime`
        update protocol_events
        set event_type = 'policy.tampered'
        where aggregate_id = ${challenge.policyVersionId}
      `).rejects.toThrow(/permission denied/u)
      await expect(runtime`
        update merchants set policy_signer_address = ${VALID_ADDRESS_F} where id = ${merchantId}
      `).rejects.toThrow(/cannot be changed or cleared/u)
      await expect(runtime`
        insert into merchants (
          public_id, policy_signer_address, default_settlement_address, display_name
        ) values (
          'rrrrrrrrrrrrrrrrrrrrrr', ${VALID_ADDRESS_F}, ${VALID_ADDRESS_B}, 'Bypass'
        )
      `).rejects.toThrow(/new merchant must begin without a policy signer/u)

      const auditRows = await runtime<{ event_id: string }[]>`
        insert into protocol_events (
          aggregate_type, aggregate_id, event_type, protocol_version, occurred_at,
          correlation_id, evidence_type, payload
        ) values (
          'policy', ${challenge.policyVersionId}, 'policy.runtime-check', 'NR1', now(),
          gen_random_uuid(), 'backend', ${runtime.json({ check: 'least-privilege' })}
        )
        returning event_id
      `
      expect(auditRows[0]?.event_id).toMatch(/^[0-9a-f-]{36}$/u)
    } finally {
      await runtime.end()
    }
  })

  it('creates a normalized merchant/product draft while persisting only the bootstrap hash', async () => {
    const runtime = postgres(requireSafeTestDatabaseUrl(), {
      connection: { options: '-c role=nimreturn_runtime' },
      max: 1,
    })
    try {
      const formattedSettlementAddress = VALID_ADDRESS_B.match(/.{1,4}/gu)?.join(' ')
      if (!formattedSettlementAddress) throw new Error('Address fixture formatting failed.')
      const created = await createMerchantDraft(runtime, {
        defaultSettlementAddress: formattedSettlementAddress,
        description: '  Compact protection plan  ',
        displayName: '  Cafe\u0301 Store  ',
        productName: '  Travel Mouse  ',
      })

      expect(created).toMatchObject({
        displayName: 'Café Store',
        productName: 'Travel Mouse',
      })
      expect(created.merchantPublicId).toMatch(/^[A-Za-z0-9_-]{22}$/u)
      expect(created.productPublicId).toMatch(/^[A-Za-z0-9_-]{22}$/u)
      expect(created.bootstrapCapability).toMatch(/^[A-Za-z0-9_-]{43}$/u)

      const storedRows = await runtime<{
        capability_hash: string
        default_settlement_address: string
        description: string
        display_name: string
        expires_at: Date
        name: string
        policy_signer_address: string | null
      }[]>`
        select
          merchants.default_settlement_address,
          merchants.display_name,
          merchants.policy_signer_address,
          products.name,
          products.description,
          merchant_bootstrap_sessions.capability_hash,
          merchant_bootstrap_sessions.expires_at
        from merchants
        join products on products.merchant_id = merchants.id
        join merchant_bootstrap_sessions
          on merchant_bootstrap_sessions.merchant_id = merchants.id
        where merchants.public_id = ${created.merchantPublicId}
          and products.public_id = ${created.productPublicId}
      `
      expect(storedRows[0]).toMatchObject({
        capability_hash: hashMerchantBootstrapCapability(created.bootstrapCapability),
        default_settlement_address: VALID_ADDRESS_B,
        description: 'Compact protection plan',
        display_name: 'Café Store',
        name: 'Travel Mouse',
        policy_signer_address: null,
      })
      expect(storedRows[0]?.capability_hash).not.toBe(created.bootstrapCapability)
      expect(storedRows[0]?.expires_at).toEqual(created.bootstrapExpiresAt)

      const leakedRows = await runtime<{ count: number }[]>`
        select count(*)::integer as count
        from protocol_events
        where payload::text like ${`%${created.bootstrapCapability}%`}
      `
      expect(leakedRows[0]?.count).toBe(0)
    } finally {
      await runtime.end()
    }
  })

  it('rejects malformed merchant drafts before opening a persistence path', async () => {
    const merchantCountBefore = await client<{ count: number }[]>`
      select count(*)::integer as count from merchants
    `
    await expect(createMerchantDraft(client, {
      defaultSettlementAddress: VALID_ADDRESS_B,
      displayName: 'Unsafe\nStore',
      productName: 'Travel Mouse',
      surprise: true,
    })).rejects.toMatchObject({ code: 'INVALID_REQUEST', name: 'MerchantDraftCreationError' })
    const merchantCountAfter = await client<{ count: number }[]>`
      select count(*)::integer as count from merchants
    `
    expect(merchantCountAfter[0]?.count).toBe(merchantCountBefore[0]?.count)
  })

  it('exposes only an active policy after independently rechecking its stored proof', async () => {
    const runtime = postgres(requireSafeTestDatabaseUrl(), {
      connection: { options: '-c role=nimreturn_runtime' },
      max: 1,
    })
    try {
      const draft = await createMerchantDraft(runtime, {
        defaultSettlementAddress: VALID_ADDRESS_B,
        displayName: 'Verified Catalog Merchant',
        productName: 'Signed Policy Product',
      })
      const challenge = await createPolicyChallenge(runtime, {
        bootstrapCapability: draft.bootstrapCapability,
        merchantPublicId: draft.merchantPublicId,
        priceLuna: 1_250_000,
        productPublicId: draft.productPublicId,
        returnWindowSeconds: 604_800,
        settlementAddress: VALID_ADDRESS_B,
        warrantyTransferAllowed: false,
        warrantyWindowSeconds: 7_776_000,
      })
      await expect(getPublicVerifiedProduct(runtime, draft.productPublicId)).resolves.toBeNull()

      const signer = createPolicyProof(
        'c0c1c2c3c4c5c6c7c8c9cacbcccdcecfd0d1d2d3d4d5d6d7d8d9dadbdcdddedf',
        challenge.canonicalMessage,
      )
      await publishVerifiedPolicy(runtime, {
        bootstrapCapability: draft.bootstrapCapability,
        challengeNonce: challenge.nonce,
        merchantPublicId: draft.merchantPublicId,
        proof: signer.proof,
        productPublicId: draft.productPublicId,
      })

      const publicProduct = await getPublicVerifiedProduct(runtime, draft.productPublicId)
      expect(publicProduct?.merchant).toEqual({
        displayName: 'Verified Catalog Merchant',
        publicId: draft.merchantPublicId,
      })
      expect(publicProduct?.policy).toMatchObject({
        payload: challenge.payload,
        proof: signer.proof,
        publicId: challenge.payload.policyId,
        signerAddress: signer.address,
      })
      expect(publicProduct?.policy.verifiedAt).toBeInstanceOf(Date)
      expect(publicProduct?.product).toEqual({ publicId: draft.productPublicId })
      expect(publicProduct?.policy.payload.settlementAddress).not.toBe(signer.address)

      await client`alter table policy_versions disable trigger policy_versions_immutable`
      try {
        await client`
          update policy_versions
          set signature = ${'00'.repeat(64)}
          where id = ${challenge.policyVersionId}
        `
        await expect(getPublicVerifiedProduct(runtime, draft.productPublicId))
          .rejects.toMatchObject({
            code: 'EVIDENCE_INTEGRITY',
            name: 'PublicProductReadError',
          })
      } finally {
        await client`
          update policy_versions
          set signature = ${signer.proof.signature}
          where id = ${challenge.policyVersionId}
        `
        await client`alter table policy_versions enable trigger policy_versions_immutable`
      }

      await expect(getPublicVerifiedProduct(runtime, 'short')).rejects.toMatchObject({
        code: 'INVALID_REQUEST',
        name: 'PublicProductReadError',
      })
    } finally {
      await runtime.end()
    }
  })

  it('expires each stale policy once under concurrent bounded workers', async () => {
    const merchantPublicId = 'ssssssssssssssssssssss'
    const productPublicId = 'tttttttttttttttttttttt'
    const merchantId = await insertMerchant(merchantPublicId)
    const signer = createPolicyProof(
      'e0e1e2e3e4e5e6e7e8e9eaebecedeeeff0f1f2f3f4f5f6f7f8f9fafbfcfdfeff',
      'expiry-worker-signer',
    )
    await client`
      update merchants set policy_signer_address = ${signer.address} where id = ${merchantId}
    `
    const productId = await insertProduct(merchantId, productPublicId)
    const policy = await insertPolicy({
      merchantId,
      merchantPublicId,
      nonce: 'vvvvvvvvvvvvvvvvvvvvvv',
      policyPublicId: 'uuuuuuuuuuuuuuuuuuuuuu',
      productId,
      productPublicId,
    })
    await client`
      insert into signing_challenges (
        nonce, action, merchant_id, policy_version_id, expected_signer_address,
        canonical_message, payload_hash, created_at, expires_at
      ) values (
        ${policy.payload.nonce}, 'POLICY', ${merchantId}, ${policy.policyVersionId},
        ${signer.address}, ${policy.canonicalMessage}, ${policy.payloadHash},
        now() - interval '10 minutes', now() - interval '5 minutes'
      )
    `
    const proof = createPolicyProof(
      'e0e1e2e3e4e5e6e7e8e9eaebecedeeeff0f1f2f3f4f5f6f7f8f9fafbfcfdfeff',
      policy.canonicalMessage,
    ).proof
    const runtime = postgres(requireSafeTestDatabaseUrl(), {
      connection: { options: '-c role=nimreturn_runtime' },
      max: 4,
    })
    try {
      const results = await Promise.all([
        expireStalePolicyChallenges(runtime, { limit: 1 }),
        expireStalePolicyChallenges(runtime, { limit: 1 }),
      ])
      expect(results.sort()).toEqual([0, 1])
      await expect(expireStalePolicyChallenges(runtime, { limit: 1 })).resolves.toBe(0)

      const expiredRows = await runtime<{
        consumed_at: Date | null
        event_count: number
        verification_status: string
      }[]>`
        select
          policy_versions.verification_status,
          signing_challenges.consumed_at,
          count(protocol_events.id)::integer as event_count
        from policy_versions
        join signing_challenges on signing_challenges.policy_version_id = policy_versions.id
        left join protocol_events
          on protocol_events.aggregate_id = policy_versions.id
          and protocol_events.event_type = 'policy.expired'
        where policy_versions.id = ${policy.policyVersionId}
        group by policy_versions.verification_status, signing_challenges.consumed_at
      `
      expect(expiredRows[0]).toEqual({
        consumed_at: null,
        event_count: 1,
        verification_status: 'expired',
      })
      await expect(publishVerifiedPolicy(runtime, {
        challengeNonce: policy.payload.nonce,
        merchantPublicId,
        proof,
        productPublicId,
      })).rejects.toMatchObject({ code: 'CHALLENGE_EXPIRED', name: 'PolicyPublishError' })
      await expect(expireStalePolicyChallenges(runtime, { limit: 0 }))
        .rejects.toMatchObject({ code: 'INVALID_REQUEST', name: 'PolicyExpiryError' })
    } finally {
      await runtime.end()
    }
  })

  it('runs the production merchant API through v1 and v2 while preserving v1', async () => {
    const runtime = postgres(requireSafeTestDatabaseUrl(), {
      connection: { options: '-c role=nimreturn_runtime' },
      max: 2,
    })
    const apiConfig: ServerConfig = {
      HOST: '127.0.0.1',
      NIMIQ_NETWORK: 'TestAlbatross',
      NODE_ENV: 'test',
      PORT: 3001,
      SESSION_SECRET: 'phase-one-integration-session-secret-32-bytes',
    }
    const app = await buildApp(apiConfig, { database: runtime })
    try {
      const draftResponse = await app.inject({
        method: 'POST',
        payload: {
          defaultSettlementAddress: VALID_ADDRESS_B,
          description: 'A signed promise for one durable cup.',
          displayName: 'API Journey Merchant',
          productName: 'API Journey Cup',
        },
        url: '/api/v1/merchants',
      })
      expect(draftResponse.statusCode).toBe(201)
      const draft = draftResponse.json<{
        merchant: { publicId: string }
        product: { publicId: string }
      }>()
      const bootstrap = responseCookie(
        draftResponse.headers['set-cookie'],
        'nimreturn_merchant_bootstrap',
      )
      expect(draftResponse.body).not.toContain(bootstrap.value)

      const v1Terms = {
        priceLuna: 1_500_000,
        returnWindowSeconds: 604_800,
        settlementAddress: VALID_ADDRESS_B,
        warrantyTransferAllowed: false,
        warrantyWindowSeconds: 31_536_000,
      }
      const challengeUrl = `/api/v1/merchants/${draft.merchant.publicId}/products/${draft.product.publicId}/policies/challenges`
      const publishUrl = `/api/v1/merchants/${draft.merchant.publicId}/products/${draft.product.publicId}/policies/publish`
      const v1ChallengeResponse = await app.inject({
        cookies: { [bootstrap.name]: bootstrap.value },
        method: 'POST',
        payload: v1Terms,
        url: challengeUrl,
      })
      expect(v1ChallengeResponse.statusCode).toBe(201)
      const v1Challenge = v1ChallengeResponse.json<{
        canonicalMessage: string
        nonce: string
        payload: PolicyPayload
        payloadHash: string
      }>()
      expect(v1Challenge.payload.version).toBe(1)
      const signer = createPolicyProof(PRIVATE_KEY_POLICY_API_JOURNEY, v1Challenge.canonicalMessage)

      const wrongResourceResponse = await app.inject({
        cookies: { [bootstrap.name]: bootstrap.value },
        method: 'POST',
        payload: { challengeNonce: v1Challenge.nonce, proof: signer.proof },
        url: `/api/v1/merchants/${draft.merchant.publicId}/products/ZZZZZZZZZZZZZZZZZZZZZZ/policies/publish`,
      })
      expect(wrongResourceResponse.statusCode).toBe(404)

      const v1PublishResponse = await app.inject({
        cookies: { [bootstrap.name]: bootstrap.value },
        method: 'POST',
        payload: { challengeNonce: v1Challenge.nonce, proof: signer.proof },
        url: publishUrl,
      })
      expect(v1PublishResponse.statusCode).toBe(200)
      expect(v1PublishResponse.json()).toMatchObject({
        firstPolicyForMerchant: true,
        signerAddress: signer.address,
        verified: true,
      })
      const merchantSession = responseCookie(
        v1PublishResponse.headers['set-cookie'],
        'nimreturn_merchant_session',
      )

      const v1PublicResponse = await app.inject({
        method: 'GET',
        url: `/api/v1/products/${draft.product.publicId}`,
      })
      expect(v1PublicResponse.statusCode).toBe(200)
      expect(v1PublicResponse.json()).toMatchObject({
        policy: {
          payload: { priceLuna: v1Terms.priceLuna, version: 1 },
          proof: { payloadHash: v1Challenge.payloadHash },
          signerAddress: signer.address,
        },
        policyVersions: [{ active: true, payload: { version: 1 } }],
      })

      const staleBootstrapResponse = await app.inject({
        cookies: { [bootstrap.name]: bootstrap.value },
        method: 'POST',
        payload: { ...v1Terms, priceLuna: 1_750_000 },
        url: challengeUrl,
      })
      expect(staleBootstrapResponse.statusCode).toBe(401)

      const v2ChallengeResponse = await app.inject({
        cookies: { [merchantSession.name]: merchantSession.value },
        method: 'POST',
        payload: { ...v1Terms, priceLuna: 1_750_000, returnWindowSeconds: 1_209_600 },
        url: challengeUrl,
      })
      expect(v2ChallengeResponse.statusCode).toBe(201)
      const v2Challenge = v2ChallengeResponse.json<{
        canonicalMessage: string
        nonce: string
        payload: PolicyPayload
      }>()
      expect(v2Challenge.payload).toMatchObject({
        priceLuna: 1_750_000,
        returnWindowSeconds: 1_209_600,
        version: 2,
      })
      const v2Proof = createPolicyProof(PRIVATE_KEY_POLICY_API_JOURNEY, v2Challenge.canonicalMessage)
      const v2PublishResponse = await app.inject({
        cookies: { [merchantSession.name]: merchantSession.value },
        method: 'POST',
        payload: { challengeNonce: v2Challenge.nonce, proof: v2Proof.proof },
        url: publishUrl,
      })
      expect(v2PublishResponse.statusCode).toBe(200)
      expect(v2PublishResponse.json()).toMatchObject({
        firstPolicyForMerchant: false,
        signerAddress: signer.address,
        verified: true,
      })

      const versionRows = await runtime<{
        price_luna: string
        verification_status: string
        version: number
      }[]>`
        select policy_versions.version, policy_versions.price_luna::text,
          policy_versions.verification_status
        from policy_versions
        join products on products.id = policy_versions.product_id
        where products.public_id = ${draft.product.publicId}
        order by policy_versions.version
      `
      expect(versionRows).toEqual([
        { price_luna: '1500000', verification_status: 'verified', version: 1 },
        { price_luna: '1750000', verification_status: 'verified', version: 2 },
      ])

      const v2PublicResponse = await app.inject({
        method: 'GET',
        url: `/api/v1/products/${draft.product.publicId}`,
      })
      expect(v2PublicResponse.json()).toMatchObject({
        policy: { payload: { priceLuna: 1_750_000, version: 2 } },
        policyVersions: [
          { active: false, payload: { priceLuna: 1_500_000, version: 1 } },
          { active: true, payload: { priceLuna: 1_750_000, version: 2 } },
        ],
      })
    } finally {
      await app.close()
      await runtime.end()
    }
  })
})
