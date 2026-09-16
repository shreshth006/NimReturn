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
import { getPurchasePassport } from '../../server/domain/get-purchase-passport.js'
import { hashMerchantBootstrapCapability } from '../../server/domain/merchant-bootstrap.js'
import { publishVerifiedPolicy } from '../../server/domain/publish-policy.js'
import { createPurchaseOrder } from '../../server/domain/purchase-order.js'
import { recordPurchaseWalletState } from '../../server/domain/purchase-wallet-state.js'
import {
  createClaimChallenge,
  getClaim,
  submitClaimAuthorization,
  submitClaimProof,
} from '../../server/domain/claim-lifecycle.js'
import {
  createResolutionChallenge,
  getClaimResolution,
  listMerchantClaims,
  publishResolution,
} from '../../server/domain/resolution-lifecycle.js'
import {
  createRefundAttempt,
  getRefund,
  recordRefundWalletState,
} from '../../server/domain/refund-lifecycle.js'
import {
  recheckRefundTransaction,
  verifyRefundTransaction,
} from '../../server/domain/verify-refund.js'
import { getPromiseLedger } from '../../server/domain/get-promise-ledger.js'
import {
  createMerchantSessionChallenge,
  restoreMerchantSession,
} from '../../server/domain/merchant-session-recovery.js'
import {
  recheckPurchaseTransaction,
  verifyPurchaseTransaction,
} from '../../server/domain/verify-purchase.js'
import { hashProtocolPayload } from '../../src/lib/crypto/nimiq-signature.js'
import {
  buildClaimAuthorizationMessage,
  buildClaimMessage,
  type ClaimAuthorizationPayload,
  type ClaimPayload,
} from '../../src/lib/protocol/claim.js'
import { buildPolicyMessage, type PolicyPayload } from '../../src/lib/protocol/policy.js'
import {
  buildMerchantSessionMessage,
  type MerchantSessionPayload,
} from '../../src/lib/protocol/merchant-session.js'
import type { ObservedTransaction } from '../../src/lib/protocol/transaction-verification.js'

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
const PRIVATE_KEY_POLICY_PURCHASE = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff'
const PRIVATE_KEY_POLICY_PASSPORT = '111122223333444455556666777788889999aaaabbbbccccddddeeeeffff0000'
const PRIVATE_KEY_POLICY_FAILURE_MATRIX = '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
const PRIVATE_KEY_CLAIM_BUYER = '2122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f40'
const PRIVATE_KEY_CLAIM_DELEGATE = '3132333435363738393a3b3c3d3e3f404142434445464748494a4b4c4d4e4f50'
const PRIVATE_KEY_CLAIM_UNRELATED = '4142434445464748494a4b4c4d4e4f505152535455565758595a5b5c5d5e5f60'
const PRIVATE_KEY_POLICY_CLAIMS = '5152535455565758595a5b5c5d5e5f606162636465666768696a6b6c6d6e6f70'
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

  async function insertAgedSessionChallenge(input: {
    ageMs: number
    merchantId: string
    merchantPublicId: string
    nonce: string
    signerAddress: string
  }) {
    const databaseNow = (await client<{ now: Date }[]>`select clock_timestamp() as now`)[0]!.now
    const createdAt = new Date(databaseNow.getTime() - input.ageMs)
    const expiresAt = new Date(createdAt.getTime() + (5 * 60 * 1_000))
    const payload: MerchantSessionPayload = {
      audience: 'https://staging.example.test',
      createdAt: createdAt.getTime(),
      expiresAt: expiresAt.getTime(),
      merchantId: input.merchantPublicId,
      nonce: input.nonce,
      policySignerAddress: input.signerAddress,
      type: 'MERCHANT_SESSION',
      version: 1,
    }
    const canonicalMessage = buildMerchantSessionMessage(payload)
    await client`
      insert into merchant_session_challenges (
        nonce, merchant_id, expected_signer_address, audience, payload,
        canonical_message, payload_hash, expires_at, created_at
      ) values (
        ${input.nonce}, ${input.merchantId}, ${input.signerAddress}, ${payload.audience},
        ${client.json(payload)}, ${canonicalMessage}, ${hashProtocolPayload(canonicalMessage)},
        ${expiresAt}, ${createdAt}
      )
    `
    return canonicalMessage
  }

  it('rejects expired, cross-merchant, malformed, and altered merchant session proofs', async () => {
    const reauthenticationPrivateKey = 'ad'.repeat(32)
    const signer = createPolicyProof(reauthenticationPrivateKey, 'adversarial-reauth-signer')
    const merchantPublicId = 'ReauthAdversarialFix1A'
    const otherMerchantPublicId = 'ReauthAdversarialFix1B'
    const merchantId = await insertMerchant(merchantPublicId)
    const otherMerchantId = await insertMerchant(otherMerchantPublicId)
    const otherSigner = createPolicyProof('ae'.repeat(32), 'adversarial-reauth-other-signer')
    await client`
      update merchants set policy_signer_address = ${signer.address} where id = ${merchantId}
    `
    await client`
      update merchants set policy_signer_address = ${otherSigner.address} where id = ${otherMerchantId}
    `
    const merchantBefore = await client`select * from merchants where id = ${merchantId}`

    const expiredMessage = await insertAgedSessionChallenge({
      ageMs: 6 * 60 * 1_000,
      merchantId,
      merchantPublicId,
      nonce: 'ReauthExpiredNonce0001',
      signerAddress: signer.address,
    })
    await expect(restoreMerchantSession(client, {
      challengeNonce: 'ReauthExpiredNonce0001',
      merchantPublicId,
      proof: createPolicyProof(reauthenticationPrivateKey, expiredMessage).proof,
    })).rejects.toMatchObject({ code: 'CHALLENGE_EXPIRED' })

    await insertAgedSessionChallenge({
      ageMs: (4 * 60 * 1_000) + 30_000,
      merchantId,
      merchantPublicId,
      nonce: 'ReauthNearExpiryNonce1',
      signerAddress: signer.address,
    })
    const fresh = await createMerchantSessionChallenge(client, {
      audience: 'https://staging.example.test',
      merchantPublicId,
    })
    expect(fresh.nonce).not.toBe('ReauthNearExpiryNonce1')
    expect(fresh.expiresAt.getTime() - fresh.payload.createdAt).toBe(5 * 60 * 1_000)

    const validProof = createPolicyProof(reauthenticationPrivateKey, fresh.canonicalMessage).proof
    await expect(restoreMerchantSession(client, {
      challengeNonce: fresh.nonce,
      merchantPublicId: otherMerchantPublicId,
      proof: validProof,
    })).rejects.toMatchObject({ code: 'MERCHANT_NOT_FOUND' })
    await expect(restoreMerchantSession(client, {
      challengeNonce: fresh.nonce,
      merchantPublicId,
      proof: { publicKey: validProof.publicKey },
    })).rejects.toMatchObject({ code: 'INVALID_PROOF' })
    const alteredMessage = fresh.canonicalMessage.replace(merchantPublicId, otherMerchantPublicId)
    await expect(restoreMerchantSession(client, {
      challengeNonce: fresh.nonce,
      merchantPublicId,
      proof: createPolicyProof(reauthenticationPrivateKey, alteredMessage).proof,
    })).rejects.toMatchObject({ code: 'MESSAGE_MISMATCH' })
    await expect(restoreMerchantSession(client, {
      challengeNonce: fresh.nonce,
      merchantPublicId,
      proof: { ...validProof, payloadHash: hashProtocolPayload(alteredMessage) },
    })).rejects.toMatchObject({ code: 'PAYLOAD_HASH_MISMATCH' })

    const rejectedAttempts = await client<{ consumed_at: Date | null }[]>`
      select consumed_at from merchant_session_challenges where nonce = ${fresh.nonce}
    `
    expect(rejectedAttempts[0]?.consumed_at).toBeNull()

    await expect(restoreMerchantSession(client, {
      challengeNonce: fresh.nonce,
      merchantPublicId,
      proof: validProof,
    })).resolves.toMatchObject({ merchantPublicId, signerAddress: signer.address })
    expect(await client`select * from merchants where id = ${merchantId}`).toEqual(merchantBefore)
  })

  it('restores only an established active merchant through a one-time signer-bound challenge', async () => {
    const merchantPublicId = 'ReauthMerchantFixture1'
    const merchantId = await insertMerchant(merchantPublicId)
    const reauthenticationPrivateKey = 'ac'.repeat(32)
    const establishedSigner = createPolicyProof(
      reauthenticationPrivateKey,
      'merchant-session-recovery-signer',
    )
    await client`
      update merchants
      set policy_signer_address = ${establishedSigner.address}
      where id = ${merchantId}
    `

    const runtime = postgres(requireSafeTestDatabaseUrl(), {
      connection: { options: '-c role=nimreturn_runtime' },
      max: 2,
    })
    try {
      const first = await createMerchantSessionChallenge(runtime, {
        audience: 'https://staging.example.test',
        merchantPublicId,
      })
      const repeated = await createMerchantSessionChallenge(runtime, {
        audience: 'https://staging.example.test',
        merchantPublicId,
      })
      expect(repeated).toEqual(first)
      expect(first.payload).toMatchObject({
        audience: 'https://staging.example.test',
        merchantId: merchantPublicId,
        nonce: first.nonce,
        policySignerAddress: establishedSigner.address,
        type: 'MERCHANT_SESSION',
        version: 1,
      })
      expect(first.expiresAt.getTime() - first.payload.createdAt).toBe(5 * 60 * 1_000)

      const wrongProof = createPolicyProof(
        PRIVATE_KEY_POLICY_CONCURRENT,
        first.canonicalMessage,
      ).proof
      await expect(restoreMerchantSession(runtime, {
        challengeNonce: first.nonce,
        merchantPublicId,
        proof: wrongProof,
      })).rejects.toMatchObject({ code: 'SIGNER_MISMATCH' })

      const proof = createPolicyProof(reauthenticationPrivateKey, first.canonicalMessage).proof
      const restores = await Promise.allSettled([
        restoreMerchantSession(runtime, {
          challengeNonce: first.nonce,
          merchantPublicId,
          proof,
        }),
        restoreMerchantSession(runtime, {
          challengeNonce: first.nonce,
          merchantPublicId,
          proof,
        }),
      ])
      const successfulRestores = restores.filter((result) => result.status === 'fulfilled')
      const rejectedRestores = restores.filter((result) => result.status === 'rejected')
      expect(successfulRestores).toHaveLength(1)
      expect(rejectedRestores).toHaveLength(1)
      expect(successfulRestores[0]).toMatchObject({
        value: {
          merchantId,
          merchantPublicId,
          signerAddress: establishedSigner.address,
        },
      })
      expect(rejectedRestores[0]).toMatchObject({
        reason: { code: 'CHALLENGE_CONSUMED' },
      })
      await expect(restoreMerchantSession(runtime, {
        challengeNonce: first.nonce,
        merchantPublicId,
        proof,
      })).rejects.toMatchObject({ code: 'CHALLENGE_CONSUMED' })

      const privileges = await runtime<{
        can_delete: boolean
        can_insert: boolean
        can_select: boolean
        can_update_any: boolean
        can_update_canonical: boolean
        can_update_consumed: boolean
      }[]>`
        select
          has_table_privilege(current_user, 'merchant_session_challenges', 'SELECT') as can_select,
          has_table_privilege(current_user, 'merchant_session_challenges', 'INSERT') as can_insert,
          has_table_privilege(current_user, 'merchant_session_challenges', 'UPDATE') as can_update_any,
          has_table_privilege(current_user, 'merchant_session_challenges', 'DELETE') as can_delete,
          has_column_privilege(current_user, 'merchant_session_challenges', 'consumed_at', 'UPDATE') as can_update_consumed,
          has_column_privilege(current_user, 'merchant_session_challenges', 'canonical_message', 'UPDATE') as can_update_canonical
      `
      expect(privileges[0]).toEqual({
        can_delete: false,
        can_insert: true,
        can_select: true,
        can_update_any: false,
        can_update_canonical: false,
        can_update_consumed: true,
      })
      await expect(runtime`
        update merchant_session_challenges
        set canonical_message = 'tampered'
        where nonce = ${first.nonce}
      `).rejects.toThrow(/permission denied/u)
      await expect(runtime`
        delete from merchant_session_challenges where nonce = ${first.nonce}
      `).rejects.toThrow(/permission denied/u)
      await expect(client`
        delete from merchant_session_challenges where nonce = ${first.nonce}
      `).rejects.toThrow(/challenge evidence is immutable/u)
    } finally {
      await runtime.end()
    }

    const unsignedMerchantId = await insertMerchant('ReauthUnsignedFixture1')
    await expect(createMerchantSessionChallenge(client, {
      audience: 'https://staging.example.test',
      merchantPublicId: 'ReauthUnsignedFixture1',
    })).rejects.toMatchObject({ code: 'MERCHANT_STATE_CONFLICT' })
    expect(unsignedMerchantId).toBeTruthy()

    const disabledMerchantId = await insertMerchant('ReauthDisabledFixture1')
    const disabledSigner = createPolicyProof('ab'.repeat(32), 'disabled-merchant-signer')
    await client`
      update merchants
      set policy_signer_address = ${disabledSigner.address}, status = 'disabled'
      where id = ${disabledMerchantId}
    `
    await expect(createMerchantSessionChallenge(client, {
      audience: 'https://staging.example.test',
      merchantPublicId: 'ReauthDisabledFixture1',
    })).rejects.toMatchObject({ code: 'MERCHANT_STATE_CONFLICT' })
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
      expect(publicProduct?.product).toEqual({ description: '', publicId: draft.productPublicId })
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

  it('freezes an order to the verified active policy and enforces replay-safe purchase tables', async () => {
    const draft = await createMerchantDraft(client, {
      defaultSettlementAddress: VALID_ADDRESS_F,
      description: 'Immutable order snapshot',
      displayName: 'Purchase Foundation Merchant',
      productName: 'Purchase Foundation Product',
    })
    const v1Terms = {
      bootstrapCapability: draft.bootstrapCapability,
      merchantPublicId: draft.merchantPublicId,
      priceLuna: 2_500_000,
      productPublicId: draft.productPublicId,
      returnWindowSeconds: 604_800,
      settlementAddress: VALID_ADDRESS_F,
      warrantyTransferAllowed: false,
      warrantyWindowSeconds: 7_776_000,
    }
    const v1Challenge = await createPolicyChallenge(client, v1Terms)
    const signer = createPolicyProof(PRIVATE_KEY_POLICY_PURCHASE, v1Challenge.canonicalMessage)
    await publishVerifiedPolicy(client, {
      bootstrapCapability: draft.bootstrapCapability,
      challengeNonce: v1Challenge.nonce,
      merchantPublicId: draft.merchantPublicId,
      productPublicId: draft.productPublicId,
      proof: signer.proof,
    })

    const runtime = postgres(requireSafeTestDatabaseUrl(), {
      connection: { options: '-c role=nimreturn_runtime' },
      max: 2,
    })
    try {
      const v1Order = await createPurchaseOrder(runtime, {
        network: 'TestAlbatross',
        productPublicId: draft.productPublicId,
      })
      expect(v1Order).toMatchObject({
        buyerAddress: null,
        expectedPayment: {
          data: `NR1:P:${v1Order.publicId}`,
          network: 'TestAlbatross',
          recipient: VALID_ADDRESS_F,
          valueLuna: 2_500_000,
        },
        paymentState: 'payment_requested',
        policy: { payloadHash: v1Challenge.payloadHash, version: 1 },
      })

      const v2Challenge = await createPolicyChallenge(client, {
        ...v1Terms,
        bootstrapCapability: undefined,
        priceLuna: 3_000_000,
        returnWindowSeconds: 1_209_600,
      })
      await publishVerifiedPolicy(client, {
        challengeNonce: v2Challenge.nonce,
        merchantPublicId: draft.merchantPublicId,
        productPublicId: draft.productPublicId,
        proof: createPolicyProof(PRIVATE_KEY_POLICY_PURCHASE, v2Challenge.canonicalMessage).proof,
      })
      const v2Order = await createPurchaseOrder(runtime, {
        network: 'TestAlbatross',
        productPublicId: draft.productPublicId,
      })
      expect(v2Order).toMatchObject({
        expectedPayment: { valueLuna: 3_000_000 },
        policy: { payloadHash: v2Challenge.payloadHash, version: 2 },
      })

      const rows = await runtime<{
        id: string
        policy_payload_hash: string
        policy_version: number
        value_luna: string
      }[]>`
        select id, policy_payload_hash, policy_version, expected_value_luna::text as value_luna
        from orders where public_id in (${v1Order.publicId}, ${v2Order.publicId})
        order by policy_version
      `
      expect(rows.map((row) => ({
        policy_payload_hash: row.policy_payload_hash,
        policy_version: row.policy_version,
        value_luna: row.value_luna,
      }))).toEqual([
        {
          policy_payload_hash: v1Challenge.payloadHash,
          policy_version: 1,
          value_luna: '2500000',
        },
        {
          policy_payload_hash: v2Challenge.payloadHash,
          policy_version: 2,
          value_luna: '3000000',
        },
      ])
      const firstOrder = rows[0]
      const secondOrder = rows[1]
      if (!firstOrder || !secondOrder) throw new Error('Expected two order fixtures.')

      await expect(runtime`
        update orders set expected_value_luna = 1 where id = ${firstOrder.id}
      `).rejects.toThrow(/permission denied|order payment expectations are immutable/u)
      await expect(runtime`
        update orders set payment_state = 'purchased', buyer_address = ${VALID_ADDRESS_A}
        where id = ${firstOrder.id}
      `).rejects.toThrow(/illegal order payment transition/u)

      const transactionHash = 'de'.repeat(32)
      await runtime`
        insert into chain_transactions (
          network, transaction_hash, purpose, resource_id, observed_state,
          provider_id, observed_at, verification_reason, verifier_version
        ) values (
          'TestAlbatross', ${transactionHash}, 'purchase', ${firstOrder.id}, 'inconclusive',
          'fixture-rpc', now(), 'Fixture is intentionally inconclusive.', 'nr1-test'
        )
      `
      await expect(runtime`
        insert into chain_transactions (
          network, transaction_hash, purpose, resource_id, observed_state,
          provider_id, observed_at, verification_reason, verifier_version
        ) values (
          'TestAlbatross', ${transactionHash}, 'purchase', ${secondOrder.id}, 'inconclusive',
          'fixture-rpc', now(), 'Fixture is intentionally inconclusive.', 'nr1-test'
        )
      `).rejects.toThrow(/chain_transactions_network_hash_unique/u)
      await expect(runtime`
        insert into chain_transactions (
          network, transaction_hash, purpose, resource_id, observed_state,
          provider_id, observed_at, verification_reason, verifier_version
        ) values (
          'TestAlbatross', ${'ef'.repeat(32)}, 'purchase', ${firstOrder.id}, 'inconclusive',
          'fixture-rpc', now(), 'Fixture is intentionally inconclusive.', 'nr1-test'
        )
      `).rejects.toThrow(/chain_transactions_purpose_resource_unique/u)
    } finally {
      await runtime.end()
    }
  })

  it('independently verifies purchase finality, derives the buyer, and issues one immutable Passport', async () => {
    const draft = await createMerchantDraft(client, {
      defaultSettlementAddress: VALID_ADDRESS_E,
      description: 'Phase 2 verification fixture',
      displayName: 'Passport Merchant',
      productName: 'Passport Product',
    })
    const challenge = await createPolicyChallenge(client, {
      bootstrapCapability: draft.bootstrapCapability,
      merchantPublicId: draft.merchantPublicId,
      priceLuna: 42_000,
      productPublicId: draft.productPublicId,
      returnWindowSeconds: 86_400,
      settlementAddress: VALID_ADDRESS_E,
      warrantyTransferAllowed: true,
      warrantyWindowSeconds: 2_592_000,
    })
    await publishVerifiedPolicy(client, {
      bootstrapCapability: draft.bootstrapCapability,
      challengeNonce: challenge.nonce,
      merchantPublicId: draft.merchantPublicId,
      productPublicId: draft.productPublicId,
      proof: createPolicyProof(PRIVATE_KEY_POLICY_PASSPORT, challenge.canonicalMessage).proof,
    })

    const runtime = postgres(requireSafeTestDatabaseUrl(), {
      connection: { options: '-c role=nimreturn_runtime' },
      max: 4,
    })
    const finalizedAt = Date.parse('2026-09-15T11:15:00.000Z')
    const finalized = (
      order: Awaited<ReturnType<typeof createPurchaseOrder>>,
      hash: string,
      overrides: Partial<ObservedTransaction> = {},
    ): ObservedTransaction => ({
      blockNumber: 1_234,
      blockTimestamp: finalizedAt,
      confirmations: 8,
      data: order.expectedPayment.data,
      executionResult: true,
      finality: {
        finalizingBlockNumber: 1_240,
        headBlockNumber: 1_242,
        reached: true,
      },
      hash,
      network: order.expectedPayment.network,
      recipient: order.expectedPayment.recipient,
      sender: VALID_ADDRESS_A,
      state: 'finalized',
      valueLuna: order.expectedPayment.valueLuna,
      ...overrides,
    })
    try {
      const order = await createPurchaseOrder(runtime, {
        network: 'TestAlbatross',
        productPublicId: draft.productPublicId,
      })
      await expect(recordPurchaseWalletState(runtime, {
        event: 'wallet-request-started',
        orderPublicId: order.publicId,
      })).resolves.toMatchObject({ paymentState: 'wallet_request_started' })
      await expect(recordPurchaseWalletState(runtime, {
        event: 'wallet-cancelled',
        orderPublicId: order.publicId,
      })).resolves.toMatchObject({ paymentState: 'payment_cancelled' })
      await expect(recordPurchaseWalletState(runtime, {
        event: 'wallet-request-started',
        orderPublicId: order.publicId,
      })).resolves.toMatchObject({ paymentState: 'wallet_request_started' })

      const hash = '10'.repeat(32)
      const reader = { getTransaction: () => Promise.resolve(finalized(order, hash)) }
      const concurrent = await Promise.all([
        verifyPurchaseTransaction(runtime, reader, { hash, orderPublicId: order.publicId }),
        verifyPurchaseTransaction(runtime, reader, { hash, orderPublicId: order.publicId }),
      ])
      const purchased = concurrent[0]
      if (!purchased) throw new Error('Expected concurrent purchase verification result.')
      expect(concurrent[1]?.passport).toEqual(purchased.passport)
      expect(purchased).toMatchObject({
        buyerAddress: VALID_ADDRESS_A,
        paymentState: 'purchased',
        transaction: {
          blockTimestamp: finalizedAt,
          executionResult: true,
          hash,
          observedState: 'finalized',
          sender: VALID_ADDRESS_A,
        },
      })
      expect(purchased.passport?.publicId).toMatch(/^[A-Za-z0-9_-]{22}$/u)

      const repeated = await verifyPurchaseTransaction(runtime, {
        getTransaction: () => Promise.reject(new Error('idempotent replay must not need RPC')),
      }, { hash, orderPublicId: order.publicId })
      expect(repeated).toEqual(purchased)
      const reconciled = await recheckPurchaseTransaction(runtime, reader, order.publicId)
      expect(reconciled.transaction?.reconciliation).toMatchObject({ outcome: 'confirmed' })

      const passportId = purchased.passport?.publicId
      if (!passportId) throw new Error('Expected a Passport after finalized verification.')
      const passport = await getPurchasePassport(runtime, passportId)
      expect(passport).toMatchObject({
        merchant: { settlementAddress: VALID_ADDRESS_E },
        orderPublicId: order.publicId,
        payment: {
          buyerAddress: VALID_ADDRESS_A,
          data: order.expectedPayment.data,
          executionResult: true,
          finality: { status: 'verified' },
          transactionHash: hash,
          valueLuna: 42_000,
        },
        policy: { payloadHash: challenge.payloadHash, version: 1 },
        product: { description: 'Phase 2 verification fixture' },
        protocol: 'NR1',
        publicId: passportId,
        reconciliation: { status: 'confirmed' },
        status: 'active',
      })
      expect(passport?.payment.purchaseTime.getTime()).toBe(finalizedAt)
      expect(passport?.deadlines.return?.getTime()).toBe(finalizedAt + 86_400_000)
      await expect(runtime`
        update purchase_passports set product_name = 'Tampered' where public_id = ${passportId}
      `).rejects.toThrow(/permission denied|purchase passport evidence is immutable/u)

      const regression = await recheckPurchaseTransaction(runtime, {
        getTransaction: () => Promise.resolve(finalized(order, hash, {
          finality: { finalizingBlockNumber: 1_240, headBlockNumber: 1_236, reached: false },
          state: 'included',
        })),
      }, order.publicId)
      expect(regression.transaction?.reconciliation).toMatchObject({ outcome: 'exception' })
      await expect(getPurchasePassport(runtime, passportId)).resolves.toMatchObject({
        reconciliation: { status: 'exception' },
        status: 'verification_exception',
      })
      await expect(runtime`
        update chain_reconciliations set outcome = 'confirmed'
        where chain_transaction_id = (
          select id from chain_transactions where transaction_hash = ${hash}
        )
      `).rejects.toThrow(/permission denied|chain reconciliation evidence is append-only/u)

      await recheckPurchaseTransaction(runtime, reader, order.publicId)
      await expect(getPurchasePassport(runtime, passportId)).resolves.toMatchObject({
        reconciliation: { status: 'confirmed' },
        status: 'active',
      })

      const duplicateOrder = await createPurchaseOrder(runtime, {
        network: 'TestAlbatross',
        productPublicId: draft.productPublicId,
      })
      await expect(verifyPurchaseTransaction(runtime, reader, {
        hash,
        orderPublicId: duplicateOrder.publicId,
      })).rejects.toMatchObject({ code: 'STATE_CONFLICT', name: 'PurchaseOrderError' })
    } finally {
      await runtime.end()
    }
  })

  it('fails closed for ambiguous, non-final, mismatched, and unsuccessful purchase evidence', async () => {
    const draft = await createMerchantDraft(client, {
      defaultSettlementAddress: VALID_ADDRESS_D,
      displayName: 'Failure Matrix Merchant',
      productName: 'Failure Matrix Product',
    })
    const challenge = await createPolicyChallenge(client, {
      bootstrapCapability: draft.bootstrapCapability,
      merchantPublicId: draft.merchantPublicId,
      priceLuna: 77_000,
      productPublicId: draft.productPublicId,
      returnWindowSeconds: 0,
      settlementAddress: VALID_ADDRESS_D,
      warrantyTransferAllowed: false,
      warrantyWindowSeconds: 0,
    })
    await publishVerifiedPolicy(client, {
      bootstrapCapability: draft.bootstrapCapability,
      challengeNonce: challenge.nonce,
      merchantPublicId: draft.merchantPublicId,
      productPublicId: draft.productPublicId,
      proof: createPolicyProof(PRIVATE_KEY_POLICY_FAILURE_MATRIX, challenge.canonicalMessage).proof,
    })

    const runtime = postgres(requireSafeTestDatabaseUrl(), {
      connection: { options: '-c role=nimreturn_runtime' },
      max: 3,
    })
    const makeOrder = () => createPurchaseOrder(runtime, {
      network: 'TestAlbatross',
      productPublicId: draft.productPublicId,
    })
    const observed = (
      order: Awaited<ReturnType<typeof createPurchaseOrder>>,
      hash: string,
      overrides: Partial<ObservedTransaction> = {},
    ): ObservedTransaction => ({
      blockNumber: 2_000,
      blockTimestamp: Date.parse('2026-09-15T12:00:00.000Z'),
      data: order.expectedPayment.data,
      executionResult: true,
      finality: { finalizingBlockNumber: 2_010, headBlockNumber: 2_011, reached: true },
      hash,
      network: order.expectedPayment.network,
      recipient: order.expectedPayment.recipient,
      sender: VALID_ADDRESS_B,
      state: 'finalized',
      valueLuna: order.expectedPayment.valueLuna,
      ...overrides,
    })
    try {
      const ambiguous = await makeOrder()
      await recordPurchaseWalletState(runtime, {
        event: 'wallet-request-started',
        orderPublicId: ambiguous.publicId,
      })
      await expect(recordPurchaseWalletState(runtime, {
        event: 'submission-outcome-unknown',
        orderPublicId: ambiguous.publicId,
      })).resolves.toMatchObject({ paymentState: 'submission_outcome_unknown' })
      await expect(recordPurchaseWalletState(runtime, {
        event: 'wallet-request-started',
        orderPublicId: ambiguous.publicId,
      })).rejects.toMatchObject({ code: 'STATE_CONFLICT' })

      const absentHash = '20'.repeat(32)
      const absent = await verifyPurchaseTransaction(runtime, {
        getTransaction: () => Promise.resolve(null),
      }, { hash: absentHash, orderPublicId: ambiguous.publicId })
      expect(absent).toMatchObject({
        paymentState: 'payment_pending',
        passport: null,
        transaction: { observedState: 'absent' },
      })
      const rpcUnavailable = await recheckPurchaseTransaction(runtime, {
        getTransaction: () => Promise.reject(new Error('timeout')),
      }, ambiguous.publicId)
      expect(rpcUnavailable).toMatchObject({
        paymentState: 'payment_pending',
        passport: null,
        transaction: { observedState: 'inconclusive' },
      })
      const included = await recheckPurchaseTransaction(runtime, {
        getTransaction: () => Promise.resolve(observed(ambiguous, absentHash, {
          finality: { finalizingBlockNumber: 2_010, headBlockNumber: 2_005, reached: false },
          state: 'included',
        })),
      }, ambiguous.publicId)
      expect(included).toMatchObject({
        paymentState: 'payment_pending',
        passport: null,
        transaction: { observedState: 'included' },
      })

      const mismatches: Array<Partial<ObservedTransaction>> = [
        { network: 'MainAlbatross' },
        { recipient: VALID_ADDRESS_C },
        { valueLuna: 77_001 },
        { data: 'NR1:P:wrong-binding' },
        { executionResult: false },
      ]
      for (const [index, mismatch] of mismatches.entries()) {
        const order = await makeOrder()
        const hash = (64 + index).toString(16).padStart(2, '0').repeat(32)
        const result = await verifyPurchaseTransaction(runtime, {
          getTransaction: () => Promise.resolve(observed(order, hash, mismatch)),
        }, { hash, orderPublicId: order.publicId })
        expect(result).toMatchObject({
          buyerAddress: null,
          paymentState: 'payment_failed',
          passport: null,
          transaction: { observedState: 'invalid' },
        })
      }
    } finally {
      await runtime.end()
    }
  })

  it('enforces authorized claim acceptance and append-only eligibility evidence', async () => {
    const passportRows = await client<{
      id: string
      merchant_id: string
      order_id: string
      order_public_id: string
      original_buyer_address: string
      policy_version_id: string
    }[]>`
      select
        purchase_passports.id,
        purchase_passports.merchant_id,
        purchase_passports.order_id,
        orders.public_id as order_public_id,
        purchase_passports.original_buyer_address,
        purchase_passports.policy_version_id
      from purchase_passports
      join orders on orders.id = purchase_passports.order_id
      order by purchase_passports.created_at desc
      limit 1
    `
    const passport = passportRows[0]
    if (!passport) throw new Error('Claim schema test requires the verified Passport fixture.')

    const claimTime = Date.parse('2026-09-15T13:00:00.000Z')
    const payload: ClaimPayload = {
      claimId: 'ClaimSchemaFixture0001',
      claimType: 'RETURN',
      createdAt: claimTime,
      nonce: 'ClaimNonceFixture00001',
      note: 'Item is defective',
      orderId: passport.order_public_id,
      protocol: 'NR1',
      purchaseSenderAddress: passport.original_buyer_address,
      reasonCode: 'DEFECTIVE',
      type: 'CLAIM',
    }
    const canonicalMessage = buildClaimMessage(payload)
    const claimHash = hashProtocolPayload(canonicalMessage)
    const rows = await client<{ id: string }[]>`
      insert into claims (
        public_id, passport_id, order_id, policy_version_id, merchant_id,
        purchase_sender_address, claim_type, reason_code, note, claim_time,
        challenge_nonce, payload, canonical_message, payload_hash, expires_at
      ) values (
        ${payload.claimId}, ${passport.id}, ${passport.order_id}, ${passport.policy_version_id},
        ${passport.merchant_id}, ${passport.original_buyer_address}, ${payload.claimType},
        ${payload.reasonCode}, ${payload.note}, to_timestamp(${claimTime} / 1000.0),
        ${payload.nonce}, ${client.json(payload)}, ${canonicalMessage}, ${claimHash},
        now() + interval '10 minutes'
      ) returning id
    `
    const claimId = rows[0]?.id
    if (!claimId) throw new Error('Claim fixture insert returned no row.')

    await expect(client`
      update claims set
        claim_signer_address = ${passport.original_buyer_address},
        public_key = ${'ab'.repeat(32)}, signature = ${'cd'.repeat(64)},
        verifier_version = 'integration-test', signature_status = 'verified',
        workflow_state = 'eligible', verified_at = now()
      where id = ${claimId}
    `).rejects.toThrow(/matching authorization and eligibility/u)

    await client`
      update claims set
        claim_signer_address = ${passport.original_buyer_address},
        public_key = ${'ab'.repeat(32)}, signature = ${'cd'.repeat(64)},
        verifier_version = 'integration-test', signature_status = 'verified',
        workflow_state = 'authorization_pending', verified_at = now()
      where id = ${claimId}
    `
    await expect(client`
      insert into claim_eligibility_evaluations (
        claim_id, evaluator_version, evaluated_at, inputs, rule_results, eligible
      ) values (
        ${claimId}, 'nr1-claim-eligibility-v1', now(), ${client.json({})},
        ${client.json({ authorizationVerified: true })}, true
      )
    `).rejects.toThrow(/completed claimant authorization/u)

    const authorizationRows = await client<{ id: string }[]>`
      insert into claim_authorizations (
        public_id, claim_id, authorization_mode, purchase_sender_address,
        claim_signer_address, claim_payload_hash, consumed_at, verified_at
      ) values (
        'SelfAuthFixture0000001', ${claimId}, 'self', ${passport.original_buyer_address},
        ${passport.original_buyer_address}, ${claimHash}, now(), now()
      ) returning id
    `
    const authorizationId = authorizationRows[0]?.id
    if (!authorizationId) throw new Error('Self-authorization fixture insert returned no row.')
    await client`
      insert into claim_eligibility_evaluations (
        claim_id, evaluator_version, evaluated_at, inputs, rule_results, eligible
      ) values (
        ${claimId}, 'nr1-claim-eligibility-v1', now(),
        ${client.json({ claimType: 'RETURN' })},
        ${client.json({ authorizationVerified: true, withinInclusiveDeadline: true })}, true
      )
    `
    await client`update claims set workflow_state = 'eligible' where id = ${claimId}`

    await expect(client`
      update claims set signature = ${'ef'.repeat(64)} where id = ${claimId}
    `).rejects.toThrow(/verified claim proof is immutable/u)
    await expect(client`
      update claim_authorizations set verified_at = now() where id = ${authorizationId}
    `).rejects.toThrow(/completed claim authorization is immutable/u)
    await expect(client`
      update claim_eligibility_evaluations set eligible = false where claim_id = ${claimId}
    `).rejects.toThrow(/append-only/u)
    await expect(client`
      insert into claims (
        public_id, passport_id, order_id, policy_version_id, merchant_id,
        purchase_sender_address, claim_type, reason_code, note, claim_time,
        challenge_nonce, payload, canonical_message, payload_hash, expires_at
      ) values (
        'ClaimSchemaFixture0002', ${passport.id}, ${passport.order_id},
        ${passport.policy_version_id}, ${passport.merchant_id},
        ${passport.original_buyer_address}, 'RETURN', 'OTHER', '', now(),
        'ClaimNonceFixture00002', ${client.json({ ...payload, claimId: 'ClaimSchemaFixture0002' })},
        ${canonicalMessage}, ${claimHash}, now() + interval '10 minutes'
      )
    `).rejects.toThrow(/claims_one_active_type_per_passport/u)
  })

  it('requires delegated authorization evidence to preserve both signer roles', async () => {
    const claimRows = await client<{
      id: string
      merchant_id: string
      order_id: string
      order_public_id: string
      passport_id: string
      policy_version_id: string
      purchase_sender_address: string
    }[]>`
      select
        claims.id, claims.merchant_id, claims.order_id, orders.public_id as order_public_id,
        claims.passport_id, claims.policy_version_id, claims.purchase_sender_address
      from claims join orders on orders.id = claims.order_id
      where claims.public_id = 'ClaimSchemaFixture0001'
    `
    const source = claimRows[0]
    if (!source) throw new Error('Delegated schema test requires the self-authorized fixture.')
    const claimTime = Date.parse('2026-09-15T13:05:00.000Z')
    const claimPayload: ClaimPayload = {
      claimId: 'ClaimSchemaFixture0003',
      claimType: 'WARRANTY',
      createdAt: claimTime,
      nonce: 'ClaimNonceFixture00003',
      note: '',
      orderId: source.order_public_id,
      protocol: 'NR1',
      purchaseSenderAddress: source.purchase_sender_address,
      reasonCode: 'DEFECTIVE',
      type: 'CLAIM',
    }
    const claimMessage = buildClaimMessage(claimPayload)
    const claimHash = hashProtocolPayload(claimMessage)
    const insertedClaims = await client<{ id: string }[]>`
      insert into claims (
        public_id, passport_id, order_id, policy_version_id, merchant_id,
        purchase_sender_address, claim_type, reason_code, note, claim_time,
        challenge_nonce, payload, canonical_message, payload_hash, expires_at
      ) values (
        ${claimPayload.claimId}, ${source.passport_id}, ${source.order_id},
        ${source.policy_version_id}, ${source.merchant_id}, ${source.purchase_sender_address},
        ${claimPayload.claimType}, ${claimPayload.reasonCode}, '',
        to_timestamp(${claimTime} / 1000.0), ${claimPayload.nonce},
        ${client.json(claimPayload)}, ${claimMessage}, ${claimHash}, now() + interval '10 minutes'
      ) returning id
    `
    const claimId = insertedClaims[0]?.id
    if (!claimId) throw new Error('Delegated claim fixture insert returned no row.')
    await client`
      update claims set
        claim_signer_address = ${VALID_ADDRESS_C}, public_key = ${'12'.repeat(32)},
        signature = ${'34'.repeat(64)}, verifier_version = 'integration-test',
        signature_status = 'verified', workflow_state = 'authorization_pending', verified_at = now()
      where id = ${claimId}
    `

    const createdAt = claimTime + 1_000
    const authorizationPayload: ClaimAuthorizationPayload = {
      authorizationId: 'DelegAuthFixture000001',
      claimId: claimPayload.claimId,
      claimPayloadHash: claimHash,
      claimSignerAddress: VALID_ADDRESS_C,
      createdAt,
      expiresAt: createdAt + 600_000,
      nonce: 'DelegNonceFixture00001',
      protocol: 'NR1',
      purchaseSenderAddress: source.purchase_sender_address,
      type: 'CLAIM_AUTHORIZATION',
    }
    const authorizationMessage = buildClaimAuthorizationMessage(authorizationPayload)
    const authorizationHash = hashProtocolPayload(authorizationMessage)
    const authorizations = await client<{ id: string }[]>`
      insert into claim_authorizations (
        public_id, claim_id, authorization_mode, purchase_sender_address,
        claim_signer_address, claim_payload_hash, challenge_nonce, payload,
        canonical_message, payload_hash, expires_at, created_at
      ) values (
        ${authorizationPayload.authorizationId}, ${claimId}, 'delegated',
        ${source.purchase_sender_address}, ${VALID_ADDRESS_C}, ${claimHash},
        ${authorizationPayload.nonce}, ${client.json(authorizationPayload)},
        ${authorizationMessage}, ${authorizationHash},
        to_timestamp(${authorizationPayload.expiresAt} / 1000.0),
        to_timestamp(${authorizationPayload.createdAt} / 1000.0)
      ) returning id
    `
    const authorizationId = authorizations[0]?.id
    if (!authorizationId) throw new Error('Delegated authorization fixture insert returned no row.')
    await expect(client`
      update claim_authorizations set
        public_key = ${'56'.repeat(32)}, signature = ${'78'.repeat(64)},
        authorization_signer_address = ${VALID_ADDRESS_D}, verifier_version = 'integration-test',
        consumed_at = now(), verified_at = now()
      where id = ${authorizationId}
    `).rejects.toThrow(/delegated_proof_complete/u)
    await client`
      update claim_authorizations set
        public_key = ${'56'.repeat(32)}, signature = ${'78'.repeat(64)},
        authorization_signer_address = ${source.purchase_sender_address},
        verifier_version = 'integration-test', consumed_at = now(), verified_at = now()
      where id = ${authorizationId}
    `
    await client`
      insert into claim_eligibility_evaluations (
        claim_id, evaluator_version, evaluated_at, inputs, rule_results, eligible
      ) values (
        ${claimId}, 'nr1-claim-eligibility-v1', now(), ${client.json({})},
        ${client.json({ authorizationVerified: true })}, false
      )
    `
    await client`update claims set workflow_state = 'ineligible' where id = ${claimId}`
    const stored = await client<{
      authorization_signer_address: string
      claim_signer_address: string
      purchase_sender_address: string
      workflow_state: string
    }[]>`
      select
        claim_authorizations.authorization_signer_address,
        claims.claim_signer_address,
        claims.purchase_sender_address,
        claims.workflow_state
      from claims
      join claim_authorizations on claim_authorizations.claim_id = claims.id
      where claims.id = ${claimId}
    `
    expect(stored[0]).toEqual({
      authorization_signer_address: source.purchase_sender_address,
      claim_signer_address: VALID_ADDRESS_C,
      purchase_sender_address: source.purchase_sender_address,
      workflow_state: 'ineligible',
    })
  })

  it('accepts self and exact delegated claim authorization while rejecting an unrelated signer', async () => {
    const runtime = postgres(requireSafeTestDatabaseUrl(), {
      connection: { options: '-c role=nimreturn_runtime' },
      max: 3,
    })
    try {
      const draft = await createMerchantDraft(runtime, {
        defaultSettlementAddress: VALID_ADDRESS_D,
        displayName: 'Claims Journey Merchant',
        productName: 'Claims Journey Product',
      })
      const policyChallenge = await createPolicyChallenge(runtime, {
        bootstrapCapability: draft.bootstrapCapability,
        merchantPublicId: draft.merchantPublicId,
        priceLuna: 55_000,
        productPublicId: draft.productPublicId,
        returnWindowSeconds: 604_800,
        settlementAddress: VALID_ADDRESS_D,
        warrantyTransferAllowed: false,
        warrantyWindowSeconds: 7_776_000,
      })
      await publishVerifiedPolicy(runtime, {
        bootstrapCapability: draft.bootstrapCapability,
        challengeNonce: policyChallenge.nonce,
        merchantPublicId: draft.merchantPublicId,
        productPublicId: draft.productPublicId,
        proof: createPolicyProof(PRIVATE_KEY_POLICY_CLAIMS, policyChallenge.canonicalMessage).proof,
      })
      const order = await createPurchaseOrder(runtime, {
        network: 'TestAlbatross',
        productPublicId: draft.productPublicId,
      })
      const buyer = createPolicyProof(PRIVATE_KEY_CLAIM_BUYER, 'derive-address-only')
      const purchaseHash = '91'.repeat(32)
      const purchaseTime = Date.now() - 60_000
      const observed: ObservedTransaction = {
        blockNumber: 3_000,
        blockTimestamp: purchaseTime,
        data: order.expectedPayment.data,
        executionResult: true,
        finality: { finalizingBlockNumber: 3_010, headBlockNumber: 3_011, reached: true },
        hash: purchaseHash,
        network: order.expectedPayment.network,
        recipient: order.expectedPayment.recipient,
        sender: buyer.address,
        state: 'finalized',
        valueLuna: order.expectedPayment.valueLuna,
      }
      const purchased = await verifyPurchaseTransaction(runtime, {
        getTransaction: () => Promise.resolve(observed),
      }, { hash: purchaseHash, orderPublicId: order.publicId })
      const passportPublicId = purchased.passport?.publicId
      if (!passportPublicId) throw new Error('Claim journey requires a verified Passport.')

      const selfChallenge = await createClaimChallenge(runtime, {
        claimType: 'RETURN',
        note: '  Defective on arrival  ',
        passportPublicId,
        reasonCode: 'DEFECTIVE',
      })
      const selfProof = createPolicyProof(PRIVATE_KEY_CLAIM_BUYER, selfChallenge.challenge.canonicalMessage).proof
      const selfClaim = await submitClaimProof(runtime, {
        claimPublicId: selfChallenge.publicId,
        proof: selfProof,
      })
      expect(selfClaim).toMatchObject({
        authorization: { mode: 'self', status: 'verified' },
        claimSignerAddress: buyer.address,
        eligibility: { eligible: true },
        purchaseSenderAddress: buyer.address,
        workflowState: 'eligible',
      })
      await expect(submitClaimProof(runtime, {
        claimPublicId: selfChallenge.publicId,
        proof: selfProof,
      })).resolves.toMatchObject({ publicId: selfChallenge.publicId, workflowState: 'eligible' })

      const delegatedChallenge = await createClaimChallenge(runtime, {
        claimType: 'WARRANTY',
        note: '',
        passportPublicId,
        reasonCode: 'DEFECTIVE',
      })
      const delegate = createPolicyProof(
        PRIVATE_KEY_CLAIM_DELEGATE,
        delegatedChallenge.challenge.canonicalMessage,
      )
      const pending = await submitClaimProof(runtime, {
        claimPublicId: delegatedChallenge.publicId,
        proof: delegate.proof,
      })
      expect(pending).toMatchObject({
        authorization: {
          mode: 'delegated',
          requiredSignerAddress: buyer.address,
          status: 'pending',
        },
        claimSignerAddress: delegate.address,
        eligibility: null,
        workflowState: 'authorization_pending',
      })
      const authorization = pending.authorization
      if (!authorization?.canonicalMessage) throw new Error('Expected a delegated authorization challenge.')
      const unrelatedProof = createPolicyProof(
        PRIVATE_KEY_CLAIM_UNRELATED,
        authorization.canonicalMessage,
      ).proof
      await expect(submitClaimAuthorization(runtime, {
        authorizationPublicId: authorization.publicId,
        claimPublicId: pending.publicId,
        proof: unrelatedProof,
      })).rejects.toMatchObject({ code: 'SIGNER_MISMATCH', name: 'ClaimLifecycleError' })
      await expect(getClaim(runtime, pending.publicId)).resolves.toMatchObject({
        eligibility: null,
        workflowState: 'authorization_pending',
      })

      const buyerAuthorizationProof = createPolicyProof(
        PRIVATE_KEY_CLAIM_BUYER,
        authorization.canonicalMessage,
      ).proof
      const delegated = await submitClaimAuthorization(runtime, {
        authorizationPublicId: authorization.publicId,
        claimPublicId: pending.publicId,
        proof: buyerAuthorizationProof,
      })
      expect(delegated).toMatchObject({
        authorization: { mode: 'delegated', status: 'verified' },
        claimSignerAddress: delegate.address,
        eligibility: { eligible: true },
        purchaseSenderAddress: buyer.address,
        workflowState: 'eligible',
      })
      await expect(submitClaimAuthorization(runtime, {
        authorizationPublicId: authorization.publicId,
        claimPublicId: pending.publicId,
        proof: buyerAuthorizationProof,
      })).resolves.toMatchObject({ workflowState: 'eligible' })
      await expect(submitClaimAuthorization(runtime, {
        authorizationPublicId: authorization.publicId,
        claimPublicId: pending.publicId,
        proof: unrelatedProof,
      })).rejects.toMatchObject({ code: 'STATE_CONFLICT' })

      await expect(listMerchantClaims(runtime, draft.merchantPublicId)).resolves.toHaveLength(2)
      const approval = await createResolutionChallenge(runtime, {
        claimPublicId: selfClaim.publicId,
        decision: 'APPROVED',
        merchantPublicId: draft.merchantPublicId,
        note: 'Approved under the signed return terms',
        reasonCode: 'POLICY_ACCEPTED',
      })
      expect(approval).toMatchObject({
        approvedRefundLuna: order.expectedPayment.valueLuna,
        decision: 'APPROVED',
        status: 'pending',
      })
      const wrongMerchantProof = createPolicyProof(
        PRIVATE_KEY_CLAIM_BUYER,
        approval.canonicalMessage,
      ).proof
      await expect(publishResolution(runtime, {
        claimPublicId: selfClaim.publicId,
        merchantPublicId: draft.merchantPublicId,
        proof: wrongMerchantProof,
        resolutionPublicId: approval.publicId,
      })).rejects.toMatchObject({ code: 'SIGNER_MISMATCH', name: 'ResolutionLifecycleError' })
      const policyProof = createPolicyProof(
        PRIVATE_KEY_POLICY_CLAIMS,
        approval.canonicalMessage,
      ).proof
      const approved = await publishResolution(runtime, {
        claimPublicId: selfClaim.publicId,
        merchantPublicId: draft.merchantPublicId,
        proof: policyProof,
        resolutionPublicId: approval.publicId,
      })
      expect(approved).toMatchObject({
        approvedRefundLuna: order.expectedPayment.valueLuna,
        decision: 'APPROVED',
        status: 'verified',
      })
      await expect(publishResolution(runtime, {
        claimPublicId: selfClaim.publicId,
        merchantPublicId: draft.merchantPublicId,
        proof: policyProof,
        resolutionPublicId: approval.publicId,
      })).resolves.toMatchObject({ status: 'verified' })
      await expect(createResolutionChallenge(runtime, {
        claimPublicId: selfClaim.publicId,
        decision: 'REJECTED',
        merchantPublicId: draft.merchantPublicId,
        note: 'Conflicting decision',
        reasonCode: 'POLICY_NOT_APPLICABLE',
      })).rejects.toMatchObject({ code: 'STATE_CONFLICT' })
      await expect(getClaimResolution(runtime, selfClaim.publicId)).resolves.toMatchObject({
        policySignerAddress: createPolicyProof(PRIVATE_KEY_POLICY_CLAIMS, 'derive').address,
        status: 'verified',
      })

      const firstRefundAttempt = await createRefundAttempt(runtime, {
        claimPublicId: selfClaim.publicId,
        merchantPublicId: draft.merchantPublicId,
        network: 'TestAlbatross',
      })
      expect(firstRefundAttempt).toMatchObject({
        attempt: {
          expectedPayment: {
            data: `NR1:R:${selfClaim.publicId}`,
            network: 'TestAlbatross',
            recipient: buyer.address,
            sender: VALID_ADDRESS_D,
            valueLuna: order.expectedPayment.valueLuna,
          },
          state: 'payment_requested',
        },
        refund: null,
      })
      const firstAttemptId = firstRefundAttempt.attempt?.publicId
      if (!firstAttemptId) throw new Error('Refund attempt was not created.')
      await expect(createRefundAttempt(runtime, {
        claimPublicId: selfClaim.publicId,
        merchantPublicId: draft.merchantPublicId,
        network: 'TestAlbatross',
      })).resolves.toMatchObject({ attempt: { publicId: firstAttemptId } })
      await recordRefundWalletState(runtime, {
        attemptPublicId: firstAttemptId,
        claimPublicId: selfClaim.publicId,
        event: 'wallet-request-started',
        merchantPublicId: draft.merchantPublicId,
      })
      await expect(recordRefundWalletState(runtime, {
        attemptPublicId: firstAttemptId,
        claimPublicId: selfClaim.publicId,
        event: 'wallet-cancelled',
        merchantPublicId: draft.merchantPublicId,
      })).resolves.toMatchObject({ attempt: { state: 'payment_cancelled' }, refund: null })

      const secondRefundAttempt = await createRefundAttempt(runtime, {
        claimPublicId: selfClaim.publicId,
        merchantPublicId: draft.merchantPublicId,
        network: 'TestAlbatross',
      })
      const secondAttemptId = secondRefundAttempt.attempt?.publicId
      if (!secondAttemptId || secondAttemptId === firstAttemptId) throw new Error('A fresh refund attempt was not created.')
      await recordRefundWalletState(runtime, {
        attemptPublicId: secondAttemptId,
        claimPublicId: selfClaim.publicId,
        event: 'wallet-request-started',
        merchantPublicId: draft.merchantPublicId,
      })
      const wrongSenderHash = '92'.repeat(32)
      const wrongSenderRefund: ObservedTransaction = {
        blockNumber: 3_020,
        blockTimestamp: purchaseTime + 120_000,
        data: `NR1:R:${selfClaim.publicId}`,
        executionResult: true,
        finality: { finalizingBlockNumber: 3_030, headBlockNumber: 3_031, reached: true },
        hash: wrongSenderHash,
        network: 'TestAlbatross',
        recipient: buyer.address,
        sender: buyer.address,
        state: 'finalized',
        valueLuna: order.expectedPayment.valueLuna,
      }
      await expect(verifyRefundTransaction(runtime, {
        getTransaction: () => Promise.resolve(wrongSenderRefund),
      }, {
        attemptPublicId: secondAttemptId,
        claimPublicId: selfClaim.publicId,
        hash: wrongSenderHash,
        merchantPublicId: draft.merchantPublicId,
      })).resolves.toMatchObject({ attempt: { state: 'payment_failed' }, refund: null })

      const finalRefundAttempt = await createRefundAttempt(runtime, {
        claimPublicId: selfClaim.publicId,
        merchantPublicId: draft.merchantPublicId,
        network: 'TestAlbatross',
      })
      const finalAttemptId = finalRefundAttempt.attempt?.publicId
      if (!finalAttemptId || [firstAttemptId, secondAttemptId].includes(finalAttemptId)) throw new Error('A final refund attempt was not created.')
      await recordRefundWalletState(runtime, {
        attemptPublicId: finalAttemptId,
        claimPublicId: selfClaim.publicId,
        event: 'wallet-request-started',
        merchantPublicId: draft.merchantPublicId,
      })
      const refundHash = '93'.repeat(32)
      const validRefund: ObservedTransaction = {
        ...wrongSenderRefund,
        hash: refundHash,
        sender: VALID_ADDRESS_D,
      }
      const refundInput = {
        attemptPublicId: finalAttemptId,
        claimPublicId: selfClaim.publicId,
        hash: refundHash,
        merchantPublicId: draft.merchantPublicId,
      }
      const [firstRefund, repeatedRefund] = await Promise.all([
        verifyRefundTransaction(runtime, { getTransaction: () => Promise.resolve(validRefund) }, refundInput),
        verifyRefundTransaction(runtime, { getTransaction: () => Promise.resolve(validRefund) }, refundInput),
      ])
      expect(firstRefund).toMatchObject({
        attempt: { state: 'refunded', transaction: { observedState: 'finalized', sender: VALID_ADDRESS_D } },
      })
      expect(firstRefund.refund?.verifiedAt).toBeInstanceOf(Date)
      expect(repeatedRefund).toEqual(firstRefund)
      await expect(recheckRefundTransaction(runtime, {
        getTransaction: () => Promise.resolve(validRefund),
      }, {
        attemptPublicId: finalAttemptId,
        claimPublicId: selfClaim.publicId,
        merchantPublicId: draft.merchantPublicId,
      })).resolves.toMatchObject({ attempt: { transaction: { reconciliation: { outcome: 'confirmed' } } } })
      const storedRefund = await getRefund(runtime, selfClaim.publicId)
      expect(storedRefund).toMatchObject({ attempt: { state: 'refunded' } })
      expect(storedRefund?.refund?.verifiedAt).toBeInstanceOf(Date)
      await expect(getPurchasePassport(runtime, passportPublicId)).resolves.toMatchObject({ status: 'refunded' })
      await expect(runtime`update refund_transactions set verified_at = clock_timestamp()`).rejects.toThrow()
      await expect(runtime`delete from refund_attempts`).rejects.toThrow()

      const rejection = await createResolutionChallenge(runtime, {
        claimPublicId: delegated.publicId,
        decision: 'REJECTED',
        merchantPublicId: draft.merchantPublicId,
        note: 'Outside the signed warranty terms',
        reasonCode: 'POLICY_NOT_APPLICABLE',
      })
      expect(rejection.approvedRefundLuna).toBe(0)
      const rejectionProof = createPolicyProof(
        PRIVATE_KEY_POLICY_CLAIMS,
        rejection.canonicalMessage,
      ).proof
      const [firstResolution, repeatedResolution] = await Promise.all([
        publishResolution(runtime, {
          claimPublicId: delegated.publicId,
          merchantPublicId: draft.merchantPublicId,
          proof: rejectionProof,
          resolutionPublicId: rejection.publicId,
        }),
        publishResolution(runtime, {
          claimPublicId: delegated.publicId,
          merchantPublicId: draft.merchantPublicId,
          proof: rejectionProof,
          resolutionPublicId: rejection.publicId,
        }),
      ])
      expect(firstResolution).toMatchObject({ decision: 'REJECTED', status: 'verified' })
      expect(repeatedResolution).toEqual(firstResolution)
      const queue = await listMerchantClaims(runtime, draft.merchantPublicId)
      expect(queue.map((item) => item.claim.workflowState).sort()).toEqual(['approved', 'rejected'])

      async function createVerifiedPassport(blockTimestamp: number, hashByte: string) {
        const nextOrder = await createPurchaseOrder(runtime, {
          network: 'TestAlbatross',
          productPublicId: draft.productPublicId,
        })
        const nextHash = hashByte.repeat(32)
        const nextObserved: ObservedTransaction = {
          blockNumber: 4_000 + Number.parseInt(hashByte, 16),
          blockTimestamp,
          data: nextOrder.expectedPayment.data,
          executionResult: true,
          finality: {
            finalizingBlockNumber: 5_000 + Number.parseInt(hashByte, 16),
            headBlockNumber: 6_000 + Number.parseInt(hashByte, 16),
            reached: true,
          },
          hash: nextHash,
          network: nextOrder.expectedPayment.network,
          recipient: nextOrder.expectedPayment.recipient,
          sender: buyer.address,
          state: 'finalized',
          valueLuna: nextOrder.expectedPayment.valueLuna,
        }
        const verifiedOrder = await verifyPurchaseTransaction(runtime, {
          getTransaction: () => Promise.resolve(nextObserved),
        }, { hash: nextHash, orderPublicId: nextOrder.publicId })
        const nextPassportId = verifiedOrder.passport?.publicId
        if (!nextPassportId) throw new Error('Promise Ledger fixture requires a verified Passport.')
        return nextPassportId
      }

      const pendingRefundPassport = await createVerifiedPassport(Date.now() - 120_000, '94')
      const pendingRefundChallenge = await createClaimChallenge(runtime, {
        claimType: 'RETURN',
        note: '',
        passportPublicId: pendingRefundPassport,
        reasonCode: 'CHANGED_MIND',
      })
      const pendingRefundClaim = await submitClaimProof(runtime, {
        claimPublicId: pendingRefundChallenge.publicId,
        proof: createPolicyProof(
          PRIVATE_KEY_CLAIM_BUYER,
          pendingRefundChallenge.challenge.canonicalMessage,
        ).proof,
      })
      expect(pendingRefundClaim.eligibility?.eligible).toBe(true)
      const pendingRefundResolution = await createResolutionChallenge(runtime, {
        claimPublicId: pendingRefundClaim.publicId,
        decision: 'APPROVED',
        merchantPublicId: draft.merchantPublicId,
        note: 'Approved; direct refund is still pending',
        reasonCode: 'POLICY_ACCEPTED',
      })
      await publishResolution(runtime, {
        claimPublicId: pendingRefundClaim.publicId,
        merchantPublicId: draft.merchantPublicId,
        proof: createPolicyProof(
          PRIVATE_KEY_POLICY_CLAIMS,
          pendingRefundResolution.canonicalMessage,
        ).proof,
        resolutionPublicId: pendingRefundResolution.publicId,
      })

      const unresolvedPassport = await createVerifiedPassport(
        Date.now() - (8 * 24 * 60 * 60 * 1_000),
        '95',
      )
      const unresolvedChallenge = await createClaimChallenge(runtime, {
        claimType: 'RETURN',
        note: '',
        passportPublicId: unresolvedPassport,
        reasonCode: 'OTHER',
      })
      const unresolvedClaim = await submitClaimProof(runtime, {
        claimPublicId: unresolvedChallenge.publicId,
        proof: createPolicyProof(
          PRIVATE_KEY_CLAIM_BUYER,
          unresolvedChallenge.challenge.canonicalMessage,
        ).proof,
      })
      expect(unresolvedClaim).toMatchObject({
        eligibility: { eligible: false },
        workflowState: 'ineligible',
      })

      const ledger = await getPromiseLedger(runtime, draft.merchantPublicId)
      expect(ledger).toMatchObject({
        definitionsVersion: 'promise-ledger-v1',
        merchant: {
          displayName: 'Claims Journey Merchant',
          policySignerAddress: createPolicyProof(PRIVATE_KEY_POLICY_CLAIMS, 'derive').address,
          publicId: draft.merchantPublicId,
        },
        metrics: {
          approvedClaims: { sampleSize: 3, value: 2 },
          claimsFiled: { sampleSize: 3, value: 4 },
          eligibleClaims: { sampleSize: 4, value: 3 },
          evidenceExceptions: { sampleSize: 4, value: 0 },
          ineligibleClaims: { sampleSize: 4, value: 1 },
          medianResolutionTime: { sampleSize: 3, unit: 'milliseconds' },
          refundPending: { sampleSize: 2, value: 1 },
          rejectedClaims: { sampleSize: 3, value: 1 },
          unresolvedCases: { sampleSize: 4, value: 1 },
          verifiedPurchases: { sampleSize: 3, value: 3 },
          verifiedRefunds: { sampleSize: 2, value: 1 },
        },
        products: [{
          name: 'Claims Journey Product',
          policySignerAddress: createPolicyProof(PRIVATE_KEY_POLICY_CLAIMS, 'derive').address,
          publicId: draft.productPublicId,
          settlementAddress: VALID_ADDRESS_D,
        }],
      })
      expect(ledger?.asOf).toBeInstanceOf(Date)
      expect(ledger?.metrics.medianResolutionTime.value).toEqual(expect.any(Number))
      expect(Object.values(ledger?.metrics ?? {}).every((metric) => metric.definition.length > 20)).toBe(true)

      const resolutionTimes = await runtime<{
        accepted_at: Date
        verified_at: Date
      }[]>`
        select authorizations.verified_at as accepted_at, resolutions.verified_at
        from claim_resolutions resolutions
        join claim_authorizations authorizations on authorizations.claim_id = resolutions.claim_id
        where resolutions.merchant_id = (
          select id from merchants where public_id = ${draft.merchantPublicId}
        )
          and resolutions.verification_status = 'verified'
          and authorizations.consumed_at is not null
        order by resolutions.verified_at
      `
      const expectedMedian = resolutionTimes
        .map((row) => row.verified_at.getTime() - row.accepted_at.getTime())
        .sort((left, right) => left - right)[1]
      expect(ledger?.metrics.medianResolutionTime.value).toBe(expectedMedian)

      const refundChains = await runtime<{ id: string }[]>`
        select chain.id
        from chain_transactions chain
        join refund_transactions refunds on refunds.chain_transaction_id = chain.id
        join purchase_passports passports on passports.id = refunds.passport_id
        where passports.merchant_id = (
          select id from merchants where public_id = ${draft.merchantPublicId}
        )
      `
      const refundChainId = refundChains[0]?.id
      if (!refundChainId) throw new Error('Promise Ledger exception fixture requires a refund chain record.')
      await runtime`
        insert into chain_reconciliations (
          chain_transaction_id, outcome, reason, verifier_version, checked_at
        ) values (
          ${refundChainId}, 'exception', 'Synthetic regression detected by integration test.',
          'integration-test', clock_timestamp() + interval '1 second'
        )
      `
      await expect(getPromiseLedger(runtime, draft.merchantPublicId)).resolves.toMatchObject({
        metrics: { evidenceExceptions: { value: 1 } },
      })
      await runtime`
        insert into chain_reconciliations (
          chain_transaction_id, outcome, reason, verifier_version, checked_at
        ) values (
          ${refundChainId}, 'confirmed', 'Synthetic evidence confirmed by integration test.',
          'integration-test', clock_timestamp() + interval '2 seconds'
        )
      `
      await expect(getPromiseLedger(runtime, draft.merchantPublicId)).resolves.toMatchObject({
        metrics: { evidenceExceptions: { value: 0 } },
      })

      const privileges = await runtime<{
        can_delete: boolean
        can_insert: boolean
        can_select: boolean
        can_update: boolean
      }[]>`
        select
          has_table_privilege(current_user, 'promise_ledger_v1', 'SELECT') as can_select,
          has_table_privilege(current_user, 'promise_ledger_v1', 'INSERT') as can_insert,
          has_table_privilege(current_user, 'promise_ledger_v1', 'UPDATE') as can_update,
          has_table_privilege(current_user, 'promise_ledger_v1', 'DELETE') as can_delete
      `
      expect(privileges[0]).toEqual({
        can_delete: false,
        can_insert: false,
        can_select: true,
        can_update: false,
      })
      await expect(runtime`
        update promise_ledger_v1 set verified_purchases = 99
        where merchant_public_id = ${draft.merchantPublicId}
      `).rejects.toThrow()
    } finally {
      await runtime.end()
    }
  })
})
