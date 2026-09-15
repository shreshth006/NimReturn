import { z } from 'zod'

import { claimTypeSchema } from './claim.js'

export const CLAIM_ELIGIBILITY_EVALUATOR_VERSION = 'nr1-claim-eligibility-v1'

const inputSchema = z.object({
  authorizationVerified: z.literal(true),
  claimTimeMs: z.number().int().safe().nonnegative(),
  claimType: claimTypeSchema,
  evaluatedAtMs: z.number().int().safe().nonnegative(),
  passportActive: z.boolean(),
  purchaseTimeMs: z.number().int().safe().nonnegative(),
  purchaseVerified: z.boolean(),
  returnWindowSeconds: z.number().int().safe().nonnegative(),
  warrantyWindowSeconds: z.number().int().safe().nonnegative(),
}).strict()

export type ClaimEligibilityInput = z.infer<typeof inputSchema>

export interface ClaimEligibilityEvaluation {
  deadlineMs: number | null
  eligible: boolean
  evaluatedAtMs: number
  evaluatorVersion: typeof CLAIM_ELIGIBILITY_EVALUATOR_VERSION
  rules: {
    authorizationVerified: true
    chronologyValid: boolean
    passportActive: boolean
    purchaseVerified: boolean
    withinInclusiveDeadline: boolean
    windowAvailable: boolean
  }
  selectedWindowSeconds: number
}

export function evaluateClaimEligibility(value: unknown): ClaimEligibilityEvaluation {
  const input = inputSchema.parse(value)
  const selectedWindowSeconds = input.claimType === 'RETURN'
    ? input.returnWindowSeconds
    : input.warrantyWindowSeconds
  const windowMilliseconds = selectedWindowSeconds * 1_000
  if (!Number.isSafeInteger(windowMilliseconds)) {
    throw new RangeError('Claim window exceeds safe millisecond arithmetic.')
  }
  const deadlineMs = input.purchaseTimeMs + windowMilliseconds
  if (!Number.isSafeInteger(deadlineMs)) {
    throw new RangeError('Claim deadline exceeds safe timestamp arithmetic.')
  }

  const rules = {
    authorizationVerified: true as const,
    chronologyValid: input.claimTimeMs >= input.purchaseTimeMs,
    passportActive: input.passportActive,
    purchaseVerified: input.purchaseVerified,
    withinInclusiveDeadline: input.claimTimeMs <= deadlineMs,
    windowAvailable: selectedWindowSeconds > 0,
  }

  return {
    deadlineMs: rules.windowAvailable ? deadlineMs : null,
    eligible: Object.values(rules).every(Boolean),
    evaluatedAtMs: input.evaluatedAtMs,
    evaluatorVersion: CLAIM_ELIGIBILITY_EVALUATOR_VERSION,
    rules,
    selectedWindowSeconds,
  }
}
