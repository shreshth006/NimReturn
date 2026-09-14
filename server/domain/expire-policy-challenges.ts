import { randomUUID } from 'node:crypto'
import type postgres from 'postgres'
import { z } from 'zod'

const expireInputSchema = z.object({
  limit: z.number().int().min(1).max(100).default(100),
}).strict()

interface ExpiredCandidateRow {
  merchant_id: string
  policy_version_id: string
  product_id: string
}

interface DatabaseNowRow {
  now: Date
}

export class PolicyExpiryError extends Error {
  readonly code: 'INVALID_REQUEST' | 'PERSISTENCE_CONFLICT'

  constructor(code: 'INVALID_REQUEST' | 'PERSISTENCE_CONFLICT', message: string) {
    super(message)
    this.name = 'PolicyExpiryError'
    this.code = code
  }
}

function requireOne<T>(rows: T[], message: string): T {
  const row = rows[0]
  if (!row) throw new PolicyExpiryError('PERSISTENCE_CONFLICT', message)
  return row
}

export async function expireStalePolicyChallenges(
  client: postgres.Sql,
  rawInput: unknown = {},
): Promise<number> {
  const inputResult = expireInputSchema.safeParse(rawInput)
  if (!inputResult.success) {
    throw new PolicyExpiryError('INVALID_REQUEST', 'The policy expiry request is invalid.')
  }

  return client.begin(async (transaction) => {
    const databaseNow = requireOne(
      await transaction<DatabaseNowRow[]>`select clock_timestamp() as now`,
      'The database clock was unavailable.',
    ).now
    const candidates = await transaction<ExpiredCandidateRow[]>`
      select
        signing_challenges.policy_version_id,
        signing_challenges.merchant_id,
        policy_versions.product_id
      from signing_challenges
      join policy_versions on policy_versions.id = signing_challenges.policy_version_id
      where signing_challenges.consumed_at is null
        and signing_challenges.expires_at <= ${databaseNow}
        and policy_versions.verification_status = 'pending'
      order by signing_challenges.expires_at, signing_challenges.id
      limit ${inputResult.data.limit}
      for update of signing_challenges, policy_versions skip locked
    `

    let expiredCount = 0
    for (const candidate of candidates) {
      const expiredRows = await transaction<{ id: string }[]>`
        update policy_versions
        set verification_status = 'expired'
        where id = ${candidate.policy_version_id} and verification_status = 'pending'
        returning id
      `
      if (expiredRows.length !== 1) continue

      await transaction`
        insert into protocol_events (
          aggregate_type, aggregate_id, event_type, protocol_version, occurred_at,
          correlation_id, evidence_type, payload
        ) values (
          'policy', ${candidate.policy_version_id}, 'policy.expired', 'NR1', ${databaseNow},
          ${randomUUID()}, 'backend',
          ${transaction.json({
            merchantId: candidate.merchant_id,
            productId: candidate.product_id,
          })}
        )
      `
      expiredCount += 1
    }
    return expiredCount
  })
}
