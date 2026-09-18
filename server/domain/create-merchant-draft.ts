import { randomBytes, randomUUID } from 'node:crypto'
import type postgres from 'postgres'
import { z } from 'zod'

import { normalizeNimiqAddress } from '../../src/lib/crypto/nimiq-signature.js'
import { issueMerchantBootstrapCapability } from './merchant-bootstrap.js'

const BOOTSTRAP_TTL_MS = 15 * 60 * 1000
const UTF8_ENCODER = new TextEncoder()

const createMerchantDraftInputSchema = z.object({
  defaultSettlementAddress: z.string().min(1).max(64),
  description: z.string().max(2_048).optional().default(''),
  displayName: z.string().min(1).max(512),
  // The chain this product sells on, taken from the merchant's wallet at draft time.
  network: z.string().min(1).max(24).default('TestAlbatross'),
  productName: z.string().min(1).max(512),
}).strict()

interface DatabaseNowRow {
  now: Date
}

export type MerchantDraftCreationErrorCode = 'INVALID_REQUEST' | 'PERSISTENCE_CONFLICT'

export interface CreatedMerchantDraft {
  bootstrapCapability: string
  bootstrapExpiresAt: Date
  displayName: string
  merchantPublicId: string
  productName: string
  productPublicId: string
}

export class MerchantDraftCreationError extends Error {
  readonly code: MerchantDraftCreationErrorCode

  constructor(code: MerchantDraftCreationErrorCode, message: string) {
    super(message)
    this.name = 'MerchantDraftCreationError'
    this.code = code
  }
}

function fail(code: MerchantDraftCreationErrorCode, message: string): never {
  throw new MerchantDraftCreationError(code, message)
}

function requireOne<T>(rows: T[], message: string): T {
  const row = rows[0]
  if (!row) fail('PERSISTENCE_CONFLICT', message)
  return row
}

function normalizeText(input: {
  allowEmpty: boolean
  maxBytes: number
  maxCodePoints: number
  value: string
}): string {
  const value = input.value.trim().normalize('NFC')
  const codePoints = Array.from(value)
  const containsControlCharacter = codePoints.some((character) => {
    const point = character.codePointAt(0)
    return point !== undefined && (point <= 0x1f || (point >= 0x7f && point <= 0x9f))
  })
  if (
    (!input.allowEmpty && codePoints.length === 0)
    || codePoints.length > input.maxCodePoints
    || UTF8_ENCODER.encode(value).byteLength > input.maxBytes
    || containsControlCharacter
  ) {
    fail('INVALID_REQUEST', 'Merchant draft text is invalid.')
  }
  return value
}

function generatePublicToken(): string {
  return randomBytes(16).toString('base64url')
}

export async function createMerchantDraft(
  client: postgres.Sql,
  rawInput: unknown,
): Promise<CreatedMerchantDraft> {
  const inputResult = createMerchantDraftInputSchema.safeParse(rawInput)
  if (!inputResult.success) fail('INVALID_REQUEST', 'The merchant draft is invalid.')
  const input = inputResult.data

  let defaultSettlementAddress: string
  try {
    defaultSettlementAddress = normalizeNimiqAddress(input.defaultSettlementAddress)
  } catch {
    fail('INVALID_REQUEST', 'The default settlement address is invalid.')
  }
  const displayName = normalizeText({
    allowEmpty: false,
    maxBytes: 256,
    maxCodePoints: 80,
    value: input.displayName,
  })
  const productName = normalizeText({
    allowEmpty: false,
    maxBytes: 256,
    maxCodePoints: 100,
    value: input.productName,
  })
  const description = normalizeText({
    allowEmpty: true,
    maxBytes: 2_048,
    maxCodePoints: 500,
    value: input.description,
  })
  const merchantPublicId = generatePublicToken()
  const productPublicId = generatePublicToken()
  const bootstrap = issueMerchantBootstrapCapability()

  return client.begin(async (transaction) => {
    const databaseNow = requireOne(
      await transaction<DatabaseNowRow[]>`select clock_timestamp() as now`,
      'The database clock was unavailable.',
    ).now
    const bootstrapExpiresAt = new Date(databaseNow.getTime() + BOOTSTRAP_TTL_MS)
    const merchant = requireOne(
      await transaction<{ id: string }[]>`
        insert into merchants (
          public_id, default_settlement_address, display_name, created_at, updated_at
        ) values (
          ${merchantPublicId}, ${defaultSettlementAddress}, ${displayName},
          ${databaseNow}, ${databaseNow}
        )
        returning id
      `,
      'The merchant draft could not be stored.',
    )
    const product = requireOne(
      await transaction<{ id: string }[]>`
        insert into products (
          public_id, merchant_id, name, description, network, created_at, updated_at
        ) values (
          ${productPublicId}, ${merchant.id}, ${productName}, ${description}, ${input.network},
          ${databaseNow}, ${databaseNow}
        )
        returning id
      `,
      'The product draft could not be stored.',
    )
    await transaction`
      insert into merchant_bootstrap_sessions (
        merchant_id, capability_hash, expires_at, created_at
      ) values (
        ${merchant.id}, ${bootstrap.capabilityHash}, ${bootstrapExpiresAt}, ${databaseNow}
      )
    `
    await transaction`
      insert into protocol_events (
        aggregate_type, aggregate_id, event_type, protocol_version, occurred_at,
        correlation_id, evidence_type, payload
      ) values (
        'merchant', ${merchant.id}, 'merchant.draft-created', 'NR1', ${databaseNow},
        ${randomUUID()}, 'backend',
        ${transaction.json({ productId: product.id })}
      )
    `

    return {
      bootstrapCapability: bootstrap.capability,
      bootstrapExpiresAt,
      displayName,
      merchantPublicId,
      productName,
      productPublicId,
    }
  })
}
