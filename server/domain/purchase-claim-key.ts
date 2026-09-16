import { randomBytes } from 'node:crypto'
import type postgres from 'postgres'
import { z } from 'zod'

import { hashProtocolPayload } from '../../src/lib/crypto/nimiq-signature.js'
import {
  buildPurchaseClaimKeyMessage,
  type PurchaseClaimKeyPayload,
} from '../../src/lib/protocol/claim.js'
import { verifyClaimProof } from './claim-proof.js'
import { getPurchaseOrder } from './get-purchase-order.js'
import { PurchaseOrderError, type PurchaseOrderView } from './purchase-order.js'

const CLAIM_KEY_TTL_MS = 10 * 60 * 1000
// Reissue instead of returning a challenge too close to expiry to be signed on a phone.
const CLAIM_KEY_MIN_REUSE_MS = 60 * 1000
const publicTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{22}$/u)

const submitInputSchema = z.object({
  nonce: publicTokenSchema,
  orderPublicId: publicTokenSchema,
  proof: z.unknown(),
}).strict()

interface LockedOrderRow {
  expected_data: string
  expected_recipient: string
  expected_value_luna: string
  expires_at: Date
  id: string
  network: string
  payment_state: string
  policy_payload_hash: string
  public_id: string
}

interface ClaimKeyRow {
  canonical_message: string
  expires_at: Date
  id: string
  payload: unknown
  payload_hash: string
  verified_at: Date | null
}

function fail(code: ConstructorParameters<typeof PurchaseOrderError>[0], message: string): never {
  throw new PurchaseOrderError(code, message)
}

async function databaseNow(transaction: postgres.TransactionSql): Promise<Date> {
  const rows = await transaction<{ now: Date }[]>`select clock_timestamp() as now`
  const now = rows[0]?.now
  if (!now) fail('PERSISTENCE_CONFLICT', 'The database clock was unavailable.')
  return now
}

async function lockUnpaidOrder(
  transaction: postgres.TransactionSql,
  orderPublicId: string,
  now: Date,
): Promise<LockedOrderRow> {
  const rows = await transaction<LockedOrderRow[]>`
    select id, public_id, payment_state, expires_at, expected_data, expected_recipient,
      expected_value_luna::text, network, policy_payload_hash
    from orders
    where public_id = ${orderPublicId}
    for update
  `
  const order = rows[0]
  if (!order) fail('ORDER_NOT_FOUND', 'The purchase was not found.')
  if (order.expires_at <= now) fail('ORDER_EXPIRED', 'The purchase expired. Start a new order.')
  if (order.payment_state !== 'payment_requested') {
    fail('STATE_CONFLICT', 'A claim key can only be bound before payment is requested.')
  }
  return order
}

async function readView(
  transaction: postgres.TransactionSql,
  orderPublicId: string,
): Promise<PurchaseOrderView> {
  const view = await getPurchaseOrder(transaction, orderPublicId)
  if (!view) fail('PERSISTENCE_CONFLICT', 'The purchase disappeared.')
  return view
}

export async function createPurchaseClaimKeyChallenge(
  client: postgres.Sql,
  rawOrderPublicId: unknown,
): Promise<PurchaseOrderView> {
  const parsed = publicTokenSchema.safeParse(rawOrderPublicId)
  if (!parsed.success) fail('INVALID_REQUEST', 'The purchase identifier is invalid.')

  return client.begin(async (transaction) => {
    const now = await databaseNow(transaction)
    const order = await lockUnpaidOrder(transaction, parsed.data, now)
    const reusable = await transaction<{ id: string }[]>`
      select id from purchase_claim_keys
      where order_id = ${order.id}
        and (
          verified_at is not null
          or expires_at > ${new Date(now.getTime() + CLAIM_KEY_MIN_REUSE_MS)}
        )
      limit 1
    `
    if (reusable.length === 0) {
      const expiresAt = new Date(Math.min(now.getTime() + CLAIM_KEY_TTL_MS, order.expires_at.getTime()))
      if (expiresAt.getTime() - now.getTime() < CLAIM_KEY_MIN_REUSE_MS) {
        fail('ORDER_EXPIRED', 'The purchase is about to expire. Start a new order.')
      }
      const nonce = randomBytes(16).toString('base64url')
      const payload: PurchaseClaimKeyPayload = {
        createdAt: now.getTime(),
        expiresAt: expiresAt.getTime(),
        network: order.network,
        nonce,
        orderId: order.public_id,
        paymentData: order.expected_data,
        policyPayloadHash: order.policy_payload_hash,
        protocol: 'NR1',
        recipient: order.expected_recipient,
        type: 'PURCHASE_CLAIM_KEY',
        valueLuna: Number(order.expected_value_luna),
      }
      const canonicalMessage = buildPurchaseClaimKeyMessage(payload)
      await transaction`
        insert into purchase_claim_keys (
          order_id, nonce, payload, canonical_message, payload_hash, expires_at, created_at
        ) values (
          ${order.id}, ${nonce}, ${transaction.json(payload)}, ${canonicalMessage},
          ${hashProtocolPayload(canonicalMessage)}, ${expiresAt}, ${now}
        )
      `
    }
    return readView(transaction, parsed.data)
  })
}

export async function submitPurchaseClaimKeyProof(
  client: postgres.Sql,
  rawInput: unknown,
): Promise<PurchaseOrderView> {
  const parsed = submitInputSchema.safeParse(rawInput)
  if (!parsed.success) fail('INVALID_REQUEST', 'The claim key proof is invalid.')
  const input = parsed.data

  return client.begin(async (transaction) => {
    const now = await databaseNow(transaction)
    const order = await lockUnpaidOrder(transaction, input.orderPublicId, now)
    const rows = await transaction<ClaimKeyRow[]>`
      select id, payload, canonical_message, payload_hash, expires_at, verified_at
      from purchase_claim_keys
      where order_id = ${order.id} and nonce = ${input.nonce}
      for update
    `
    const key = rows[0]
    if (!key) fail('ORDER_NOT_FOUND', 'The claim key challenge was not found.')
    if (key.verified_at) fail('STATE_CONFLICT', 'This purchase already has a verified claim key.')

    const proof = verifyClaimProof({
      challenge: {
        action: 'PURCHASE_CLAIM_KEY',
        canonicalMessage: key.canonical_message,
        consumedAt: null,
        expectedSignerAddress: null,
        expiresAt: key.expires_at,
        payload: key.payload,
        payloadHash: key.payload_hash,
      },
      now,
      proof: input.proof,
    })
    if (!proof.valid) {
      fail('CLAIM_KEY_INVALID', proof.code === 'CHALLENGE_EXPIRED'
        ? 'The claim key request expired. Request a fresh one.'
        : 'The claim key signature did not verify.')
    }
    await transaction`
      update purchase_claim_keys set
        signer_address = ${proof.actualSignerAddress}, public_key = ${proof.publicKey},
        signature = ${proof.signature}, verifier_version = ${proof.verifierVersion},
        verified_at = ${now}
      where id = ${key.id} and verified_at is null
    `
    return readView(transaction, input.orderPublicId)
  })
}
