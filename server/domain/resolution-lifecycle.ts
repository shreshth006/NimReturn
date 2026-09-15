import { randomBytes, randomUUID } from 'node:crypto'
import type postgres from 'postgres'
import { z } from 'zod'

import {
  hashProtocolPayload,
  normalizeNimiqAddress,
  verifyNimiqMessageSignature,
} from '../../src/lib/crypto/nimiq-signature.js'
import {
  buildResolutionMessage,
  resolutionDecisionSchema,
  resolutionPayloadSchema,
  resolutionReasonCodeSchema,
  type ResolutionPayload,
} from '../../src/lib/protocol/resolution.js'
import {
  type ResolutionProofFailureCode,
  verifyResolutionProof,
} from './resolution-proof.js'

const CHALLENGE_TTL_MS = 10 * 60 * 1_000
const publicTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{22}$/u)
const createInputSchema = z.object({
  claimPublicId: publicTokenSchema,
  decision: resolutionDecisionSchema,
  merchantPublicId: publicTokenSchema,
  note: z.string().max(2_048).optional().default(''),
  reasonCode: resolutionReasonCodeSchema,
}).strict()
const publishInputSchema = z.object({
  claimPublicId: publicTokenSchema,
  merchantPublicId: publicTokenSchema,
  proof: z.unknown(),
  resolutionPublicId: publicTokenSchema,
}).strict()

interface DatabaseNowRow { now: Date }

interface ClaimDecisionRow {
  approved_refund_luna: string | null
  claim_id: string
  claim_note: string
  claim_public_id: string
  claim_signer_address: string
  claim_time: Date
  claim_type: 'RETURN' | 'WARRANTY'
  eligibility_eligible: boolean
  eligibility_evaluated_at: Date
  merchant_id: string
  merchant_public_id: string
  order_price_luna: string
  passport_public_id: string
  policy_signer_address: string
  product_name: string
  purchase_sender_address: string
  reason_code: 'CHANGED_MIND' | 'DEFECTIVE' | 'NOT_AS_DESCRIBED' | 'OTHER'
  resolution_decision: 'APPROVED' | 'REJECTED' | null
  resolution_public_id: string | null
  resolution_status: 'expired' | 'pending' | 'verified' | null
  workflow_state: 'approved' | 'decision_pending' | 'eligible' | 'ineligible' | 'rejected'
}

interface ResolutionRow {
  approved_refund_luna: string
  canonical_message: string
  challenge_nonce: string
  claim_id: string
  claim_public_id: string
  created_at: Date
  decision: 'APPROVED' | 'REJECTED'
  expires_at: Date
  id: string
  merchant_id: string
  merchant_public_id: string
  note: string
  payload: unknown
  payload_hash: string
  policy_signer_address: string
  public_id: string
  public_key: string | null
  reason_code: 'INSUFFICIENT_INFORMATION' | 'OTHER' | 'POLICY_ACCEPTED' | 'POLICY_NOT_APPLICABLE'
  resolution_time: Date
  signature: string | null
  signer_address: string | null
  verification_status: 'expired' | 'pending' | 'verified'
  verified_at: Date | null
  verifier_version: string | null
}

export type ResolutionLifecycleErrorCode =
  | ResolutionProofFailureCode
  | 'CLAIM_NOT_FOUND'
  | 'EVIDENCE_INTEGRITY'
  | 'INVALID_REQUEST'
  | 'MERCHANT_AUTHORITY_UNAVAILABLE'
  | 'PERSISTENCE_CONFLICT'
  | 'RESOLUTION_NOT_FOUND'
  | 'STATE_CONFLICT'

export class ResolutionLifecycleError extends Error {
  readonly code: ResolutionLifecycleErrorCode

  constructor(code: ResolutionLifecycleErrorCode, message: string) {
    super(message)
    this.name = 'ResolutionLifecycleError'
    this.code = code
  }
}

export interface ResolutionView {
  approvedRefundLuna: number
  canonicalMessage: string
  claimPublicId: string
  createdAt: Date
  decision: 'APPROVED' | 'REJECTED'
  expiresAt: Date
  note: string
  payloadHash: string
  policySignerAddress: string
  publicId: string
  reasonCode: 'INSUFFICIENT_INFORMATION' | 'OTHER' | 'POLICY_ACCEPTED' | 'POLICY_NOT_APPLICABLE'
  resolutionTime: Date
  signerAddress: string | null
  status: 'expired' | 'pending' | 'verified'
  verifiedAt: Date | null
}

export interface MerchantClaimQueueItem {
  claim: {
    claimSignerAddress: string
    claimTime: Date
    claimType: 'RETURN' | 'WARRANTY'
    eligibility: 'eligible' | 'ineligible'
    note: string
    publicId: string
    purchaseSenderAddress: string
    reasonCode: 'CHANGED_MIND' | 'DEFECTIVE' | 'NOT_AS_DESCRIBED' | 'OTHER'
    workflowState: ClaimDecisionRow['workflow_state']
  }
  passportPublicId: string
  productName: string
  resolution: null | {
    decision: 'APPROVED' | 'REJECTED'
    publicId: string
    status: 'expired' | 'pending' | 'verified'
  }
}

function fail(code: ResolutionLifecycleErrorCode, message: string): never {
  throw new ResolutionLifecycleError(code, message)
}

function requireOne<T>(rows: T[], code: ResolutionLifecycleErrorCode, message: string): T {
  const row = rows[0]
  if (!row) fail(code, message)
  return row
}

function token(): string {
  return randomBytes(16).toString('base64url')
}

function parseLuna(value: string): number {
  if (!/^(0|[1-9][0-9]*)$/u.test(value)) fail('EVIDENCE_INTEGRITY', 'Stored resolution money is invalid.')
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) fail('EVIDENCE_INTEGRITY', 'Stored resolution money is unsafe.')
  return parsed
}

function normalizeNote(raw: string): string {
  const value = raw.trim().normalize('NFC')
  const parsed = resolutionPayloadSchema.shape.note.safeParse(value)
  if (!parsed.success) fail('INVALID_REQUEST', 'The resolution note is invalid.')
  return parsed.data
}

function projectResolution(row: ResolutionRow): ResolutionView {
  const payload = resolutionPayloadSchema.safeParse(row.payload)
  if (!payload.success) fail('EVIDENCE_INTEGRITY', 'Stored resolution payload is invalid.')
  const expectedMessage = buildResolutionMessage(payload.data)
  const expectedHash = hashProtocolPayload(expectedMessage)
  const approvedRefundLuna = parseLuna(row.approved_refund_luna)
  if (
    row.canonical_message !== expectedMessage
    || row.payload_hash !== expectedHash
    || payload.data.claimId !== row.claim_public_id
    || payload.data.createdAt !== row.resolution_time.getTime()
    || payload.data.nonce !== row.challenge_nonce
    || payload.data.policySignerAddress !== row.policy_signer_address
    || payload.data.decision !== row.decision
    || payload.data.reasonCode !== row.reason_code
    || payload.data.note !== row.note
    || payload.data.approvedRefundLuna !== approvedRefundLuna
  ) {
    fail('EVIDENCE_INTEGRITY', 'Stored resolution columns do not match the canonical payload.')
  }
  if (row.verification_status === 'verified') {
    if (!row.public_key || !row.signature || !row.signer_address || !row.verified_at || !row.verifier_version) {
      fail('EVIDENCE_INTEGRITY', 'Stored verified resolution proof is incomplete.')
    }
    const proof = verifyNimiqMessageSignature({
      message: expectedMessage,
      publicKey: row.public_key,
      signature: row.signature,
    })
    if (
      !proof.signatureValid
      || !proof.actualSignerAddress
      || normalizeNimiqAddress(proof.actualSignerAddress) !== row.policy_signer_address
      || row.signer_address !== row.policy_signer_address
      || proof.payloadHash !== expectedHash
    ) fail('EVIDENCE_INTEGRITY', 'Stored resolution signature evidence is invalid.')
  }
  return {
    approvedRefundLuna,
    canonicalMessage: row.canonical_message,
    claimPublicId: row.claim_public_id,
    createdAt: row.created_at,
    decision: row.decision,
    expiresAt: row.expires_at,
    note: row.note,
    payloadHash: row.payload_hash,
    policySignerAddress: row.policy_signer_address,
    publicId: row.public_id,
    reasonCode: row.reason_code,
    resolutionTime: row.resolution_time,
    signerAddress: row.signer_address,
    status: row.verification_status,
    verifiedAt: row.verified_at,
  }
}

async function readResolution(
  client: postgres.Sql | postgres.TransactionSql,
  claimPublicId: string,
  resolutionPublicId?: string,
  lock = false,
): Promise<ResolutionRow | null> {
  const rows = await client<ResolutionRow[]>`
    select
      claim_resolutions.*, claims.public_id as claim_public_id,
      merchants.public_id as merchant_public_id
    from claim_resolutions
    join claims on claims.id = claim_resolutions.claim_id
    join merchants on merchants.id = claim_resolutions.merchant_id
    where claims.public_id = ${claimPublicId}
      ${resolutionPublicId ? client`and claim_resolutions.public_id = ${resolutionPublicId}` : client``}
    order by
      (claim_resolutions.verification_status = 'verified') desc,
      claim_resolutions.created_at desc
    limit 1
    ${lock ? client.unsafe('for update of claim_resolutions') : client.unsafe('')}
  `
  return rows[0] ?? null
}

async function readDecisionClaim(
  client: postgres.Sql | postgres.TransactionSql,
  merchantPublicId: string,
  claimPublicId: string,
  lock = false,
): Promise<ClaimDecisionRow | null> {
  const rows = await client<ClaimDecisionRow[]>`
    select
      claims.id as claim_id, claims.public_id as claim_public_id,
      claims.claim_type, claims.reason_code, claims.note as claim_note,
      claims.claim_time, claims.claim_signer_address, claims.purchase_sender_address,
      claims.workflow_state, merchants.id as merchant_id,
      merchants.public_id as merchant_public_id, merchants.policy_signer_address,
      purchase_passports.public_id as passport_public_id,
      purchase_passports.product_name, orders.expected_value_luna::text as order_price_luna,
      claim_eligibility_evaluations.eligible as eligibility_eligible,
      claim_eligibility_evaluations.evaluated_at as eligibility_evaluated_at,
      current_resolution.public_id as resolution_public_id,
      current_resolution.verification_status as resolution_status,
      current_resolution.decision as resolution_decision,
      current_resolution.approved_refund_luna::text as approved_refund_luna
    from claims
    join merchants on merchants.id = claims.merchant_id
    join purchase_passports on purchase_passports.id = claims.passport_id
    join orders on orders.id = claims.order_id
    join claim_eligibility_evaluations
      on claim_eligibility_evaluations.claim_id = claims.id
      and claim_eligibility_evaluations.supersedes_id is null
    left join lateral (
      select * from claim_resolutions
      where claim_resolutions.claim_id = claims.id
      order by (verification_status = 'verified') desc, created_at desc
      limit 1
    ) current_resolution on true
    where merchants.public_id = ${merchantPublicId}
      and claims.public_id = ${claimPublicId}
    ${lock ? client.unsafe('for update of claims') : client.unsafe('')}
  `
  return rows[0] ?? null
}

export async function createResolutionChallenge(
  client: postgres.Sql,
  rawInput: unknown,
): Promise<ResolutionView> {
  const parsed = createInputSchema.safeParse(rawInput)
  if (!parsed.success) fail('INVALID_REQUEST', 'The resolution request is invalid.')
  const input = parsed.data
  const note = normalizeNote(input.note)

  return client.begin(async (transaction) => {
    const claim = await readDecisionClaim(
      transaction,
      input.merchantPublicId,
      input.claimPublicId,
      true,
    )
    if (!claim) fail('CLAIM_NOT_FOUND', 'The authorized claim was not found for this merchant.')
    if (!claim.policy_signer_address || !claim.claim_signer_address) {
      fail('MERCHANT_AUTHORITY_UNAVAILABLE', 'Merchant or claimant authority is unavailable.')
    }
    if (!['eligible', 'ineligible', 'decision_pending'].includes(claim.workflow_state)) {
      fail('STATE_CONFLICT', 'The claim cannot accept a resolution challenge.')
    }
    if (claim.resolution_status === 'verified') {
      const existing = await readResolution(transaction, input.claimPublicId, claim.resolution_public_id ?? undefined)
      if (!existing) fail('EVIDENCE_INTEGRITY', 'The final resolution could not be read.')
      if (
        existing.decision === input.decision
        && existing.reason_code === input.reasonCode
        && existing.note === note
      ) return projectResolution(existing)
      fail('STATE_CONFLICT', 'A conflicting final resolution already exists.')
    }

    const databaseNow = requireOne(
      await transaction<DatabaseNowRow[]>`select clock_timestamp() as now`,
      'PERSISTENCE_CONFLICT',
      'The database clock was unavailable.',
    ).now
    if (claim.resolution_status === 'pending' && claim.resolution_public_id) {
      const existing = await readResolution(transaction, input.claimPublicId, claim.resolution_public_id, true)
      if (!existing) fail('EVIDENCE_INTEGRITY', 'The pending resolution could not be read.')
      if (databaseNow < existing.expires_at) {
        if (
          existing.decision === input.decision
          && existing.reason_code === input.reasonCode
          && existing.note === note
        ) return projectResolution(existing)
        fail('STATE_CONFLICT', 'A different resolution challenge is already pending.')
      }
      await transaction`
        update claim_resolutions set verification_status = 'expired'
        where id = ${existing.id} and verification_status = 'pending'
      `
    }

    if (claim.workflow_state !== 'decision_pending') {
      const moved = await transaction<{ id: string }[]>`
        update claims set workflow_state = 'decision_pending'
        where id = ${claim.claim_id} and workflow_state in ('eligible', 'ineligible')
        returning id
      `
      if (moved.length !== 1) fail('STATE_CONFLICT', 'The claim changed during resolution creation.')
    }

    const approvedRefundLuna = input.decision === 'APPROVED'
      ? parseLuna(claim.order_price_luna)
      : 0
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const publicId = token()
      const nonce = token()
      const expiresAt = new Date(databaseNow.getTime() + CHALLENGE_TTL_MS)
      const payload: ResolutionPayload = {
        approvedRefundLuna,
        claimId: input.claimPublicId,
        createdAt: databaseNow.getTime(),
        decision: input.decision,
        nonce,
        note,
        policySignerAddress: claim.policy_signer_address,
        protocol: 'NR1',
        reasonCode: input.reasonCode,
        type: 'RESOLUTION',
      }
      const canonicalMessage = buildResolutionMessage(payload)
      const payloadHash = hashProtocolPayload(canonicalMessage)
      const rows = await transaction<{ id: string }[]>`
        insert into claim_resolutions (
          public_id, claim_id, merchant_id, policy_signer_address,
          decision, reason_code, note, approved_refund_luna, resolution_time,
          challenge_nonce, payload, canonical_message, payload_hash,
          expires_at, created_at
        ) values (
          ${publicId}, ${claim.claim_id}, ${claim.merchant_id}, ${claim.policy_signer_address},
          ${input.decision}, ${input.reasonCode}, ${note}, ${approvedRefundLuna},
          ${databaseNow}, ${nonce}, ${transaction.json(payload)}, ${canonicalMessage},
          ${payloadHash}, ${expiresAt}, ${databaseNow}
        ) on conflict do nothing returning id
      `
      if (rows.length === 1) {
        const created = await readResolution(transaction, input.claimPublicId, publicId)
        if (!created) fail('PERSISTENCE_CONFLICT', 'The resolution challenge could not be read back.')
        return projectResolution(created)
      }
    }
    fail('PERSISTENCE_CONFLICT', 'A unique resolution challenge could not be allocated.')
  })
}

export async function publishResolution(
  client: postgres.Sql,
  rawInput: unknown,
): Promise<ResolutionView> {
  const parsed = publishInputSchema.safeParse(rawInput)
  if (!parsed.success) fail('INVALID_REQUEST', 'The resolution proof submission is invalid.')
  const input = parsed.data

  return client.begin(async (transaction) => {
    const claim = await readDecisionClaim(transaction, input.merchantPublicId, input.claimPublicId, true)
    if (!claim) fail('CLAIM_NOT_FOUND', 'The claim was not found for this merchant.')
    const resolution = await readResolution(
      transaction,
      input.claimPublicId,
      input.resolutionPublicId,
      true,
    )
    if (!resolution) fail('RESOLUTION_NOT_FOUND', 'The resolution challenge was not found.')
    if (resolution.verification_status === 'verified') {
      const proof = input.proof as Record<string, unknown>
      if (
        proof.canonicalMessage === resolution.canonical_message
        && proof.payloadHash === resolution.payload_hash
        && proof.publicKey === resolution.public_key
        && proof.signature === resolution.signature
      ) return projectResolution(resolution)
      fail('STATE_CONFLICT', 'A different final resolution already exists.')
    }
    if (resolution.verification_status !== 'pending' || claim.workflow_state !== 'decision_pending') {
      fail('STATE_CONFLICT', 'The resolution challenge is no longer pending.')
    }
    const databaseNow = requireOne(
      await transaction<DatabaseNowRow[]>`select clock_timestamp() as now`,
      'PERSISTENCE_CONFLICT',
      'The database clock was unavailable.',
    ).now
    const proof = verifyResolutionProof({
      challenge: {
        canonicalMessage: resolution.canonical_message,
        consumedAt: null,
        expectedSignerAddress: resolution.policy_signer_address,
        expiresAt: resolution.expires_at,
        payload: resolution.payload,
        payloadHash: resolution.payload_hash,
      },
      now: databaseNow,
      proof: input.proof,
    })
    if (!proof.valid) fail(proof.code, proof.message)
    const verified = await transaction<{ id: string }[]>`
      update claim_resolutions set
        public_key = ${proof.publicKey}, signature = ${proof.signature},
        signer_address = ${proof.actualSignerAddress}, verifier_version = ${proof.verifierVersion},
        verification_status = 'verified', verified_at = ${databaseNow}
      where id = ${resolution.id} and verification_status = 'pending'
        and expires_at > ${databaseNow}
      returning id
    `
    if (verified.length !== 1) fail('STATE_CONFLICT', 'The resolution lost a concurrent race.')
    const state = resolution.decision === 'APPROVED' ? 'approved' : 'rejected'
    const decided = await transaction<{ id: string }[]>`
      update claims set workflow_state = ${state}
      where id = ${claim.claim_id} and workflow_state = 'decision_pending'
      returning id
    `
    if (decided.length !== 1) fail('STATE_CONFLICT', 'The claim decision lost a concurrent race.')
    await transaction`
      insert into protocol_events (
        aggregate_type, aggregate_id, event_type, protocol_version, occurred_at,
        actor_address, correlation_id, evidence_type, evidence_id, payload
      ) values (
        'claim', ${claim.claim_id}, ${`claim.${state}`}, 'NR1', ${databaseNow},
        ${proof.actualSignerAddress}, ${randomUUID()}, 'signature', ${resolution.id},
        ${transaction.json({
          approvedRefundLuna: parseLuna(resolution.approved_refund_luna),
          decision: resolution.decision,
        })}
      )
    `
    const result = await readResolution(transaction, input.claimPublicId, input.resolutionPublicId)
    if (!result) fail('PERSISTENCE_CONFLICT', 'The final resolution could not be read back.')
    return projectResolution(result)
  })
}

export async function getClaimResolution(
  client: postgres.Sql | postgres.TransactionSql,
  rawClaimPublicId: unknown,
): Promise<ResolutionView | null> {
  const parsed = publicTokenSchema.safeParse(rawClaimPublicId)
  if (!parsed.success) fail('INVALID_REQUEST', 'The claim identifier is invalid.')
  const row = await readResolution(client, parsed.data)
  return row ? projectResolution(row) : null
}

export async function listMerchantClaims(
  client: postgres.Sql | postgres.TransactionSql,
  rawMerchantPublicId: unknown,
): Promise<MerchantClaimQueueItem[]> {
  const parsed = publicTokenSchema.safeParse(rawMerchantPublicId)
  if (!parsed.success) fail('INVALID_REQUEST', 'The merchant identifier is invalid.')
  const rows = await client<ClaimDecisionRow[]>`
    select
      claims.id as claim_id, claims.public_id as claim_public_id,
      claims.claim_type, claims.reason_code, claims.note as claim_note,
      claims.claim_time, claims.claim_signer_address, claims.purchase_sender_address,
      claims.workflow_state, merchants.id as merchant_id,
      merchants.public_id as merchant_public_id, merchants.policy_signer_address,
      purchase_passports.public_id as passport_public_id,
      purchase_passports.product_name, orders.expected_value_luna::text as order_price_luna,
      claim_eligibility_evaluations.eligible as eligibility_eligible,
      claim_eligibility_evaluations.evaluated_at as eligibility_evaluated_at,
      current_resolution.public_id as resolution_public_id,
      current_resolution.verification_status as resolution_status,
      current_resolution.decision as resolution_decision,
      current_resolution.approved_refund_luna::text as approved_refund_luna
    from claims
    join merchants on merchants.id = claims.merchant_id
    join purchase_passports on purchase_passports.id = claims.passport_id
    join orders on orders.id = claims.order_id
    join claim_eligibility_evaluations
      on claim_eligibility_evaluations.claim_id = claims.id
      and claim_eligibility_evaluations.supersedes_id is null
    left join lateral (
      select * from claim_resolutions
      where claim_resolutions.claim_id = claims.id
      order by (verification_status = 'verified') desc, created_at desc
      limit 1
    ) current_resolution on true
    where merchants.public_id = ${parsed.data}
      and claims.workflow_state in ('eligible', 'ineligible', 'decision_pending', 'approved', 'rejected')
    order by claims.claim_time asc, claims.id asc
    limit 100
  `
  return rows.map((row) => {
    if (!row.claim_signer_address || !row.policy_signer_address) {
      fail('EVIDENCE_INTEGRITY', 'Merchant claim queue contains incomplete authority evidence.')
    }
    return {
      claim: {
        claimSignerAddress: row.claim_signer_address,
        claimTime: row.claim_time,
        claimType: row.claim_type,
        eligibility: row.eligibility_eligible ? 'eligible' : 'ineligible',
        note: row.claim_note,
        publicId: row.claim_public_id,
        purchaseSenderAddress: row.purchase_sender_address,
        reasonCode: row.reason_code,
        workflowState: row.workflow_state,
      },
      passportPublicId: row.passport_public_id,
      productName: row.product_name,
      resolution: row.resolution_public_id && row.resolution_decision && row.resolution_status
        ? {
            decision: row.resolution_decision,
            publicId: row.resolution_public_id,
            status: row.resolution_status,
          }
        : null,
    }
  })
}
