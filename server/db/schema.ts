import { sql } from 'drizzle-orm'
import type { PolicyPayload } from '../../src/lib/protocol/policy.js'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import {
  bigint,
  bigserial,
  boolean,
  char,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'

export const merchantStatus = pgEnum('merchant_status', ['active', 'disabled'])
export const productStatus = pgEnum('product_status', ['draft', 'active', 'archived'])
export const policyVerificationStatus = pgEnum('policy_verification_status', [
  'pending',
  'verified',
  'invalid',
  'expired',
])
export const signingChallengeAction = pgEnum('signing_challenge_action', ['POLICY'])
export const evidenceType = pgEnum('evidence_type', ['signature', 'chain', 'backend'])

export const merchants = pgTable('merchants', {
  id: uuid('id').defaultRandom().primaryKey(),
  publicId: char('public_id', { length: 22 }).notNull(),
  policySignerAddress: varchar('policy_signer_address', { length: 36 }),
  defaultSettlementAddress: varchar('default_settlement_address', { length: 36 }).notNull(),
  displayName: varchar('display_name', { length: 80 }).notNull(),
  status: merchantStatus('status').default('active').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique('merchants_public_id_unique').on(table.publicId),
  uniqueIndex('merchants_policy_signer_address_unique')
    .on(table.policySignerAddress)
    .where(sql`${table.policySignerAddress} is not null`),
  index('merchants_status_created_at_index').on(table.status, table.createdAt),
  check('merchants_public_id_format', sql`${table.publicId} ~ '^[A-Za-z0-9_-]{22}$'`),
  check(
    'merchants_policy_signer_address_format',
    sql`${table.policySignerAddress} is null or ${table.policySignerAddress} ~ '^NQ[0-9A-HJ-NP-VXY]{34}$'`,
  ),
  check(
    'merchants_default_settlement_address_format',
    sql`${table.defaultSettlementAddress} ~ '^NQ[0-9A-HJ-NP-VXY]{34}$'`,
  ),
  check('merchants_display_name_not_blank', sql`btrim(${table.displayName}) <> ''`),
])

export const merchantBootstrapSessions = pgTable('merchant_bootstrap_sessions', {
  id: uuid('id').defaultRandom().primaryKey(),
  merchantId: uuid('merchant_id')
    .notNull()
    .references(() => merchants.id, { onDelete: 'cascade' }),
  capabilityHash: char('capability_hash', { length: 64 }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique('merchant_bootstrap_sessions_capability_hash_unique').on(table.capabilityHash),
  unique('merchant_bootstrap_sessions_id_merchant_unique').on(table.id, table.merchantId),
  uniqueIndex('merchant_bootstrap_sessions_one_unconsumed_per_merchant')
    .on(table.merchantId)
    .where(sql`${table.consumedAt} is null`),
  index('merchant_bootstrap_sessions_expires_at_index').on(table.expiresAt),
  check(
    'merchant_bootstrap_sessions_capability_hash_format',
    sql`${table.capabilityHash} ~ '^[0-9a-f]{64}$'`,
  ),
  check(
    'merchant_bootstrap_sessions_valid_times',
    sql`${table.expiresAt} > ${table.createdAt} and (${table.consumedAt} is null or (${table.consumedAt} >= ${table.createdAt} and ${table.consumedAt} <= ${table.expiresAt}))`,
  ),
])

export const products = pgTable('products', {
  id: uuid('id').defaultRandom().primaryKey(),
  publicId: char('public_id', { length: 22 }).notNull(),
  merchantId: uuid('merchant_id')
    .notNull()
    .references(() => merchants.id, { onDelete: 'restrict' }),
  name: varchar('name', { length: 100 }).notNull(),
  description: varchar('description', { length: 500 }).default('').notNull(),
  status: productStatus('status').default('draft').notNull(),
  activePolicyVersionId: uuid('active_policy_version_id')
    .references((): AnyPgColumn => policyVersions.id, { onDelete: 'restrict' }),
  rowVersion: integer('row_version').default(1).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique('products_public_id_unique').on(table.publicId),
  unique('products_id_merchant_unique').on(table.id, table.merchantId),
  index('products_merchant_status_index').on(table.merchantId, table.status),
  check('products_public_id_format', sql`${table.publicId} ~ '^[A-Za-z0-9_-]{22}$'`),
  check(
    'products_name_format',
    sql`btrim(${table.name}) = ${table.name} and ${table.name} <> '' and ${table.name} !~ '[[:cntrl:]]'`,
  ),
  check(
    'products_description_format',
    sql`btrim(${table.description}) = ${table.description} and ${table.description} !~ '[[:cntrl:]]'`,
  ),
  check('products_row_version_positive', sql`${table.rowVersion} > 0`),
  check(
    'products_active_requires_policy',
    sql`${table.status} <> 'active' or ${table.activePolicyVersionId} is not null`,
  ),
])

export const policyVersions = pgTable('policy_versions', {
  id: uuid('id').defaultRandom().primaryKey(),
  publicId: char('public_id', { length: 22 }).notNull(),
  productId: uuid('product_id').notNull(),
  merchantId: uuid('merchant_id').notNull(),
  version: integer('version').notNull(),
  productName: varchar('product_name', { length: 100 }).notNull(),
  priceLuna: bigint('price_luna', { mode: 'number' }).notNull(),
  returnWindowSeconds: bigint('return_window_seconds', { mode: 'number' }).notNull(),
  warrantyWindowSeconds: bigint('warranty_window_seconds', { mode: 'number' }).notNull(),
  warrantyTransferAllowed: boolean('warranty_transfer_allowed').notNull(),
  protocolVersion: varchar('protocol_version', { length: 8 }).notNull(),
  challengeNonce: char('challenge_nonce', { length: 22 }).notNull(),
  payload: jsonb('payload').$type<PolicyPayload>().notNull(),
  canonicalMessage: text('canonical_message').notNull(),
  payloadHash: char('payload_hash', { length: 64 }).notNull(),
  settlementAddress: varchar('settlement_address', { length: 36 }).notNull(),
  signerAddress: varchar('signer_address', { length: 36 }),
  publicKey: char('public_key', { length: 64 }),
  signature: char('signature', { length: 128 }),
  verificationStatus: policyVerificationStatus('verification_status').default('pending').notNull(),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  verifierVersion: varchar('verifier_version', { length: 40 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique('policy_versions_public_id_unique').on(table.publicId),
  unique('policy_versions_product_version_unique').on(table.productId, table.version),
  unique('policy_versions_challenge_nonce_unique').on(table.challengeNonce),
  unique('policy_versions_id_product_unique').on(table.id, table.productId),
  unique('policy_versions_id_merchant_unique').on(table.id, table.merchantId),
  foreignKey({
    name: 'policy_versions_product_merchant_fk',
    columns: [table.productId, table.merchantId],
    foreignColumns: [products.id, products.merchantId],
  }).onDelete('restrict'),
  index('policy_versions_product_version_index').on(table.productId, table.version),
  index('policy_versions_merchant_status_index').on(table.merchantId, table.verificationStatus),
  check('policy_versions_public_id_format', sql`${table.publicId} ~ '^[A-Za-z0-9_-]{22}$'`),
  check('policy_versions_version_positive', sql`${table.version} > 0`),
  check(
    'policy_versions_price_luna_range',
    sql`${table.priceLuna} > 0 and ${table.priceLuna} <= 9007199254740991`,
  ),
  check(
    'policy_versions_return_window_range',
    sql`${table.returnWindowSeconds} >= 0 and ${table.returnWindowSeconds} <= 157680000`,
  ),
  check(
    'policy_versions_warranty_window_range',
    sql`${table.warrantyWindowSeconds} >= 0 and ${table.warrantyWindowSeconds} <= 157680000`,
  ),
  check('policy_versions_protocol', sql`${table.protocolVersion} = 'NR1'`),
  check('policy_versions_challenge_nonce_format', sql`${table.challengeNonce} ~ '^[A-Za-z0-9_-]{22}$'`),
  check('policy_versions_payload_object', sql`jsonb_typeof(${table.payload}) = 'object'`),
  check(
    'policy_versions_canonical_message_domain',
    sql`${table.canonicalMessage} like 'NIMRETURN/1/POLICY' || chr(10) || '%'`,
  ),
  check('policy_versions_payload_hash_format', sql`${table.payloadHash} ~ '^[0-9a-f]{64}$'`),
  check(
    'policy_versions_settlement_address_format',
    sql`${table.settlementAddress} ~ '^NQ[0-9A-HJ-NP-VXY]{34}$'`,
  ),
  check(
    'policy_versions_signer_address_format',
    sql`${table.signerAddress} is null or ${table.signerAddress} ~ '^NQ[0-9A-HJ-NP-VXY]{34}$'`,
  ),
  check(
    'policy_versions_public_key_format',
    sql`${table.publicKey} is null or ${table.publicKey} ~ '^[0-9a-f]{64}$'`,
  ),
  check(
    'policy_versions_signature_format',
    sql`${table.signature} is null or ${table.signature} ~ '^[0-9a-f]{128}$'`,
  ),
  check(
    'policy_versions_verified_proof_complete',
    sql`${table.verificationStatus} <> 'verified' or (${table.signerAddress} is not null and ${table.publicKey} is not null and ${table.signature} is not null and ${table.verifiedAt} is not null and ${table.verifierVersion} is not null)`,
  ),
  check(
    'policy_versions_unverified_has_no_verified_at',
    sql`${table.verificationStatus} = 'verified' or ${table.verifiedAt} is null`,
  ),
])

export const signingChallenges = pgTable('signing_challenges', {
  id: uuid('id').defaultRandom().primaryKey(),
  nonce: char('nonce', { length: 22 }).notNull(),
  action: signingChallengeAction('action').notNull(),
  merchantId: uuid('merchant_id').notNull(),
  policyVersionId: uuid('policy_version_id').notNull(),
  bootstrapSessionId: uuid('bootstrap_session_id'),
  expectedSignerAddress: varchar('expected_signer_address', { length: 36 }),
  canonicalMessage: text('canonical_message').notNull(),
  payloadHash: char('payload_hash', { length: 64 }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique('signing_challenges_nonce_unique').on(table.nonce),
  unique('signing_challenges_policy_version_unique').on(table.policyVersionId),
  foreignKey({
    name: 'signing_challenges_policy_merchant_fk',
    columns: [table.policyVersionId, table.merchantId],
    foreignColumns: [policyVersions.id, policyVersions.merchantId],
  }).onDelete('cascade'),
  foreignKey({
    name: 'signing_challenges_bootstrap_merchant_fk',
    columns: [table.bootstrapSessionId, table.merchantId],
    foreignColumns: [merchantBootstrapSessions.id, merchantBootstrapSessions.merchantId],
  }).onDelete('restrict'),
  index('signing_challenges_expires_at_index').on(table.expiresAt),
  check('signing_challenges_nonce_format', sql`${table.nonce} ~ '^[A-Za-z0-9_-]{22}$'`),
  check(
    'signing_challenges_expected_signer_format',
    sql`${table.expectedSignerAddress} is null or ${table.expectedSignerAddress} ~ '^NQ[0-9A-HJ-NP-VXY]{34}$'`,
  ),
  check(
    'signing_challenges_bootstrap_or_established_signer',
    sql`(${table.expectedSignerAddress} is null and ${table.bootstrapSessionId} is not null) or (${table.expectedSignerAddress} is not null and ${table.bootstrapSessionId} is null)`,
  ),
  check(
    'signing_challenges_canonical_message_domain',
    sql`${table.canonicalMessage} like 'NIMRETURN/1/POLICY' || chr(10) || '%'`,
  ),
  check('signing_challenges_payload_hash_format', sql`${table.payloadHash} ~ '^[0-9a-f]{64}$'`),
  check(
    'signing_challenges_valid_times',
    sql`${table.expiresAt} > ${table.createdAt} and (${table.consumedAt} is null or (${table.consumedAt} >= ${table.createdAt} and ${table.consumedAt} <= ${table.expiresAt}))`,
  ),
])

export const protocolEvents = pgTable('protocol_events', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  eventId: uuid('event_id').defaultRandom().notNull(),
  aggregateType: varchar('aggregate_type', { length: 40 }).notNull(),
  aggregateId: uuid('aggregate_id').notNull(),
  eventType: varchar('event_type', { length: 60 }).notNull(),
  protocolVersion: varchar('protocol_version', { length: 8 }).notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  actorAddress: varchar('actor_address', { length: 36 }),
  causationId: uuid('causation_id'),
  correlationId: uuid('correlation_id').notNull(),
  evidenceType: evidenceType('evidence_type').notNull(),
  evidenceId: uuid('evidence_id'),
  payload: jsonb('payload').$type<Record<string, unknown>>().default({}).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique('protocol_events_event_id_unique').on(table.eventId),
  index('protocol_events_aggregate_index').on(table.aggregateType, table.aggregateId, table.id),
  index('protocol_events_type_occurred_at_index').on(table.eventType, table.occurredAt),
  check('protocol_events_protocol', sql`${table.protocolVersion} = 'NR1'`),
  check(
    'protocol_events_actor_address_format',
    sql`${table.actorAddress} is null or ${table.actorAddress} ~ '^NQ[0-9A-HJ-NP-VXY]{34}$'`,
  ),
  check('protocol_events_payload_object', sql`jsonb_typeof(${table.payload}) = 'object'`),
])
