import { sql } from 'drizzle-orm'
import {
  char,
  check,
  index,
  pgEnum,
  pgTable,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'

export const merchantStatus = pgEnum('merchant_status', ['active', 'disabled'])

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
