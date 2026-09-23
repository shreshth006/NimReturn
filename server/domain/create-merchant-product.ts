import { randomBytes } from 'node:crypto'
import type postgres from 'postgres'
import { z } from 'zod'

/**
 * Adds another product to a merchant that already exists.
 *
 * A merchant identity is one wallet (enforced by a unique index on the policy signer),
 * so creating a product by creating a merchant means one wallet can only ever sell one
 * thing. A merchant sells many things, and may sell them on different chains: a testnet
 * product for people trying the app, a mainnet product for real buyers.
 */
const createMerchantProductInputSchema = z.object({
  description: z.string().max(2_048).optional().default(''),
  merchantPublicId: z.string().regex(/^[A-Za-z0-9_-]{22}$/u),
  // The chain this product sells on; the caller has already checked it is verifiable.
  network: z.string().min(1).max(24),
  productName: z.string().min(1).max(512),
}).strict()

const UTF8_ENCODER = new TextEncoder()

interface DatabaseNowRow {
  now: Date
}

export type MerchantProductCreationErrorCode =
  | 'INVALID_REQUEST'
  | 'MERCHANT_NOT_FOUND'
  | 'PERSISTENCE_CONFLICT'

export interface CreatedMerchantProduct {
  merchantPublicId: string
  network: string
  productName: string
  productPublicId: string
}

export class MerchantProductCreationError extends Error {
  readonly code: MerchantProductCreationErrorCode

  constructor(code: MerchantProductCreationErrorCode, message: string) {
    super(message)
    this.name = 'MerchantProductCreationError'
    this.code = code
  }
}

function fail(code: MerchantProductCreationErrorCode, message: string): never {
  throw new MerchantProductCreationError(code, message)
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
    fail('INVALID_REQUEST', 'Product text is invalid.')
  }
  return value
}

export async function createMerchantProduct(
  client: postgres.Sql,
  rawInput: unknown,
): Promise<CreatedMerchantProduct> {
  const parsed = createMerchantProductInputSchema.safeParse(rawInput)
  if (!parsed.success) fail('INVALID_REQUEST', 'The product request is invalid.')
  const input = parsed.data

  const productName = normalizeText({
    allowEmpty: false, maxBytes: 256, maxCodePoints: 100, value: input.productName,
  })
  const description = normalizeText({
    allowEmpty: true, maxBytes: 2_048, maxCodePoints: 500, value: input.description,
  })

  return client.begin(async (transaction) => {
    const [merchant] = await transaction<{ id: string }[]>`
      select id from merchants where public_id = ${input.merchantPublicId}
    `
    if (!merchant) fail('MERCHANT_NOT_FOUND', 'The merchant was not found.')

    const [now] = await transaction<DatabaseNowRow[]>`select clock_timestamp() as now`
    if (!now) fail('PERSISTENCE_CONFLICT', 'The database clock was unavailable.')

    let created: { id: string } | undefined
    let productPublicId = ''
    for (let attempt = 0; attempt < 3 && !created; attempt += 1) {
      productPublicId = randomBytes(16).toString('base64url')
      const rows = await transaction<{ id: string }[]>`
        insert into products (
          public_id, merchant_id, name, description, network, created_at, updated_at
        ) values (
          ${productPublicId}, ${merchant.id}, ${productName}, ${description}, ${input.network},
          ${now.now}, ${now.now}
        )
        on conflict (public_id) do nothing
        returning id
      `
      created = rows[0]
    }
    if (!created) fail('PERSISTENCE_CONFLICT', 'A unique product identifier could not be allocated.')

    return {
      merchantPublicId: input.merchantPublicId,
      network: input.network,
      productName,
      productPublicId,
    }
  })
}
