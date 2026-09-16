import { randomBytes, randomUUID } from 'node:crypto'
import type postgres from 'postgres'
import { z } from 'zod'

import {
  hashProtocolPayload,
  normalizeNimiqAddress,
  verifyNimiqMessageSignature,
} from '../../src/lib/crypto/nimiq-signature.js'
import {
  buildClaimAuthorizationMessage,
  buildClaimMessage,
  buildPurchaseClaimKeyMessage,
  claimPayloadSchema,
  claimReasonCodeSchema,
  claimTypeSchema,
  purchaseClaimKeyPayloadSchema,
  type ClaimAuthorizationPayload,
  type ClaimPayload,
  type ClaimProofEnvelope,
} from '../../src/lib/protocol/claim.js'
import {
  evaluateClaimEligibility,
  type ClaimEligibilityEvaluation,
} from '../../src/lib/protocol/claim-eligibility.js'
import { getPurchasePassport } from './get-purchase-passport.js'
import { type ClaimProofFailureCode, verifyClaimProof } from './claim-proof.js'

const CLAIM_CHALLENGE_TTL_MS = 10 * 60 * 1_000
const PUBLIC_TOKEN_PATTERN = /^[A-Za-z0-9_-]{22}$/u
const publicTokenSchema = z.string().regex(PUBLIC_TOKEN_PATTERN)

const createClaimInputSchema = z.object({
  claimType: claimTypeSchema,
  note: z.string().max(2_048).optional().default(''),
  passportPublicId: publicTokenSchema,
  reasonCode: claimReasonCodeSchema,
}).strict()
const submitClaimInputSchema = z.object({
  claimPublicId: publicTokenSchema,
  proof: z.unknown(),
}).strict()
const submitAuthorizationInputSchema = z.object({
  authorizationPublicId: publicTokenSchema,
  claimPublicId: publicTokenSchema,
  proof: z.unknown(),
}).strict()

type ClaimWorkflowState =
  | 'approved'
  | 'authorization_pending'
  | 'decision_pending'
  | 'eligible'
  | 'ineligible'
  | 'rejected'
  | 'signature_requested'

interface ClaimResourceRow {
  merchant_id: string
  order_id: string
  order_public_id: string
  passport_id: string
  policy_version_id: string
  purchase_sender_address: string
  purchase_time: Date
  return_window_seconds: string
  status: 'active' | 'refunded'
  warranty_window_seconds: string
}

interface ClaimRow {
  authorization_canonical_message: string | null
  authorization_claim_payload_hash: string | null
  authorization_claim_signer_address: string | null
  authorization_consumed_at: Date | null
  authorization_expected_signer: string | null
  authorization_expires_at: Date | null
  authorization_id: string | null
  authorization_mode: 'delegated' | 'purchase_key' | 'self' | null
  claim_key_canonical_message: string | null
  claim_key_public_key: string | null
  claim_key_signature: string | null
  claim_key_signer_address: string | null
  authorization_nonce: string | null
  authorization_payload: unknown
  authorization_payload_hash: string | null
  authorization_public_key: string | null
  authorization_signature: string | null
  canonical_message: string
  challenge_nonce: string
  claim_signer_address: string | null
  claim_time: Date
  claim_type: 'RETURN' | 'WARRANTY'
  created_at: Date
  eligibility_eligible: boolean | null
  eligibility_evaluated_at: Date | null
  eligibility_evaluator_version: string | null
  eligibility_inputs: unknown
  eligibility_rules: unknown
  expires_at: Date
  id: string
  merchant_public_id: string
  note: string
  order_public_id: string
  passport_public_id: string
  payload: unknown
  payload_hash: string
  policy_version: number
  public_id: string
  public_key: string | null
  purchase_sender_address: string
  reason_code: 'CHANGED_MIND' | 'DEFECTIVE' | 'NOT_AS_DESCRIBED' | 'OTHER'
  signature: string | null
  signature_status: 'expired' | 'pending' | 'verified'
  verifier_version: string | null
  verified_at: Date | null
  workflow_state: ClaimWorkflowState
}

interface DatabaseNowRow { now: Date }

export type ClaimLifecycleErrorCode =
  | ClaimProofFailureCode
  | 'AUTHORIZATION_NOT_FOUND'
  | 'CLAIM_ALREADY_OPEN'
  | 'CLAIM_NOT_FOUND'
  | 'CLAIM_TYPE_UNAVAILABLE'
  | 'EVIDENCE_INTEGRITY'
  | 'INVALID_REQUEST'
  | 'PASSPORT_NOT_AVAILABLE'
  | 'PERSISTENCE_CONFLICT'
  | 'STATE_CONFLICT'

export class ClaimLifecycleError extends Error {
  readonly code: ClaimLifecycleErrorCode

  constructor(code: ClaimLifecycleErrorCode, message: string) {
    super(message)
    this.name = 'ClaimLifecycleError'
    this.code = code
  }
}

export interface ClaimView {
  authorization: null | {
    canonicalMessage: string | null
    expiresAt: Date | null
    mode: 'delegated' | 'purchase_key' | 'self'
    nonce: string | null
    publicId: string
    requiredSignerAddress: string
    status: 'pending' | 'verified'
  }
  challenge: {
    canonicalMessage: string
    expiresAt: Date
    nonce: string
  }
  claimSignerAddress: string | null
  claimTime: Date
  claimType: 'RETURN' | 'WARRANTY'
  createdAt: Date
  eligibility: null | ClaimEligibilityEvaluation
  merchantPublicId: string
  orderPublicId: string
  passportPublicId: string
  payloadHash: string
  policyVersion: number
  publicId: string
  purchaseSenderAddress: string
  reasonCode: 'CHANGED_MIND' | 'DEFECTIVE' | 'NOT_AS_DESCRIBED' | 'OTHER'
  signatureStatus: 'expired' | 'pending' | 'verified'
  workflowState: ClaimWorkflowState
}

function fail(code: ClaimLifecycleErrorCode, message: string): never {
  throw new ClaimLifecycleError(code, message)
}

function requireOne<T>(rows: T[], code: ClaimLifecycleErrorCode, message: string): T {
  const row = rows[0]
  if (!row) fail(code, message)
  return row
}

function token(): string {
  return randomBytes(16).toString('base64url')
}

function normalizeNote(raw: string): string {
  const note = raw.trim().normalize('NFC')
  const parsed = claimPayloadSchema.shape.note.safeParse(note)
  if (!parsed.success) fail('INVALID_REQUEST', 'The claim note is invalid.')
  return parsed.data
}

function parseInteger(value: string): number {
  if (!/^(0|[1-9][0-9]*)$/u.test(value)) fail('EVIDENCE_INTEGRITY', 'Stored claim evidence is invalid.')
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) fail('EVIDENCE_INTEGRITY', 'Stored claim evidence is unsafe.')
  return parsed
}

function assertHistoricalClaimProof(row: ClaimRow, payload: ClaimPayload): void {
  const expectedMessage = buildClaimMessage(payload)
  if (row.canonical_message !== expectedMessage || row.payload_hash !== hashProtocolPayload(expectedMessage)) {
    fail('EVIDENCE_INTEGRITY', 'Stored claim message evidence is inconsistent.')
  }
  if (row.signature_status !== 'verified') return
  if (!row.public_key || !row.signature || !row.claim_signer_address || !row.verifier_version || !row.verified_at) {
    fail('EVIDENCE_INTEGRITY', 'Stored verified claim proof is incomplete.')
  }
  const verified = verifyNimiqMessageSignature({
    message: expectedMessage,
    publicKey: row.public_key,
    signature: row.signature,
  })
  if (
    !verified.signatureValid
    || !verified.actualSignerAddress
    || normalizeNimiqAddress(verified.actualSignerAddress) !== row.claim_signer_address
    || verified.payloadHash !== row.payload_hash
  ) {
    fail('EVIDENCE_INTEGRITY', 'Stored claim signature evidence is invalid.')
  }
}

function projectClaim(row: ClaimRow): ClaimView {
  const payloadResult = claimPayloadSchema.safeParse(row.payload)
  if (!payloadResult.success) fail('EVIDENCE_INTEGRITY', 'Stored claim payload is invalid.')
  const payload = payloadResult.data
  if (
    payload.claimId !== row.public_id
    || payload.orderId !== row.order_public_id
    || payload.purchaseSenderAddress !== row.purchase_sender_address
    || payload.claimType !== row.claim_type
    || payload.reasonCode !== row.reason_code
    || payload.note !== row.note
    || payload.createdAt !== row.claim_time.getTime()
    || payload.nonce !== row.challenge_nonce
  ) {
    fail('EVIDENCE_INTEGRITY', 'Stored claim columns do not match the signed payload.')
  }
  assertHistoricalClaimProof(row, payload)

  let authorization: ClaimView['authorization'] = null
  if (row.authorization_id && row.authorization_mode) {
    if (
      row.authorization_claim_payload_hash !== row.payload_hash
      || row.authorization_claim_signer_address !== row.claim_signer_address
      || row.authorization_expected_signer !== row.purchase_sender_address
    ) {
      fail('EVIDENCE_INTEGRITY', 'Stored claimant authorization binding is inconsistent.')
    }
    if (row.authorization_mode === 'delegated') {
      if (!row.authorization_canonical_message || !row.authorization_payload || !row.authorization_nonce || !row.authorization_expires_at) {
        fail('EVIDENCE_INTEGRITY', 'Stored delegated authorization challenge is incomplete.')
      }
      const expectedMessage = buildClaimAuthorizationMessage(row.authorization_payload)
      const expectedHash = hashProtocolPayload(expectedMessage)
      if (
        expectedMessage !== row.authorization_canonical_message
        || expectedHash !== row.authorization_payload_hash
      ) {
        fail('EVIDENCE_INTEGRITY', 'Stored delegated authorization message is inconsistent.')
      }
      if (row.authorization_consumed_at) {
        if (!row.authorization_public_key || !row.authorization_signature) {
          fail('EVIDENCE_INTEGRITY', 'Stored delegated authorization proof is incomplete.')
        }
        const verified = verifyNimiqMessageSignature({
          message: expectedMessage,
          publicKey: row.authorization_public_key,
          signature: row.authorization_signature,
        })
        if (
          !verified.signatureValid
          || !verified.actualSignerAddress
          || normalizeNimiqAddress(verified.actualSignerAddress) !== row.purchase_sender_address
          || verified.payloadHash !== expectedHash
        ) {
          fail('EVIDENCE_INTEGRITY', 'Stored delegated authorization proof is invalid.')
        }
      }
    }
    if (row.authorization_mode === 'purchase_key') {
      if (
        !row.authorization_consumed_at
        || !row.claim_key_canonical_message
        || !row.claim_key_public_key
        || !row.claim_key_signature
        || !row.claim_key_signer_address
        || row.claim_key_signer_address !== row.claim_signer_address
      ) {
        fail('EVIDENCE_INTEGRITY', 'Stored purchase claim key authority is incomplete.')
      }
      if (!purchaseClaimKeyProofValid({
        canonicalMessage: row.claim_key_canonical_message,
        orderPublicId: row.order_public_id,
        publicKey: row.claim_key_public_key,
        signature: row.claim_key_signature,
        signerAddress: row.claim_key_signer_address,
      })) {
        fail('EVIDENCE_INTEGRITY', 'Stored purchase claim key proof is invalid.')
      }
    }
    authorization = {
      canonicalMessage: row.authorization_canonical_message,
      expiresAt: row.authorization_expires_at,
      mode: row.authorization_mode,
      nonce: row.authorization_nonce,
      publicId: row.authorization_id,
      requiredSignerAddress: row.authorization_mode === 'purchase_key' && row.claim_signer_address
        ? row.claim_signer_address
        : row.purchase_sender_address,
      status: row.authorization_consumed_at ? 'verified' : 'pending',
    }
  }

  let eligibility: ClaimEligibilityEvaluation | null = null
  if (row.eligibility_evaluator_version) {
    const result = z.object({
      deadlineMs: z.number().int().safe().nonnegative().nullable(),
      eligible: z.boolean(),
      evaluatedAtMs: z.number().int().safe().nonnegative(),
      evaluatorVersion: z.string().min(1).max(40),
      rules: z.object({
        authorizationVerified: z.literal(true),
        chronologyValid: z.boolean(),
        passportActive: z.boolean(),
        purchaseVerified: z.boolean(),
        withinInclusiveDeadline: z.boolean(),
        windowAvailable: z.boolean(),
      }).strict(),
      selectedWindowSeconds: z.number().int().safe().nonnegative(),
    }).strict().safeParse({
      ...(typeof row.eligibility_inputs === 'object' && row.eligibility_inputs
        ? row.eligibility_inputs
        : {}),
      eligible: row.eligibility_eligible,
      evaluatedAtMs: row.eligibility_evaluated_at?.getTime(),
      evaluatorVersion: row.eligibility_evaluator_version,
      rules: row.eligibility_rules,
    })
    if (!result.success) fail('EVIDENCE_INTEGRITY', 'Stored eligibility evidence is invalid.')
    eligibility = result.data as ClaimEligibilityEvaluation
  }

  return {
    authorization,
    challenge: {
      canonicalMessage: row.canonical_message,
      expiresAt: row.expires_at,
      nonce: row.challenge_nonce,
    },
    claimSignerAddress: row.claim_signer_address,
    claimTime: row.claim_time,
    claimType: row.claim_type,
    createdAt: row.created_at,
    eligibility,
    merchantPublicId: row.merchant_public_id,
    orderPublicId: row.order_public_id,
    passportPublicId: row.passport_public_id,
    payloadHash: row.payload_hash,
    policyVersion: row.policy_version,
    publicId: row.public_id,
    purchaseSenderAddress: row.purchase_sender_address,
    reasonCode: row.reason_code,
    signatureStatus: row.signature_status,
    workflowState: row.workflow_state,
  }
}

async function readClaim(
  client: postgres.Sql | postgres.TransactionSql,
  claimPublicId: string,
  lock = false,
): Promise<ClaimRow | null> {
  const rows = await client<ClaimRow[]>`
    select
      claims.id, claims.public_id, claims.purchase_sender_address,
      claims.claim_signer_address, claims.claim_type, claims.reason_code, claims.note,
      claims.claim_time, claims.challenge_nonce, claims.payload, claims.canonical_message,
      claims.payload_hash, claims.public_key, claims.signature, claims.verifier_version,
      claims.signature_status, claims.workflow_state, claims.expires_at,
      claims.verified_at, claims.created_at,
      orders.public_id as order_public_id,
      purchase_passports.public_id as passport_public_id,
      purchase_passports.policy_version,
      merchants.public_id as merchant_public_id,
      latest_authorization.public_id as authorization_id,
      latest_authorization.authorization_mode as authorization_mode,
      latest_authorization.purchase_sender_address as authorization_expected_signer,
      latest_authorization.claim_signer_address as authorization_claim_signer_address,
      latest_authorization.claim_payload_hash as authorization_claim_payload_hash,
      latest_authorization.challenge_nonce as authorization_nonce,
      latest_authorization.payload as authorization_payload,
      latest_authorization.canonical_message as authorization_canonical_message,
      latest_authorization.payload_hash as authorization_payload_hash,
      latest_authorization.public_key as authorization_public_key,
      latest_authorization.signature as authorization_signature,
      latest_authorization.expires_at as authorization_expires_at,
      latest_authorization.consumed_at as authorization_consumed_at,
      bound_claim_key.canonical_message as claim_key_canonical_message,
      bound_claim_key.public_key as claim_key_public_key,
      bound_claim_key.signature as claim_key_signature,
      bound_claim_key.signer_address as claim_key_signer_address,
      current_evaluation.evaluator_version as eligibility_evaluator_version,
      current_evaluation.evaluated_at as eligibility_evaluated_at,
      current_evaluation.inputs as eligibility_inputs,
      current_evaluation.rule_results as eligibility_rules,
      current_evaluation.eligible as eligibility_eligible
    from claims
    join orders on orders.id = claims.order_id
    join purchase_passports on purchase_passports.id = claims.passport_id
    join merchants on merchants.id = claims.merchant_id
    left join lateral (
      select * from claim_authorizations
      where claim_authorizations.claim_id = claims.id
      order by (consumed_at is not null) desc, created_at desc, id desc
      limit 1
    ) latest_authorization on true
    left join purchase_claim_keys bound_claim_key
      on bound_claim_key.id = latest_authorization.claim_key_id
      and bound_claim_key.order_id = claims.order_id
      and bound_claim_key.verified_at is not null
    left join claim_eligibility_evaluations current_evaluation
      on current_evaluation.claim_id = claims.id
      and current_evaluation.supersedes_id is null
    where claims.public_id = ${claimPublicId}
    ${lock ? client.unsafe('for update of claims') : client.unsafe('')}
  `
  return rows[0] ?? null
}

async function evaluateAndAccept(
  transaction: postgres.TransactionSql,
  claim: ClaimRow,
  databaseNow: Date,
  resource: ClaimResourceRow,
  authorizationMode: 'delegated' | 'purchase_key' | 'self',
): Promise<void> {
  const eligibility = evaluateClaimEligibility({
    authorizationVerified: true,
    claimTimeMs: claim.claim_time.getTime(),
    claimType: claim.claim_type,
    evaluatedAtMs: databaseNow.getTime(),
    passportActive: resource.status === 'active',
    purchaseTimeMs: resource.purchase_time.getTime(),
    purchaseVerified: true,
    returnWindowSeconds: parseInteger(resource.return_window_seconds),
    warrantyWindowSeconds: parseInteger(resource.warranty_window_seconds),
  })
  await transaction`
    insert into claim_eligibility_evaluations (
      claim_id, evaluator_version, evaluated_at, inputs, rule_results, eligible
    ) values (
      ${claim.id}, ${eligibility.evaluatorVersion}, ${databaseNow},
      ${transaction.json({
        deadlineMs: eligibility.deadlineMs,
        selectedWindowSeconds: eligibility.selectedWindowSeconds,
      })}, ${transaction.json(eligibility.rules)}, ${eligibility.eligible}
    )
  `
  const accepted = await transaction<{ id: string }[]>`
    update claims
    set workflow_state = ${eligibility.eligible ? 'eligible' : 'ineligible'}
    where id = ${claim.id} and workflow_state = 'authorization_pending'
    returning id
  `
  if (accepted.length !== 1) fail('STATE_CONFLICT', 'The claim changed during eligibility evaluation.')
  await transaction`
    insert into protocol_events (
      aggregate_type, aggregate_id, event_type, protocol_version, occurred_at,
      actor_address, correlation_id, evidence_type, evidence_id, payload
    ) values (
      'claim', ${claim.id}, 'claim.accepted-and-evaluated', 'NR1', ${databaseNow},
      ${claim.claim_signer_address}, ${randomUUID()}, 'signature', ${claim.id},
      ${transaction.json({
        authorizationMode,
        eligible: eligibility.eligible,
        evaluatorVersion: eligibility.evaluatorVersion,
      })}
    )
  `
}

function purchaseClaimKeyProofValid(input: {
  canonicalMessage: string
  orderPublicId: string
  publicKey: string
  signature: string
  signerAddress: string
}): boolean {
  try {
    const payload = purchaseClaimKeyPayloadSchema.parse(
      JSON.parse(input.canonicalMessage.slice(input.canonicalMessage.indexOf('\n') + 1)),
    )
    const verified = verifyNimiqMessageSignature({
      message: input.canonicalMessage,
      publicKey: input.publicKey,
      signature: input.signature,
    })
    return payload.orderId === input.orderPublicId
      && buildPurchaseClaimKeyMessage(payload) === input.canonicalMessage
      && verified.signatureValid
      && verified.actualSignerAddress !== undefined
      && normalizeNimiqAddress(verified.actualSignerAddress) === input.signerAddress
  } catch {
    return false
  }
}

async function claimResource(
  transaction: postgres.TransactionSql,
  passportPublicId: string,
): Promise<ClaimResourceRow> {
  return requireOne(await transaction<ClaimResourceRow[]>`
    select
      purchase_passports.id as passport_id,
      purchase_passports.order_id,
      purchase_passports.policy_version_id,
      purchase_passports.merchant_id,
      purchase_passports.original_buyer_address as purchase_sender_address,
      purchase_passports.purchase_time,
      purchase_passports.status,
      orders.public_id as order_public_id,
      policy_versions.return_window_seconds::text,
      policy_versions.warranty_window_seconds::text
    from purchase_passports
    join orders on orders.id = purchase_passports.order_id
    join policy_versions on policy_versions.id = purchase_passports.policy_version_id
    where purchase_passports.public_id = ${passportPublicId}
      and orders.payment_state = 'purchased'
      and policy_versions.verification_status = 'verified'
  `, 'PASSPORT_NOT_AVAILABLE', 'The verified Purchase Passport is unavailable.')
}

export async function createClaimChallenge(
  client: postgres.Sql,
  rawInput: unknown,
): Promise<ClaimView> {
  const parsed = createClaimInputSchema.safeParse(rawInput)
  if (!parsed.success) fail('INVALID_REQUEST', 'The claim request is invalid.')
  const input = parsed.data
  const note = normalizeNote(input.note)

  return client.begin(async (transaction) => {
    const passport = await getPurchasePassport(transaction, input.passportPublicId)
    if (!passport || passport.status !== 'active') {
      fail('PASSPORT_NOT_AVAILABLE', 'The verified Purchase Passport is unavailable.')
    }
    const resource = await claimResource(transaction, input.passportPublicId)
    const windowSeconds = input.claimType === 'RETURN'
      ? parseInteger(resource.return_window_seconds)
      : parseInteger(resource.warranty_window_seconds)
    if (windowSeconds === 0) fail('CLAIM_TYPE_UNAVAILABLE', 'This policy does not offer that claim type.')

    const databaseNow = requireOne(
      await transaction<DatabaseNowRow[]>`select clock_timestamp() as now`,
      'PERSISTENCE_CONFLICT',
      'The database clock was unavailable.',
    ).now

    // An unsigned challenge past its expiry must not block a fresh claim of the same type.
    const blocking = await transaction<{
      expires_at: Date
      id: string
      signature_status: 'expired' | 'pending' | 'verified'
    }[]>`
      select id, signature_status, expires_at
      from claims
      where passport_id = ${resource.passport_id}
        and claim_type = ${input.claimType}
        and workflow_state <> 'rejected'
        and signature_status <> 'expired'
      for update
    `
    for (const existing of blocking) {
      if (existing.signature_status !== 'pending' || existing.expires_at > databaseNow) {
        fail('CLAIM_ALREADY_OPEN', 'A claim of this type is already open for this Purchase Passport.')
      }
      await transaction`
        update claims
        set signature_status = 'expired'
        where id = ${existing.id}
          and signature_status = 'pending'
          and workflow_state = 'signature_requested'
      `
    }

    let createdId: string | undefined
    for (let attempt = 0; attempt < 3 && !createdId; attempt += 1) {
      const claimPublicId = token()
      const nonce = token()
      const payload: ClaimPayload = {
        claimId: claimPublicId,
        claimType: input.claimType,
        createdAt: databaseNow.getTime(),
        nonce,
        note,
        orderId: resource.order_public_id,
        protocol: 'NR1',
        purchaseSenderAddress: resource.purchase_sender_address,
        reasonCode: input.reasonCode,
        type: 'CLAIM',
      }
      const canonicalMessage = buildClaimMessage(payload)
      const payloadHash = hashProtocolPayload(canonicalMessage)
      const expiresAt = new Date(databaseNow.getTime() + CLAIM_CHALLENGE_TTL_MS)
      const rows = await transaction<{ id: string }[]>`
        insert into claims (
          public_id, passport_id, order_id, policy_version_id, merchant_id,
          purchase_sender_address, claim_type, reason_code, note, claim_time,
          challenge_nonce, payload, canonical_message, payload_hash,
          expires_at, created_at, updated_at
        ) values (
          ${claimPublicId}, ${resource.passport_id}, ${resource.order_id},
          ${resource.policy_version_id}, ${resource.merchant_id},
          ${resource.purchase_sender_address}, ${input.claimType}, ${input.reasonCode},
          ${note}, ${databaseNow}, ${nonce}, ${transaction.json(payload)},
          ${canonicalMessage}, ${payloadHash}, ${expiresAt}, ${databaseNow}, ${databaseNow}
        )
        on conflict do nothing
        returning id
      `
      createdId = rows[0]?.id
      if (createdId) {
        await transaction`
          insert into protocol_events (
            aggregate_type, aggregate_id, event_type, protocol_version, occurred_at,
            correlation_id, evidence_type, payload
          ) values (
            'claim', ${createdId}, 'claim.signature-requested', 'NR1', ${databaseNow},
            ${randomUUID()}, 'backend',
            ${transaction.json({ claimType: input.claimType, passportId: resource.passport_id })}
          )
        `
        const claim = await readClaim(transaction, claimPublicId)
        if (!claim) fail('PERSISTENCE_CONFLICT', 'The claim challenge could not be read back.')
        return projectClaim(claim)
      }
    }
    fail('PERSISTENCE_CONFLICT', 'A unique claim challenge could not be allocated.')
  })
}

export async function getClaim(
  client: postgres.Sql | postgres.TransactionSql,
  rawClaimPublicId: unknown,
): Promise<ClaimView | null> {
  const parsed = publicTokenSchema.safeParse(rawClaimPublicId)
  if (!parsed.success) fail('INVALID_REQUEST', 'The claim identifier is invalid.')
  const row = await readClaim(client, parsed.data)
  return row ? projectClaim(row) : null
}

async function insertDelegatedAuthorization(
  transaction: postgres.TransactionSql,
  input: {
    claimId: string
    claimPayloadHash: string
    claimPublicId: string
    claimSignerAddress: string
    databaseNow: Date
    purchaseSenderAddress: string
  },
): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const authorizationPublicId = token()
    const nonce = token()
    const expiresAt = new Date(input.databaseNow.getTime() + CLAIM_CHALLENGE_TTL_MS)
    const authorizationPayload: ClaimAuthorizationPayload = {
      authorizationId: authorizationPublicId,
      claimId: input.claimPublicId,
      claimPayloadHash: input.claimPayloadHash,
      claimSignerAddress: input.claimSignerAddress,
      createdAt: input.databaseNow.getTime(),
      expiresAt: expiresAt.getTime(),
      nonce,
      protocol: 'NR1',
      purchaseSenderAddress: input.purchaseSenderAddress,
      type: 'CLAIM_AUTHORIZATION',
    }
    const canonicalMessage = buildClaimAuthorizationMessage(authorizationPayload)
    const rows = await transaction<{ id: string }[]>`
      insert into claim_authorizations (
        public_id, claim_id, authorization_mode, purchase_sender_address,
        claim_signer_address, claim_payload_hash, challenge_nonce, payload,
        canonical_message, payload_hash, expires_at, created_at
      ) values (
        ${authorizationPublicId}, ${input.claimId}, 'delegated', ${input.purchaseSenderAddress},
        ${input.claimSignerAddress}, ${input.claimPayloadHash}, ${nonce},
        ${transaction.json(authorizationPayload)}, ${canonicalMessage},
        ${hashProtocolPayload(canonicalMessage)}, ${expiresAt}, ${input.databaseNow}
      ) on conflict do nothing returning id
    `
    if (rows.length === 1) return
  }
  fail('PERSISTENCE_CONFLICT', 'Claim authorization could not be allocated.')
}

export async function submitClaimProof(
  client: postgres.Sql,
  rawInput: unknown,
): Promise<ClaimView> {
  const parsed = submitClaimInputSchema.safeParse(rawInput)
  if (!parsed.success) fail('INVALID_REQUEST', 'The claim proof submission is invalid.')
  const input = parsed.data

  return client.begin(async (transaction) => {
    const claim = await readClaim(transaction, input.claimPublicId, true)
    if (!claim) fail('CLAIM_NOT_FOUND', 'The claim challenge was not found.')
    if (claim.signature_status === 'verified') {
      const proof = input.proof as Partial<ClaimProofEnvelope>
      if (
        proof.canonicalMessage === claim.canonical_message
        && proof.payloadHash === claim.payload_hash
        && proof.publicKey === claim.public_key
        && proof.signature === claim.signature
      ) return projectClaim(claim)
      fail('STATE_CONFLICT', 'The claim proof was already submitted.')
    }
    const databaseNow = requireOne(
      await transaction<DatabaseNowRow[]>`select clock_timestamp() as now`,
      'PERSISTENCE_CONFLICT',
      'The database clock was unavailable.',
    ).now
    const proof = verifyClaimProof({
      challenge: {
        action: 'CLAIM',
        canonicalMessage: claim.canonical_message,
        consumedAt: null,
        expectedSignerAddress: null,
        expiresAt: claim.expires_at,
        payload: claim.payload,
        payloadHash: claim.payload_hash,
      },
      now: databaseNow,
      proof: input.proof,
    })
    if (!proof.valid) fail(proof.code, proof.message)
    const updated = await transaction<{ id: string }[]>`
      update claims set
        claim_signer_address = ${proof.actualSignerAddress}, public_key = ${proof.publicKey},
        signature = ${proof.signature}, verifier_version = ${proof.verifierVersion},
        signature_status = 'verified', workflow_state = 'authorization_pending',
        verified_at = ${databaseNow}
      where id = ${claim.id} and signature_status = 'pending'
      returning id
    `
    if (updated.length !== 1) fail('STATE_CONFLICT', 'The claim proof lost a concurrent race.')

    const resource = await claimResource(transaction, claim.passport_public_id)
    const verifiedClaim = requireOne(
      await transaction<ClaimRow[]>`
        select *, ${claim.order_public_id}::text as order_public_id,
          ${claim.passport_public_id}::text as passport_public_id,
          ${claim.policy_version}::integer as policy_version,
          ${claim.merchant_public_id}::text as merchant_public_id,
          null::text as authorization_id, null::claim_authorization_mode as authorization_mode,
          null::text as authorization_expected_signer,
          null::text as authorization_claim_signer_address,
          null::text as authorization_claim_payload_hash,
          null::text as authorization_nonce, null::jsonb as authorization_payload,
          null::text as authorization_canonical_message,
          null::text as authorization_payload_hash,
          null::text as authorization_public_key,
          null::text as authorization_signature,
          null::timestamptz as authorization_expires_at,
          null::timestamptz as authorization_consumed_at,
          null::text as claim_key_canonical_message, null::text as claim_key_public_key,
          null::text as claim_key_signature, null::text as claim_key_signer_address,
          null::text as eligibility_evaluator_version,
          null::timestamptz as eligibility_evaluated_at,
          null::jsonb as eligibility_inputs, null::jsonb as eligibility_rules,
          null::boolean as eligibility_eligible
        from claims where id = ${claim.id}
      `,
      'STATE_CONFLICT',
      'The verified claim could not be loaded.',
    )

    const boundKeys = await transaction<{ id: string }[]>`
      select purchase_claim_keys.id
      from purchase_claim_keys
      join claims on claims.order_id = purchase_claim_keys.order_id
      where claims.id = ${claim.id}
        and purchase_claim_keys.verified_at is not null
        and purchase_claim_keys.signer_address = ${proof.actualSignerAddress}
    `
    const boundKey = boundKeys[0]
    if (proof.actualSignerAddress === claim.purchase_sender_address) {
      await transaction`
        insert into claim_authorizations (
          public_id, claim_id, authorization_mode, purchase_sender_address,
          claim_signer_address, claim_payload_hash, consumed_at, verified_at, created_at
        ) values (
          ${token()}, ${claim.id}, 'self', ${claim.purchase_sender_address},
          ${proof.actualSignerAddress}, ${claim.payload_hash}, ${databaseNow}, ${databaseNow},
          ${databaseNow}
        )
      `
      await evaluateAndAccept(transaction, verifiedClaim, databaseNow, resource, 'self')
    } else if (boundKey) {
      await transaction`
        insert into claim_authorizations (
          public_id, claim_id, authorization_mode, purchase_sender_address,
          claim_signer_address, claim_payload_hash, claim_key_id, consumed_at, verified_at,
          created_at
        ) values (
          ${token()}, ${claim.id}, 'purchase_key', ${claim.purchase_sender_address},
          ${proof.actualSignerAddress}, ${claim.payload_hash}, ${boundKey.id}, ${databaseNow},
          ${databaseNow}, ${databaseNow}
        )
      `
      await evaluateAndAccept(transaction, verifiedClaim, databaseNow, resource, 'purchase_key')
    } else {
      await insertDelegatedAuthorization(transaction, {
        claimId: claim.id,
        claimPayloadHash: claim.payload_hash,
        claimPublicId: claim.public_id,
        claimSignerAddress: proof.actualSignerAddress,
        databaseNow,
        purchaseSenderAddress: claim.purchase_sender_address,
      })
    }

    const result = await readClaim(transaction, claim.public_id)
    if (!result) fail('PERSISTENCE_CONFLICT', 'The submitted claim could not be read back.')
    return projectClaim(result)
  })
}

export async function submitClaimAuthorization(
  client: postgres.Sql,
  rawInput: unknown,
): Promise<ClaimView> {
  const parsed = submitAuthorizationInputSchema.safeParse(rawInput)
  if (!parsed.success) fail('INVALID_REQUEST', 'The authorization proof submission is invalid.')
  const input = parsed.data

  return client.begin(async (transaction) => {
    const claim = await readClaim(transaction, input.claimPublicId, true)
    if (!claim) fail('CLAIM_NOT_FOUND', 'The claim was not found.')
    if (claim.workflow_state !== 'authorization_pending') {
      if (claim.authorization_id === input.authorizationPublicId && claim.authorization_consumed_at) {
        const proof = input.proof as Partial<ClaimProofEnvelope>
        if (
          proof.canonicalMessage === claim.authorization_canonical_message
          && proof.payloadHash === claim.authorization_payload_hash
          && proof.publicKey === claim.authorization_public_key
          && proof.signature === claim.authorization_signature
        ) return projectClaim(claim)
        fail('STATE_CONFLICT', 'A different authorization proof was already consumed.')
      }
      fail('STATE_CONFLICT', 'The claim is not awaiting purchase-sender authorization.')
    }
    const authorizations = await transaction<{
      canonical_message: string
      claim_id: string
      consumed_at: Date | null
      expires_at: Date
      id: string
      payload: unknown
      payload_hash: string
      public_id: string
    }[]>`
      select id, public_id, claim_id, canonical_message, payload, payload_hash,
        expires_at, consumed_at
      from claim_authorizations
      where public_id = ${input.authorizationPublicId} and claim_id = ${claim.id}
        and authorization_mode = 'delegated'
      for update
    `
    const authorization = requireOne(
      authorizations,
      'AUTHORIZATION_NOT_FOUND',
      'The claim authorization challenge was not found.',
    )
    const databaseNow = requireOne(
      await transaction<DatabaseNowRow[]>`select clock_timestamp() as now`,
      'PERSISTENCE_CONFLICT',
      'The database clock was unavailable.',
    ).now
    const proof = verifyClaimProof({
      challenge: {
        action: 'CLAIM_AUTHORIZATION',
        canonicalMessage: authorization.canonical_message,
        consumedAt: authorization.consumed_at,
        expectedSignerAddress: claim.purchase_sender_address,
        expiresAt: authorization.expires_at,
        payload: authorization.payload,
        payloadHash: authorization.payload_hash,
      },
      now: databaseNow,
      proof: input.proof,
    })
    if (!proof.valid) fail(proof.code, proof.message)
    const completed = await transaction<{ id: string }[]>`
      update claim_authorizations set
        public_key = ${proof.publicKey}, signature = ${proof.signature},
        authorization_signer_address = ${proof.actualSignerAddress},
        verifier_version = ${proof.verifierVersion}, consumed_at = ${databaseNow},
        verified_at = ${databaseNow}
      where id = ${authorization.id} and consumed_at is null and expires_at > ${databaseNow}
      returning id
    `
    if (completed.length !== 1) fail('STATE_CONFLICT', 'The authorization lost a concurrent race.')

    const resource = await claimResource(transaction, claim.passport_public_id)
    await evaluateAndAccept(transaction, claim, databaseNow, resource, 'delegated')
    const result = await readClaim(transaction, claim.public_id)
    if (!result) fail('PERSISTENCE_CONFLICT', 'The authorized claim could not be read back.')
    return projectClaim(result)
  })
}

// A delegated authorization challenge can lapse before the purchase wallet signs it.
// Only then may a fresh challenge be issued; nothing about the verified claim changes.
export async function renewClaimAuthorization(
  client: postgres.Sql,
  rawClaimPublicId: unknown,
): Promise<ClaimView> {
  const parsed = publicTokenSchema.safeParse(rawClaimPublicId)
  if (!parsed.success) fail('INVALID_REQUEST', 'The claim identifier is invalid.')

  return client.begin(async (transaction) => {
    const claim = await readClaim(transaction, parsed.data, true)
    if (!claim) fail('CLAIM_NOT_FOUND', 'The claim was not found.')
    if (
      claim.workflow_state !== 'authorization_pending'
      || claim.signature_status !== 'verified'
      || !claim.claim_signer_address
    ) {
      fail('STATE_CONFLICT', 'The claim is not awaiting purchase-sender authorization.')
    }
    const databaseNow = requireOne(
      await transaction<DatabaseNowRow[]>`select clock_timestamp() as now`,
      'PERSISTENCE_CONFLICT',
      'The database clock was unavailable.',
    ).now
    if (
      claim.authorization_mode === 'delegated'
      && claim.authorization_consumed_at === null
      && claim.authorization_expires_at !== null
      && claim.authorization_expires_at > databaseNow
    ) {
      return projectClaim(claim)
    }
    await insertDelegatedAuthorization(transaction, {
      claimId: claim.id,
      claimPayloadHash: claim.payload_hash,
      claimPublicId: claim.public_id,
      claimSignerAddress: claim.claim_signer_address,
      databaseNow,
      purchaseSenderAddress: claim.purchase_sender_address,
    })
    const result = await readClaim(transaction, claim.public_id)
    if (!result) fail('PERSISTENCE_CONFLICT', 'The renewed claim could not be read back.')
    return projectClaim(result)
  })
}
