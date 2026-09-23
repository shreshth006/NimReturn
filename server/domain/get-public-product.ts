import type postgres from 'postgres'
import { z } from 'zod'

import {
  hashProtocolPayload,
  normalizeNimiqAddress,
  verifyNimiqSignature,
} from '../../src/lib/crypto/nimiq-signature.js'
import {
  buildPolicyMessage,
  parsePolicyPayload,
  type PolicyPayload,
  type PolicyProofEnvelope,
} from '../../src/lib/protocol/policy.js'

const PUBLIC_TOKEN_PATTERN = /^[A-Za-z0-9_-]{22}$/u
const publicProductIdSchema = z.string().regex(PUBLIC_TOKEN_PATTERN)
const UTF8_ENCODER = new TextEncoder()

export interface PublicProductRow {
  active_policy_version_id: string
  canonical_message: string
  challenge_nonce: string
  display_name: string
  merchant_policy_signer_address: string | null
  merchant_public_id: string
  payload: unknown
  payload_hash: string
  price_luna: string
  policy_public_id: string
  policy_version_id: string
  policy_public_key: string | null
  policy_signature: string | null
  policy_signer_address: string | null
  product_description: string
  product_network: string
  product_public_id: string
  product_name: string
  protocol_version: string
  return_window_seconds: string
  settlement_address: string
  verified_at: Date | null
  version: number
  warranty_transfer_allowed: boolean
  warranty_window_seconds: string
}

export interface PublicVerifiedProduct {
  merchant: {
    displayName: string
    publicId: string
  }
  policy: {
    payload: PolicyPayload
    proof: PolicyProofEnvelope
    publicId: string
    signerAddress: string
    verifiedAt: Date
  }
  policyVersions: Array<{
    active: boolean
    payload: PolicyPayload
    proof: PolicyProofEnvelope
    publicId: string
    signerAddress: string
    verifiedAt: Date
  }>
  product: {
    description: string
    /** The chain this product sells on; a purchase must be paid and verified there. */
    network: string
    publicId: string
  }
}

export type PublicProductReadErrorCode = 'EVIDENCE_INTEGRITY' | 'INVALID_REQUEST'

export class PublicProductReadError extends Error {
  readonly code: PublicProductReadErrorCode

  constructor(code: PublicProductReadErrorCode, message: string) {
    super(message)
    this.name = 'PublicProductReadError'
    this.code = code
  }
}

function integrityFailure(): never {
  throw new PublicProductReadError(
    'EVIDENCE_INTEGRITY',
    'The active product policy failed stored-evidence verification.',
  )
}

function requireCanonicalDisplayName(value: string): string {
  const codePoints = Array.from(value)
  const containsControlCharacter = codePoints.some((character) => {
    const point = character.codePointAt(0)
    return point !== undefined && (point <= 0x1f || (point >= 0x7f && point <= 0x9f))
  })
  if (
    value !== value.trim()
    || value !== value.normalize('NFC')
    || codePoints.length < 1
    || codePoints.length > 80
    || UTF8_ENCODER.encode(value).byteLength > 256
    || containsControlCharacter
  ) {
    integrityFailure()
  }
  return value
}

function requireCanonicalDescription(value: string): string {
  const codePoints = Array.from(value)
  const containsControlCharacter = codePoints.some((character) => {
    const point = character.codePointAt(0)
    return point !== undefined && (point <= 0x1f || (point >= 0x7f && point <= 0x9f))
  })
  if (
    value !== value.trim()
    || value !== value.normalize('NFC')
    || codePoints.length > 500
    || UTF8_ENCODER.encode(value).byteLength > 2_048
    || containsControlCharacter
  ) {
    integrityFailure()
  }
  return value
}

function parseSafeIntegerColumn(value: string): number {
  if (!/^(0|[1-9][0-9]*)$/u.test(value)) integrityFailure()
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) integrityFailure()
  return parsed
}

export function projectVerifiedPolicy(row: PublicProductRow): PublicVerifiedProduct['policy'] {
  let payload: PolicyPayload
  let canonicalMessage: string
  let signerAddress: string
  let merchantSignerAddress: string
  try {
    payload = parsePolicyPayload(row.payload)
    canonicalMessage = buildPolicyMessage(payload)
    if (!row.policy_signer_address || !row.merchant_policy_signer_address) integrityFailure()
    signerAddress = normalizeNimiqAddress(row.policy_signer_address)
    merchantSignerAddress = normalizeNimiqAddress(row.merchant_policy_signer_address)
  } catch (error) {
    if (error instanceof PublicProductReadError) throw error
    integrityFailure()
  }

  if (
    row.product_public_id !== payload.productId
    || row.merchant_public_id !== payload.merchantId
    || row.policy_public_id !== payload.policyId
    || row.product_name !== payload.productName
    || parseSafeIntegerColumn(row.price_luna) !== payload.priceLuna
    || parseSafeIntegerColumn(row.return_window_seconds) !== payload.returnWindowSeconds
    || parseSafeIntegerColumn(row.warranty_window_seconds) !== payload.warrantyWindowSeconds
    || row.warranty_transfer_allowed !== payload.warrantyTransferAllowed
    || row.protocol_version !== payload.protocol
    || row.challenge_nonce !== payload.nonce
    || row.settlement_address !== payload.settlementAddress
    || row.version !== payload.version
    || row.canonical_message !== canonicalMessage
    || row.payload_hash !== hashProtocolPayload(canonicalMessage)
    || row.policy_signer_address !== signerAddress
    || row.merchant_policy_signer_address !== merchantSignerAddress
    || signerAddress !== merchantSignerAddress
    || !row.policy_public_key
    || !row.policy_signature
    || !row.verified_at
  ) {
    integrityFailure()
  }

  const signatureVerification = verifyNimiqSignature({
    address: signerAddress,
    message: canonicalMessage,
    publicKey: row.policy_public_key,
    signature: row.policy_signature,
  })
  if (!signatureVerification.valid || signatureVerification.payloadHash !== row.payload_hash) {
    integrityFailure()
  }

  return {
    payload,
    proof: {
      canonicalMessage,
      payloadHash: row.payload_hash,
      publicKey: row.policy_public_key,
      signature: row.policy_signature,
    },
    publicId: payload.policyId,
    signerAddress,
    verifiedAt: row.verified_at,
  }
}

export async function getPublicVerifiedProduct(
  client: postgres.Sql | postgres.TransactionSql,
  rawProductPublicId: unknown,
): Promise<PublicVerifiedProduct | null> {
  const productIdResult = publicProductIdSchema.safeParse(rawProductPublicId)
  if (!productIdResult.success) {
    throw new PublicProductReadError('INVALID_REQUEST', 'The product identifier is invalid.')
  }

  const rows = await client<PublicProductRow[]>`
    select
      products.public_id as product_public_id,
      products.description as product_description,
      products.network as product_network,
      products.active_policy_version_id,
      merchants.public_id as merchant_public_id,
      merchants.display_name,
      merchants.policy_signer_address as merchant_policy_signer_address,
      policy_versions.public_id as policy_public_id,
      policy_versions.id as policy_version_id,
      policy_versions.payload,
      policy_versions.product_name,
      policy_versions.price_luna::text,
      policy_versions.return_window_seconds::text,
      policy_versions.warranty_window_seconds::text,
      policy_versions.warranty_transfer_allowed,
      policy_versions.protocol_version,
      policy_versions.challenge_nonce,
      policy_versions.canonical_message,
      policy_versions.payload_hash,
      policy_versions.settlement_address,
      policy_versions.version,
      policy_versions.signer_address as policy_signer_address,
      policy_versions.public_key as policy_public_key,
      policy_versions.signature as policy_signature,
      policy_versions.verified_at
    from products
    join merchants on merchants.id = products.merchant_id
    join policy_versions on policy_versions.product_id = products.id
    where products.public_id = ${productIdResult.data}
      and products.status = 'active'
      and merchants.status = 'active'
      and policy_versions.verification_status = 'verified'
    order by policy_versions.version
  `
  const firstRow = rows[0]
  if (!firstRow) return null
  const versions = rows.map((row) => ({ row, policy: projectVerifiedPolicy(row) }))
  const active = versions.find(({ row }) => row.policy_version_id === row.active_policy_version_id)
  if (!active) integrityFailure()

  return {
    merchant: {
      displayName: requireCanonicalDisplayName(firstRow.display_name),
      publicId: active.policy.payload.merchantId,
    },
    policy: active.policy,
    policyVersions: versions.map(({ policy, row }) => ({
      ...policy,
      active: row.policy_version_id === row.active_policy_version_id,
    })),
    product: {
      description: requireCanonicalDescription(firstRow.product_description),
      network: firstRow.product_network,
      publicId: active.policy.payload.productId,
    },
  }
}
