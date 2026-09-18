import { sql } from 'drizzle-orm'
import type { PolicyPayload } from '../../src/lib/protocol/policy.js'
import type {
  ClaimAuthorizationPayload,
  ClaimPayload,
} from '../../src/lib/protocol/claim.js'
import type { ClaimEligibilityEvaluation } from '../../src/lib/protocol/claim-eligibility.js'
import type { ResolutionPayload } from '../../src/lib/protocol/resolution.js'
import type { PurchaseClaimKeyPayload } from '../../src/lib/protocol/claim.js'
import type { MerchantSessionPayload } from '../../src/lib/protocol/merchant-session.js'
import type {
  ObservedTransaction,
  TransactionVerification,
} from '../../src/lib/protocol/transaction-verification.js'
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
export const orderPaymentState = pgEnum('order_payment_state', [
  'payment_requested',
  'wallet_request_started',
  'payment_cancelled',
  'submission_outcome_unknown',
  'payment_verifying',
  'payment_pending',
  'payment_failed',
  'expired',
  'purchased',
])
export const chainTransactionPurpose = pgEnum('chain_transaction_purpose', ['purchase', 'refund'])
export const chainObservedState = pgEnum('chain_observed_state', [
  'absent',
  'mempool',
  'included',
  'finalized',
  'invalid',
  'inconclusive',
])
export const chainReconciliationOutcome = pgEnum('chain_reconciliation_outcome', [
  'confirmed',
  'inconclusive',
  'exception',
])
export const passportStatus = pgEnum('passport_status', ['active', 'refunded'])
export const claimType = pgEnum('claim_type', ['RETURN', 'WARRANTY'])
export const claimReasonCode = pgEnum('claim_reason_code', [
  'CHANGED_MIND',
  'DEFECTIVE',
  'NOT_AS_DESCRIBED',
  'OTHER',
])
export const claimSignatureStatus = pgEnum('claim_signature_status', [
  'pending',
  'verified',
  'expired',
])
export const claimWorkflowState = pgEnum('claim_workflow_state', [
  'signature_requested',
  'authorization_pending',
  'eligible',
  'ineligible',
  'decision_pending',
  'approved',
  'rejected',
])
export const claimAuthorizationMode = pgEnum('claim_authorization_mode', ['self', 'delegated', 'purchase_key'])
export const resolutionDecision = pgEnum('resolution_decision', ['APPROVED', 'REJECTED'])
export const resolutionReasonCode = pgEnum('resolution_reason_code', [
  'INSUFFICIENT_INFORMATION',
  'POLICY_ACCEPTED',
  'POLICY_NOT_APPLICABLE',
  'OTHER',
])
export const resolutionVerificationStatus = pgEnum('resolution_verification_status', [
  'pending',
  'verified',
  'expired',
])
export const refundAttemptState = pgEnum('refund_attempt_state', [
  'payment_requested',
  'wallet_request_started',
  'payment_cancelled',
  'submission_outcome_unknown',
  'payment_verifying',
  'payment_pending',
  'payment_failed',
  'refunded',
])

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

export const merchantSessionChallenges = pgTable('merchant_session_challenges', {
  id: uuid('id').defaultRandom().primaryKey(),
  nonce: char('nonce', { length: 22 }).notNull(),
  merchantId: uuid('merchant_id')
    .notNull()
    .references(() => merchants.id, { onDelete: 'restrict' }),
  expectedSignerAddress: varchar('expected_signer_address', { length: 36 }).notNull(),
  audience: varchar('audience', { length: 2_048 }).notNull(),
  payload: jsonb('payload').$type<MerchantSessionPayload>().notNull(),
  canonicalMessage: text('canonical_message').notNull(),
  payloadHash: char('payload_hash', { length: 64 }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique('merchant_session_challenges_nonce_unique').on(table.nonce),
  index('merchant_session_challenges_merchant_expiry_index')
    .on(table.merchantId, table.expiresAt),
  index('merchant_session_challenges_expiry_index').on(table.expiresAt),
  check(
    'merchant_session_challenges_nonce_format',
    sql`${table.nonce} ~ '^[A-Za-z0-9_-]{22}$'`,
  ),
  check(
    'merchant_session_challenges_expected_signer_format',
    sql`${table.expectedSignerAddress} ~ '^NQ[0-9A-HJ-NP-VXY]{34}$'`,
  ),
  check(
    'merchant_session_challenges_audience_format',
    sql`btrim(${table.audience}) = ${table.audience} and ${table.audience} ~ '^https?://' and ${table.audience} !~ '[[:cntrl:]]'`,
  ),
  check(
    'merchant_session_challenges_payload_object',
    sql`jsonb_typeof(${table.payload}) = 'object'`,
  ),
  check(
    'merchant_session_challenges_payload_binding',
    sql`${table.payload}->>'nonce' = ${table.nonce} and ${table.payload}->>'audience' = ${table.audience} and ${table.payload}->>'policySignerAddress' = ${table.expectedSignerAddress} and ${table.payload}->>'type' = 'MERCHANT_SESSION' and ${table.payload}->>'version' = '1'`,
  ),
  check(
    'merchant_session_challenges_canonical_message_domain',
    sql`${table.canonicalMessage} like 'NIMRETURN/AUTH/1/MERCHANT_SESSION' || chr(10) || '%'`,
  ),
  check(
    'merchant_session_challenges_payload_hash_format',
    sql`${table.payloadHash} ~ '^[0-9a-f]{64}$'`,
  ),
  check(
    'merchant_session_challenges_valid_times',
    sql`${table.expiresAt} > ${table.createdAt} and ${table.expiresAt} <= ${table.createdAt} + interval '5 minutes' and (${table.consumedAt} is null or (${table.consumedAt} >= ${table.createdAt} and ${table.consumedAt} < ${table.expiresAt}))`,
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
  // The chain this product is sold on; a purchase must be paid and verified there.
  network: varchar('network', { length: 24 }).notNull(),
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
  index('products_network_status_index').on(table.network, table.status),
  check('products_network_not_blank', sql`btrim(${table.network}) <> ''`),
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
  unique('signing_challenges_bootstrap_session_unique').on(table.bootstrapSessionId),
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

export const orders = pgTable('orders', {
  id: uuid('id').defaultRandom().primaryKey(),
  publicId: char('public_id', { length: 22 }).notNull(),
  productId: uuid('product_id').notNull(),
  policyVersionId: uuid('policy_version_id').notNull(),
  merchantId: uuid('merchant_id').notNull(),
  productName: varchar('product_name', { length: 100 }).notNull(),
  productDescription: varchar('product_description', { length: 500 }).default('').notNull(),
  merchantDisplayName: varchar('merchant_display_name', { length: 80 }).notNull(),
  policyPayloadHash: char('policy_payload_hash', { length: 64 }).notNull(),
  policyVersion: integer('policy_version').notNull(),
  protocolVersion: varchar('protocol_version', { length: 8 }).notNull(),
  expectedRecipient: varchar('expected_recipient', { length: 36 }).notNull(),
  expectedValueLuna: bigint('expected_value_luna', { mode: 'number' }).notNull(),
  expectedData: varchar('expected_data', { length: 64 }).notNull(),
  network: varchar('network', { length: 24 }).notNull(),
  buyerAddress: varchar('buyer_address', { length: 36 }),
  paymentState: orderPaymentState('payment_state').default('payment_requested').notNull(),
  failureCode: varchar('failure_code', { length: 50 }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  rowVersion: integer('row_version').default(1).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique('orders_public_id_unique').on(table.publicId),
  unique('orders_id_product_unique').on(table.id, table.productId),
  unique('orders_id_policy_unique').on(table.id, table.policyVersionId),
  unique('orders_id_merchant_unique').on(table.id, table.merchantId),
  foreignKey({
    name: 'orders_product_merchant_fk',
    columns: [table.productId, table.merchantId],
    foreignColumns: [products.id, products.merchantId],
  }).onDelete('restrict'),
  foreignKey({
    name: 'orders_policy_product_fk',
    columns: [table.policyVersionId, table.productId],
    foreignColumns: [policyVersions.id, policyVersions.productId],
  }).onDelete('restrict'),
  foreignKey({
    name: 'orders_policy_merchant_fk',
    columns: [table.policyVersionId, table.merchantId],
    foreignColumns: [policyVersions.id, policyVersions.merchantId],
  }).onDelete('restrict'),
  index('orders_merchant_state_created_index').on(table.merchantId, table.paymentState, table.createdAt),
  index('orders_state_updated_index').on(table.paymentState, table.updatedAt),
  index('orders_buyer_created_index').on(table.buyerAddress, table.createdAt),
  check('orders_public_id_format', sql`${table.publicId} ~ '^[A-Za-z0-9_-]{22}$'`),
  check('orders_policy_payload_hash_format', sql`${table.policyPayloadHash} ~ '^[0-9a-f]{64}$'`),
  check('orders_policy_version_positive', sql`${table.policyVersion} > 0`),
  check('orders_protocol', sql`${table.protocolVersion} = 'NR1'`),
  check(
    'orders_expected_recipient_format',
    sql`${table.expectedRecipient} ~ '^NQ[0-9A-HJ-NP-VXY]{34}$'`,
  ),
  check(
    'orders_buyer_address_format',
    sql`${table.buyerAddress} is null or ${table.buyerAddress} ~ '^NQ[0-9A-HJ-NP-VXY]{34}$'`,
  ),
  check(
    'orders_expected_value_range',
    sql`${table.expectedValueLuna} > 0 and ${table.expectedValueLuna} <= 9007199254740991`,
  ),
  check('orders_expected_data_binding', sql`${table.expectedData} = 'NR1:P:' || ${table.publicId}`),
  check('orders_valid_expiry', sql`${table.expiresAt} > ${table.createdAt}`),
  check('orders_row_version_positive', sql`${table.rowVersion} > 0`),
  check(
    'orders_buyer_only_when_purchased',
    sql`(${table.paymentState} = 'purchased' and ${table.buyerAddress} is not null) or (${table.paymentState} <> 'purchased' and ${table.buyerAddress} is null)`,
  ),
  check(
    'orders_failure_code_state',
    sql`(${table.paymentState} = 'payment_failed' and ${table.failureCode} is not null) or (${table.paymentState} <> 'payment_failed' and ${table.failureCode} is null)`,
  ),
])

export const purchaseClaimKeys = pgTable('purchase_claim_keys', {
  id: uuid('id').defaultRandom().primaryKey(),
  orderId: uuid('order_id').notNull().references(() => orders.id, { onDelete: 'restrict' }),
  nonce: char('nonce', { length: 22 }).notNull(),
  payload: jsonb('payload').$type<PurchaseClaimKeyPayload>().notNull(),
  canonicalMessage: text('canonical_message').notNull(),
  payloadHash: char('payload_hash', { length: 64 }).notNull(),
  signerAddress: varchar('signer_address', { length: 36 }),
  publicKey: char('public_key', { length: 64 }),
  signature: char('signature', { length: 128 }),
  verifierVersion: varchar('verifier_version', { length: 40 }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
}, (table) => [
  unique('purchase_claim_keys_nonce_unique').on(table.nonce),
  uniqueIndex('purchase_claim_keys_one_verified_per_order')
    .on(table.orderId)
    .where(sql`${table.verifiedAt} is not null`),
  index('purchase_claim_keys_order_created_index').on(table.orderId, table.createdAt),
  check('purchase_claim_keys_nonce_format', sql`${table.nonce} ~ '^[A-Za-z0-9_-]{22}$'`),
  check('purchase_claim_keys_payload_hash_format', sql`${table.payloadHash} ~ '^[0-9a-f]{64}$'`),
  check(
    'purchase_claim_keys_payload_binding',
    sql`jsonb_typeof(${table.payload}) = 'object' and ${table.payload}->>'nonce' = ${table.nonce} and ${table.payload}->>'type' = 'PURCHASE_CLAIM_KEY' and ${table.payload}->>'protocol' = 'NR1'`,
  ),
  check(
    'purchase_claim_keys_canonical_message_domain',
    sql`${table.canonicalMessage} like 'NIMRETURN/1/PURCHASE_CLAIM_KEY' || chr(10) || '%'`,
  ),
  check(
    'purchase_claim_keys_signer_format',
    sql`${table.signerAddress} is null or ${table.signerAddress} ~ '^NQ[0-9A-HJ-NP-VXY]{34}$'`,
  ),
  check('purchase_claim_keys_valid_times', sql`${table.expiresAt} > ${table.createdAt}`),
  check(
    'purchase_claim_keys_proof_shape',
    sql`(${table.verifiedAt} is null and ${table.signerAddress} is null and ${table.publicKey} is null and ${table.signature} is null and ${table.verifierVersion} is null) or (${table.verifiedAt} is not null and ${table.signerAddress} is not null and ${table.publicKey} ~ '^[0-9a-f]{64}$' and ${table.signature} ~ '^[0-9a-f]{128}$' and ${table.verifierVersion} is not null and ${table.verifiedAt} >= ${table.createdAt} and ${table.verifiedAt} < ${table.expiresAt})`,
  ),
])

export const chainTransactions = pgTable('chain_transactions', {
  id: uuid('id').defaultRandom().primaryKey(),
  network: varchar('network', { length: 24 }).notNull(),
  transactionHash: char('transaction_hash', { length: 64 }).notNull(),
  purpose: chainTransactionPurpose('purpose').notNull(),
  resourceId: uuid('resource_id').notNull(),
  observedState: chainObservedState('observed_state').default('inconclusive').notNull(),
  normalizedEvidence: jsonb('normalized_evidence').$type<ObservedTransaction>(),
  providerId: varchar('provider_id', { length: 80 }).notNull(),
  observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
  blockNumber: bigint('block_number', { mode: 'number' }),
  blockTimestampMs: bigint('block_timestamp_ms', { mode: 'number' }),
  finalizingBlockNumber: bigint('finalizing_block_number', { mode: 'number' }),
  headBlockNumber: bigint('head_block_number', { mode: 'number' }),
  confirmations: bigint('confirmations', { mode: 'number' }),
  executionResult: boolean('execution_result'),
  sender: varchar('sender', { length: 36 }),
  recipient: varchar('recipient', { length: 36 }),
  valueLuna: bigint('value_luna', { mode: 'number' }),
  dataText: varchar('data_text', { length: 64 }),
  verificationChecks: jsonb('verification_checks').$type<TransactionVerification['checks']>(),
  verificationReason: varchar('verification_reason', { length: 500 }).notNull(),
  verifierVersion: varchar('verifier_version', { length: 40 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique('chain_transactions_network_hash_unique').on(table.network, table.transactionHash),
  unique('chain_transactions_purpose_resource_unique').on(table.purpose, table.resourceId),
  index('chain_transactions_state_updated_index').on(table.observedState, table.updatedAt),
  check('chain_transactions_hash_format', sql`${table.transactionHash} ~ '^[0-9a-f]{64}$'`),
  check('chain_transactions_network_not_blank', sql`btrim(${table.network}) <> ''`),
  check('chain_transactions_provider_not_blank', sql`btrim(${table.providerId}) <> ''`),
  check('chain_transactions_reason_not_blank', sql`btrim(${table.verificationReason}) <> ''`),
  check(
    'chain_transactions_sender_format',
    sql`${table.sender} is null or ${table.sender} ~ '^NQ[0-9A-HJ-NP-VXY]{34}$'`,
  ),
  check(
    'chain_transactions_recipient_format',
    sql`${table.recipient} is null or ${table.recipient} ~ '^NQ[0-9A-HJ-NP-VXY]{34}$'`,
  ),
  check(
    'chain_transactions_value_range',
    sql`${table.valueLuna} is null or (${table.valueLuna} >= 0 and ${table.valueLuna} <= 9007199254740991)`,
  ),
  check(
    'chain_transactions_block_ranges',
    sql`(${table.blockNumber} is null or ${table.blockNumber} >= 0) and (${table.blockTimestampMs} is null or (${table.blockTimestampMs} >= 0 and ${table.blockTimestampMs} <= 9007199254740991)) and (${table.finalizingBlockNumber} is null or ${table.finalizingBlockNumber} >= 0) and (${table.headBlockNumber} is null or ${table.headBlockNumber} >= 0) and (${table.confirmations} is null or ${table.confirmations} >= 0)`,
  ),
  check(
    'chain_transactions_normalized_evidence_object',
    sql`${table.normalizedEvidence} is null or jsonb_typeof(${table.normalizedEvidence}) = 'object'`,
  ),
  check(
    'chain_transactions_verification_checks_object',
    sql`${table.verificationChecks} is null or jsonb_typeof(${table.verificationChecks}) = 'object'`,
  ),
])

export const chainReconciliations = pgTable('chain_reconciliations', {
  id: uuid('id').defaultRandom().primaryKey(),
  chainTransactionId: uuid('chain_transaction_id')
    .notNull()
    .references(() => chainTransactions.id, { onDelete: 'restrict' }),
  outcome: chainReconciliationOutcome('outcome').notNull(),
  normalizedEvidence: jsonb('normalized_evidence').$type<ObservedTransaction>(),
  reason: varchar('reason', { length: 500 }).notNull(),
  verifierVersion: varchar('verifier_version', { length: 40 }).notNull(),
  checkedAt: timestamp('checked_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('chain_reconciliations_chain_checked_index').on(table.chainTransactionId, table.checkedAt),
  check('chain_reconciliations_reason_not_blank', sql`btrim(${table.reason}) <> ''`),
  check(
    'chain_reconciliations_evidence_object',
    sql`${table.normalizedEvidence} is null or jsonb_typeof(${table.normalizedEvidence}) = 'object'`,
  ),
])

export const purchaseTransactions = pgTable('purchase_transactions', {
  id: uuid('id').defaultRandom().primaryKey(),
  orderId: uuid('order_id').notNull().references(() => orders.id, { onDelete: 'restrict' }),
  chainTransactionId: uuid('chain_transaction_id')
    .notNull()
    .references(() => chainTransactions.id, { onDelete: 'restrict' }),
  verifiedAt: timestamp('verified_at', { withTimezone: true }).notNull(),
  confirmationPolicy: varchar('confirmation_policy', { length: 40 }).notNull(),
}, (table) => [
  unique('purchase_transactions_order_unique').on(table.orderId),
  unique('purchase_transactions_chain_unique').on(table.chainTransactionId),
  check(
    'purchase_transactions_confirmation_policy',
    sql`${table.confirmationPolicy} = 'albatross-next-macro-v1'`,
  ),
])

export const purchasePassports = pgTable('purchase_passports', {
  id: uuid('id').defaultRandom().primaryKey(),
  publicId: char('public_id', { length: 22 }).notNull(),
  orderId: uuid('order_id').notNull().references(() => orders.id, { onDelete: 'restrict' }),
  purchaseTransactionId: uuid('purchase_transaction_id')
    .notNull()
    .references(() => purchaseTransactions.id, { onDelete: 'restrict' }),
  policyVersionId: uuid('policy_version_id')
    .notNull()
    .references(() => policyVersions.id, { onDelete: 'restrict' }),
  productId: uuid('product_id').notNull().references(() => products.id, { onDelete: 'restrict' }),
  merchantId: uuid('merchant_id').notNull().references(() => merchants.id, { onDelete: 'restrict' }),
  originalBuyerAddress: varchar('original_buyer_address', { length: 36 }).notNull(),
  productName: varchar('product_name', { length: 100 }).notNull(),
  productDescription: varchar('product_description', { length: 500 }).default('').notNull(),
  merchantDisplayName: varchar('merchant_display_name', { length: 80 }).notNull(),
  policyPayloadHash: char('policy_payload_hash', { length: 64 }).notNull(),
  policyVersion: integer('policy_version').notNull(),
  protocolVersion: varchar('protocol_version', { length: 8 }).notNull(),
  priceLuna: bigint('price_luna', { mode: 'number' }).notNull(),
  settlementRecipient: varchar('settlement_recipient', { length: 36 }).notNull(),
  purchaseTime: timestamp('purchase_time', { withTimezone: true }).notNull(),
  returnDeadline: timestamp('return_deadline', { withTimezone: true }),
  warrantyDeadline: timestamp('warranty_deadline', { withTimezone: true }),
  status: passportStatus('status').default('active').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique('purchase_passports_public_id_unique').on(table.publicId),
  unique('purchase_passports_order_unique').on(table.orderId),
  unique('purchase_passports_purchase_transaction_unique').on(table.purchaseTransactionId),
  unique('purchase_passports_id_order_unique').on(table.id, table.orderId),
  unique('purchase_passports_id_policy_unique').on(table.id, table.policyVersionId),
  unique('purchase_passports_id_merchant_unique').on(table.id, table.merchantId),
  foreignKey({
    name: 'purchase_passports_order_product_fk',
    columns: [table.orderId, table.productId],
    foreignColumns: [orders.id, orders.productId],
  }).onDelete('restrict'),
  foreignKey({
    name: 'purchase_passports_order_policy_fk',
    columns: [table.orderId, table.policyVersionId],
    foreignColumns: [orders.id, orders.policyVersionId],
  }).onDelete('restrict'),
  foreignKey({
    name: 'purchase_passports_order_merchant_fk',
    columns: [table.orderId, table.merchantId],
    foreignColumns: [orders.id, orders.merchantId],
  }).onDelete('restrict'),
  index('purchase_passports_buyer_created_index').on(table.originalBuyerAddress, table.createdAt),
  index('purchase_passports_merchant_created_index').on(table.merchantId, table.createdAt),
  check('purchase_passports_public_id_format', sql`${table.publicId} ~ '^[A-Za-z0-9_-]{22}$'`),
  check(
    'purchase_passports_buyer_address_format',
    sql`${table.originalBuyerAddress} ~ '^NQ[0-9A-HJ-NP-VXY]{34}$'`,
  ),
  check(
    'purchase_passports_settlement_address_format',
    sql`${table.settlementRecipient} ~ '^NQ[0-9A-HJ-NP-VXY]{34}$'`,
  ),
  check('purchase_passports_policy_hash_format', sql`${table.policyPayloadHash} ~ '^[0-9a-f]{64}$'`),
  check('purchase_passports_policy_version_positive', sql`${table.policyVersion} > 0`),
  check('purchase_passports_protocol', sql`${table.protocolVersion} = 'NR1'`),
  check(
    'purchase_passports_price_range',
    sql`${table.priceLuna} > 0 and ${table.priceLuna} <= 9007199254740991`,
  ),
  check(
    'purchase_passports_deadline_order',
    sql`(${table.returnDeadline} is null or ${table.returnDeadline} >= ${table.purchaseTime}) and (${table.warrantyDeadline} is null or ${table.warrantyDeadline} >= ${table.purchaseTime})`,
  ),
])

export const claims = pgTable('claims', {
  id: uuid('id').defaultRandom().primaryKey(),
  publicId: char('public_id', { length: 22 }).notNull(),
  passportId: uuid('passport_id').notNull(),
  orderId: uuid('order_id').notNull(),
  policyVersionId: uuid('policy_version_id').notNull(),
  merchantId: uuid('merchant_id').notNull(),
  purchaseSenderAddress: varchar('purchase_sender_address', { length: 36 }).notNull(),
  claimSignerAddress: varchar('claim_signer_address', { length: 36 }),
  claimType: claimType('claim_type').notNull(),
  reasonCode: claimReasonCode('reason_code').notNull(),
  note: varchar('note', { length: 1024 }).default('').notNull(),
  claimTime: timestamp('claim_time', { withTimezone: true }).notNull(),
  challengeNonce: char('challenge_nonce', { length: 22 }).notNull(),
  payload: jsonb('payload').$type<ClaimPayload>().notNull(),
  canonicalMessage: text('canonical_message').notNull(),
  payloadHash: char('payload_hash', { length: 64 }).notNull(),
  publicKey: char('public_key', { length: 64 }),
  signature: char('signature', { length: 128 }),
  verifierVersion: varchar('verifier_version', { length: 40 }),
  signatureStatus: claimSignatureStatus('signature_status').default('pending').notNull(),
  workflowState: claimWorkflowState('workflow_state').default('signature_requested').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique('claims_public_id_unique').on(table.publicId),
  unique('claims_challenge_nonce_unique').on(table.challengeNonce),
  unique('claims_id_passport_unique').on(table.id, table.passportId),
  unique('claims_id_merchant_unique').on(table.id, table.merchantId),
  foreignKey({
    name: 'claims_passport_order_fk',
    columns: [table.passportId, table.orderId],
    foreignColumns: [purchasePassports.id, purchasePassports.orderId],
  }).onDelete('restrict'),
  foreignKey({
    name: 'claims_passport_policy_fk',
    columns: [table.passportId, table.policyVersionId],
    foreignColumns: [purchasePassports.id, purchasePassports.policyVersionId],
  }).onDelete('restrict'),
  foreignKey({
    name: 'claims_passport_merchant_fk',
    columns: [table.passportId, table.merchantId],
    foreignColumns: [purchasePassports.id, purchasePassports.merchantId],
  }).onDelete('restrict'),
  uniqueIndex('claims_one_active_type_per_passport')
    .on(table.passportId, table.claimType)
    .where(sql`${table.workflowState} <> 'rejected' and ${table.signatureStatus} <> 'expired'`),
  index('claims_merchant_queue_index').on(table.merchantId, table.workflowState, table.createdAt),
  index('claims_sender_created_index').on(table.purchaseSenderAddress, table.createdAt),
  check('claims_public_id_format', sql`${table.publicId} ~ '^[A-Za-z0-9_-]{22}$'`),
  check('claims_nonce_format', sql`${table.challengeNonce} ~ '^[A-Za-z0-9_-]{22}$'`),
  check('claims_payload_hash_format', sql`${table.payloadHash} ~ '^[0-9a-f]{64}$'`),
  check('claims_payload_object', sql`jsonb_typeof(${table.payload}) = 'object'`),
  check(
    'claims_canonical_message_domain',
    sql`${table.canonicalMessage} like 'NIMRETURN/1/CLAIM' || chr(10) || '%'`,
  ),
  check(
    'claims_purchase_sender_format',
    sql`${table.purchaseSenderAddress} ~ '^NQ[0-9A-HJ-NP-VXY]{34}$'`,
  ),
  check(
    'claims_signer_format',
    sql`${table.claimSignerAddress} is null or ${table.claimSignerAddress} ~ '^NQ[0-9A-HJ-NP-VXY]{34}$'`,
  ),
  check(
    'claims_note_format',
    sql`btrim(${table.note}) = ${table.note} and ${table.note} !~ '[[:cntrl:]]'`,
  ),
  check('claims_valid_expiry', sql`${table.expiresAt} > ${table.createdAt}`),
  check(
    'claims_verified_proof_complete',
    sql`${table.signatureStatus} <> 'verified' or (${table.claimSignerAddress} is not null and ${table.publicKey} is not null and ${table.signature} is not null and ${table.verifierVersion} is not null and ${table.verifiedAt} is not null)`,
  ),
  check(
    'claims_expired_proof_empty',
    sql`${table.signatureStatus} <> 'expired' or (${table.claimSignerAddress} is null and ${table.publicKey} is null and ${table.signature} is null and ${table.verifierVersion} is null and ${table.verifiedAt} is null and ${table.workflowState} = 'signature_requested')`,
  ),
  check(
    'claims_pending_proof_empty',
    sql`${table.signatureStatus} <> 'pending' or (${table.claimSignerAddress} is null and ${table.publicKey} is null and ${table.signature} is null and ${table.verifierVersion} is null and ${table.verifiedAt} is null and ${table.workflowState} = 'signature_requested')`,
  ),
  check(
    'claims_authorization_state_requires_proof',
    sql`${table.workflowState} = 'signature_requested' or ${table.signatureStatus} = 'verified'`,
  ),
])

export const claimAuthorizations = pgTable('claim_authorizations', {
  id: uuid('id').defaultRandom().primaryKey(),
  publicId: char('public_id', { length: 22 }).notNull(),
  claimId: uuid('claim_id').notNull().references(() => claims.id, { onDelete: 'restrict' }),
  mode: claimAuthorizationMode('authorization_mode').notNull(),
  purchaseSenderAddress: varchar('purchase_sender_address', { length: 36 }).notNull(),
  claimSignerAddress: varchar('claim_signer_address', { length: 36 }).notNull(),
  claimPayloadHash: char('claim_payload_hash', { length: 64 }).notNull(),
  challengeNonce: char('challenge_nonce', { length: 22 }),
  payload: jsonb('payload').$type<ClaimAuthorizationPayload>(),
  canonicalMessage: text('canonical_message'),
  payloadHash: char('payload_hash', { length: 64 }),
  publicKey: char('public_key', { length: 64 }),
  signature: char('signature', { length: 128 }),
  authorizationSignerAddress: varchar('authorization_signer_address', { length: 36 }),
  verifierVersion: varchar('verifier_version', { length: 40 }),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  claimKeyId: uuid('claim_key_id').references(() => purchaseClaimKeys.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique('claim_authorizations_public_id_unique').on(table.publicId),
  unique('claim_authorizations_nonce_unique').on(table.challengeNonce),
  uniqueIndex('claim_authorizations_one_consumed_per_claim')
    .on(table.claimId)
    .where(sql`${table.consumedAt} is not null`),
  index('claim_authorizations_claim_created_index').on(table.claimId, table.createdAt),
  check('claim_authorizations_public_id_format', sql`${table.publicId} ~ '^[A-Za-z0-9_-]{22}$'`),
  check(
    'claim_authorizations_nonce_format',
    sql`${table.challengeNonce} is null or ${table.challengeNonce} ~ '^[A-Za-z0-9_-]{22}$'`,
  ),
  check(
    'claim_authorizations_address_format',
    sql`${table.purchaseSenderAddress} ~ '^NQ[0-9A-HJ-NP-VXY]{34}$' and ${table.claimSignerAddress} ~ '^NQ[0-9A-HJ-NP-VXY]{34}$' and (${table.authorizationSignerAddress} is null or ${table.authorizationSignerAddress} ~ '^NQ[0-9A-HJ-NP-VXY]{34}$')`,
  ),
  check('claim_authorizations_claim_hash_format', sql`${table.claimPayloadHash} ~ '^[0-9a-f]{64}$'`),
  check(
    'claim_authorizations_payload_hash_format',
    sql`${table.payloadHash} is null or ${table.payloadHash} ~ '^[0-9a-f]{64}$'`,
  ),
  check(
    'claim_authorizations_payload_object',
    sql`${table.payload} is null or jsonb_typeof(${table.payload}) = 'object'`,
  ),
  check(
    'claim_authorizations_mode_shape',
    sql`(${table.mode} = 'self' and ${table.purchaseSenderAddress} = ${table.claimSignerAddress} and ${table.challengeNonce} is null and ${table.payload} is null and ${table.canonicalMessage} is null and ${table.payloadHash} is null and ${table.publicKey} is null and ${table.signature} is null and ${table.authorizationSignerAddress} is null and ${table.expiresAt} is null and ${table.consumedAt} is not null and ${table.verifiedAt} is not null) or (${table.mode} = 'delegated' and ${table.purchaseSenderAddress} <> ${table.claimSignerAddress} and ${table.challengeNonce} is not null and ${table.payload} is not null and ${table.canonicalMessage} like 'NIMRETURN/1/CLAIM_AUTHORIZATION' || chr(10) || '%' and ${table.payloadHash} is not null and ${table.expiresAt} is not null and ${table.expiresAt} > ${table.createdAt}) or (${table.mode}::text = 'purchase_key' and ${table.purchaseSenderAddress} <> ${table.claimSignerAddress} and ${table.challengeNonce} is null and ${table.payload} is null and ${table.canonicalMessage} is null and ${table.payloadHash} is null and ${table.publicKey} is null and ${table.signature} is null and ${table.authorizationSignerAddress} is null and ${table.expiresAt} is null and ${table.consumedAt} is not null and ${table.verifiedAt} is not null)`,
  ),
  check(
    'claim_authorizations_claim_key_mode',
    sql`(${table.mode}::text = 'purchase_key') = (${table.claimKeyId} is not null)`,
  ),
  check(
    'claim_authorizations_delegated_proof_complete',
    sql`${table.mode} <> 'delegated' or ${table.consumedAt} is null or (${table.publicKey} is not null and ${table.signature} is not null and ${table.authorizationSignerAddress} = ${table.purchaseSenderAddress} and ${table.verifierVersion} is not null and ${table.verifiedAt} is not null)`,
  ),
])

export const claimEligibilityEvaluations = pgTable('claim_eligibility_evaluations', {
  id: uuid('id').defaultRandom().primaryKey(),
  claimId: uuid('claim_id').notNull().references(() => claims.id, { onDelete: 'restrict' }),
  evaluatorVersion: varchar('evaluator_version', { length: 40 }).notNull(),
  evaluatedAt: timestamp('evaluated_at', { withTimezone: true }).notNull(),
  inputs: jsonb('inputs').$type<Record<string, unknown>>().notNull(),
  ruleResults: jsonb('rule_results').$type<ClaimEligibilityEvaluation['rules']>().notNull(),
  eligible: boolean('eligible').notNull(),
  supersedesId: uuid('supersedes_id'),
  reason: varchar('reason', { length: 100 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  foreignKey({
    name: 'claim_eligibility_supersedes_fk',
    columns: [table.supersedesId],
    foreignColumns: [table.id],
  }).onDelete('restrict'),
  uniqueIndex('claim_eligibility_one_current_per_claim')
    .on(table.claimId)
    .where(sql`${table.supersedesId} is null`),
  index('claim_eligibility_claim_evaluated_index').on(table.claimId, table.evaluatedAt),
  check('claim_eligibility_inputs_object', sql`jsonb_typeof(${table.inputs}) = 'object'`),
  check('claim_eligibility_rules_object', sql`jsonb_typeof(${table.ruleResults}) = 'object'`),
  check('claim_eligibility_evaluator_not_blank', sql`btrim(${table.evaluatorVersion}) <> ''`),
])

export const claimResolutions = pgTable('claim_resolutions', {
  id: uuid('id').defaultRandom().primaryKey(),
  publicId: char('public_id', { length: 22 }).notNull(),
  claimId: uuid('claim_id').notNull(),
  merchantId: uuid('merchant_id').notNull(),
  policySignerAddress: varchar('policy_signer_address', { length: 36 }).notNull(),
  decision: resolutionDecision('decision').notNull(),
  reasonCode: resolutionReasonCode('reason_code').notNull(),
  note: varchar('note', { length: 1024 }).default('').notNull(),
  approvedRefundLuna: bigint('approved_refund_luna', { mode: 'number' }).notNull(),
  resolutionTime: timestamp('resolution_time', { withTimezone: true }).notNull(),
  challengeNonce: char('challenge_nonce', { length: 22 }).notNull(),
  payload: jsonb('payload').$type<ResolutionPayload>().notNull(),
  canonicalMessage: text('canonical_message').notNull(),
  payloadHash: char('payload_hash', { length: 64 }).notNull(),
  publicKey: char('public_key', { length: 64 }),
  signature: char('signature', { length: 128 }),
  signerAddress: varchar('signer_address', { length: 36 }),
  verifierVersion: varchar('verifier_version', { length: 40 }),
  verificationStatus: resolutionVerificationStatus('verification_status').default('pending').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique('claim_resolutions_public_id_unique').on(table.publicId),
  unique('claim_resolutions_challenge_nonce_unique').on(table.challengeNonce),
  unique('claim_resolutions_id_claim_unique').on(table.id, table.claimId),
  unique('claim_resolutions_id_merchant_unique').on(table.id, table.merchantId),
  foreignKey({
    name: 'claim_resolutions_claim_merchant_fk',
    columns: [table.claimId, table.merchantId],
    foreignColumns: [claims.id, claims.merchantId],
  }).onDelete('restrict'),
  uniqueIndex('claim_resolutions_one_pending_per_claim')
    .on(table.claimId)
    .where(sql`${table.verificationStatus} = 'pending'`),
  uniqueIndex('claim_resolutions_one_verified_per_claim')
    .on(table.claimId)
    .where(sql`${table.verificationStatus} = 'verified'`),
  index('claim_resolutions_merchant_created_index').on(table.merchantId, table.createdAt),
  check('claim_resolutions_public_id_format', sql`${table.publicId} ~ '^[A-Za-z0-9_-]{22}$'`),
  check('claim_resolutions_nonce_format', sql`${table.challengeNonce} ~ '^[A-Za-z0-9_-]{22}$'`),
  check('claim_resolutions_payload_object', sql`jsonb_typeof(${table.payload}) = 'object'`),
  check(
    'claim_resolutions_canonical_message_domain',
    sql`${table.canonicalMessage} like 'NIMRETURN/1/RESOLUTION' || chr(10) || '%'`,
  ),
  check('claim_resolutions_payload_hash_format', sql`${table.payloadHash} ~ '^[0-9a-f]{64}$'`),
  check(
    'claim_resolutions_policy_signer_format',
    sql`${table.policySignerAddress} ~ '^NQ[0-9A-HJ-NP-VXY]{34}$'`,
  ),
  check(
    'claim_resolutions_signer_format',
    sql`${table.signerAddress} is null or ${table.signerAddress} ~ '^NQ[0-9A-HJ-NP-VXY]{34}$'`,
  ),
  check(
    'claim_resolutions_note_format',
    sql`btrim(${table.note}) = ${table.note} and ${table.note} !~ '[[:cntrl:]]'`,
  ),
  check(
    'claim_resolutions_amount_shape',
    sql`(${table.decision} = 'APPROVED' and ${table.approvedRefundLuna} > 0 and ${table.approvedRefundLuna} <= 9007199254740991) or (${table.decision} = 'REJECTED' and ${table.approvedRefundLuna} = 0)`,
  ),
  check('claim_resolutions_valid_expiry', sql`${table.expiresAt} > ${table.createdAt}`),
  check(
    'claim_resolutions_verified_proof_complete',
    sql`${table.verificationStatus} <> 'verified' or (${table.publicKey} is not null and ${table.signature} is not null and ${table.signerAddress} = ${table.policySignerAddress} and ${table.verifierVersion} is not null and ${table.verifiedAt} is not null)`,
  ),
  check(
    'claim_resolutions_pending_proof_empty',
    sql`${table.verificationStatus} <> 'pending' or (${table.publicKey} is null and ${table.signature} is null and ${table.signerAddress} is null and ${table.verifierVersion} is null and ${table.verifiedAt} is null)`,
  ),
])

export const refundAttempts = pgTable('refund_attempts', {
  id: uuid('id').defaultRandom().primaryKey(),
  publicId: char('public_id', { length: 22 }).notNull(),
  claimId: uuid('claim_id').notNull(),
  claimPublicId: char('claim_public_id', { length: 22 }).notNull(),
  resolutionId: uuid('resolution_id').notNull(),
  passportId: uuid('passport_id').notNull(),
  merchantId: uuid('merchant_id').notNull(),
  network: varchar('network', { length: 24 }).notNull(),
  expectedSender: varchar('expected_sender', { length: 36 }).notNull(),
  expectedRecipient: varchar('expected_recipient', { length: 36 }).notNull(),
  expectedValueLuna: bigint('expected_value_luna', { mode: 'number' }).notNull(),
  expectedData: varchar('expected_data', { length: 64 }).notNull(),
  walletState: refundAttemptState('wallet_state').default('payment_requested').notNull(),
  transactionHash: char('transaction_hash', { length: 64 }),
  failureCode: varchar('failure_code', { length: 50 }),
  recipientRule: varchar('recipient_rule', { length: 24 }).default('purchase-sender-v1').notNull(),
  claimKeyId: uuid('claim_key_id').references(() => purchaseClaimKeys.id, { onDelete: 'restrict' }),
  outcomeReferenceHeight: bigint('outcome_reference_height', { mode: 'number' }),
  outcomeRuledOutAt: timestamp('outcome_ruled_out_at', { withTimezone: true }),
  outcomeRuledOutHeight: bigint('outcome_ruled_out_height', { mode: 'number' }),
  rowVersion: integer('row_version').default(1).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique('refund_attempts_public_id_unique').on(table.publicId),
  unique('refund_attempts_id_claim_unique').on(table.id, table.claimId),
  unique('refund_attempts_id_resolution_unique').on(table.id, table.resolutionId),
  unique('refund_attempts_id_passport_unique').on(table.id, table.passportId),
  foreignKey({
    name: 'refund_attempts_claim_passport_fk',
    columns: [table.claimId, table.passportId],
    foreignColumns: [claims.id, claims.passportId],
  }).onDelete('restrict'),
  foreignKey({
    name: 'refund_attempts_resolution_claim_fk',
    columns: [table.resolutionId, table.claimId],
    foreignColumns: [claimResolutions.id, claimResolutions.claimId],
  }).onDelete('restrict'),
  foreignKey({
    name: 'refund_attempts_resolution_merchant_fk',
    columns: [table.resolutionId, table.merchantId],
    foreignColumns: [claimResolutions.id, claimResolutions.merchantId],
  }).onDelete('restrict'),
  foreignKey({
    name: 'refund_attempts_passport_merchant_fk',
    columns: [table.passportId, table.merchantId],
    foreignColumns: [purchasePassports.id, purchasePassports.merchantId],
  }).onDelete('restrict'),
  uniqueIndex('refund_attempts_one_open_per_claim')
    .on(table.claimId)
    .where(sql`${table.walletState} in ('payment_requested', 'wallet_request_started', 'submission_outcome_unknown', 'payment_verifying', 'payment_pending')`),
  index('refund_attempts_claim_created_index').on(table.claimId, table.createdAt),
  index('refund_attempts_state_updated_index').on(table.walletState, table.updatedAt),
  check('refund_attempts_public_id_format', sql`${table.publicId} ~ '^[A-Za-z0-9_-]{22}$'`),
  check('refund_attempts_claim_public_id_format', sql`${table.claimPublicId} ~ '^[A-Za-z0-9_-]{22}$'`),
  check('refund_attempts_network_not_blank', sql`btrim(${table.network}) <> ''`),
  check(
    'refund_attempts_address_format',
    sql`${table.expectedSender} ~ '^NQ[0-9A-HJ-NP-VXY]{34}$' and ${table.expectedRecipient} ~ '^NQ[0-9A-HJ-NP-VXY]{34}$'`,
  ),
  check(
    'refund_attempts_value_range',
    sql`${table.expectedValueLuna} > 0 and ${table.expectedValueLuna} <= 9007199254740991`,
  ),
  check('refund_attempts_data_binding', sql`${table.expectedData} = 'NR1:R:' || ${table.claimPublicId}`),
  check(
    'refund_attempts_hash_state',
    sql`(${table.transactionHash} is null and ${table.walletState} in ('payment_requested', 'wallet_request_started', 'payment_cancelled', 'submission_outcome_unknown')) or (${table.transactionHash} is not null and ${table.walletState} in ('payment_verifying', 'payment_pending', 'payment_failed', 'refunded'))`,
  ),
  check('refund_attempts_hash_format', sql`${table.transactionHash} is null or ${table.transactionHash} ~ '^[0-9a-f]{64}$'`),
  check(
    'refund_attempts_failure_state',
    sql`(${table.walletState} = 'payment_failed' and ${table.failureCode} is not null) or (${table.walletState} <> 'payment_failed' and ${table.failureCode} is null)`,
  ),
  check('refund_attempts_row_version_positive', sql`${table.rowVersion} > 0`),
  check(
    'refund_attempts_recipient_rule',
    sql`(${table.recipientRule} = 'purchase-sender-v1' and ${table.claimKeyId} is null) or (${table.recipientRule} = 'claim-key-v2' and ${table.claimKeyId} is not null)`,
  ),
  check(
    'refund_attempts_outcome_ruled_out',
    sql`(${table.outcomeRuledOutAt} is null and ${table.outcomeRuledOutHeight} is null) or (${table.outcomeRuledOutAt} is not null and ${table.outcomeReferenceHeight} is not null and ${table.outcomeRuledOutHeight} >= ${table.outcomeReferenceHeight} + 7800 and ${table.walletState} = 'payment_cancelled' and ${table.transactionHash} is null)`,
  ),
])

export const refundTransactions = pgTable('refund_transactions', {
  id: uuid('id').defaultRandom().primaryKey(),
  attemptId: uuid('attempt_id').notNull(),
  claimId: uuid('claim_id').notNull(),
  resolutionId: uuid('resolution_id').notNull(),
  passportId: uuid('passport_id').notNull(),
  chainTransactionId: uuid('chain_transaction_id').notNull().references(() => chainTransactions.id, { onDelete: 'restrict' }),
  verifiedAt: timestamp('verified_at', { withTimezone: true }).notNull(),
  confirmationPolicy: varchar('confirmation_policy', { length: 40 }).notNull(),
}, (table) => [
  unique('refund_transactions_attempt_unique').on(table.attemptId),
  unique('refund_transactions_claim_unique').on(table.claimId),
  unique('refund_transactions_resolution_unique').on(table.resolutionId),
  unique('refund_transactions_passport_unique').on(table.passportId),
  unique('refund_transactions_chain_unique').on(table.chainTransactionId),
  foreignKey({
    name: 'refund_transactions_attempt_claim_fk',
    columns: [table.attemptId, table.claimId],
    foreignColumns: [refundAttempts.id, refundAttempts.claimId],
  }).onDelete('restrict'),
  foreignKey({
    name: 'refund_transactions_attempt_resolution_fk',
    columns: [table.attemptId, table.resolutionId],
    foreignColumns: [refundAttempts.id, refundAttempts.resolutionId],
  }).onDelete('restrict'),
  foreignKey({
    name: 'refund_transactions_attempt_passport_fk',
    columns: [table.attemptId, table.passportId],
    foreignColumns: [refundAttempts.id, refundAttempts.passportId],
  }).onDelete('restrict'),
  check(
    'refund_transactions_confirmation_policy',
    sql`${table.confirmationPolicy} = 'albatross-next-macro-v1'`,
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
