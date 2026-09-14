import { z } from 'zod'

import { policyPayloadSchema } from '../../lib/protocol/policy.js'
import type { PolicyChallenge } from '../../lib/api/merchant.js'

const STORAGE_KEY = 'nimreturn.phase1.merchant-workspace.v1'
const publicTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{22}$/u)
const challengeSchema = z.object({
  canonicalMessage: z.string().min(1),
  expiresAt: z.string().refine((value) => !Number.isNaN(Date.parse(value))),
  nonce: publicTokenSchema,
  payload: policyPayloadSchema,
  payloadHash: z.string().regex(/^[0-9a-f]{64}$/u),
}).strict()
const workspaceSchema = z.object({
  displayName: z.string().min(1),
  merchantPublicId: publicTokenSchema,
  pendingChallenge: challengeSchema.optional(),
  productName: z.string().min(1),
  productPublicId: publicTokenSchema,
}).strict()

export type MerchantWorkspace = z.infer<typeof workspaceSchema>

interface WorkspaceStorage {
  getItem(key: string): string | null
  removeItem(key: string): void
  setItem(key: string, value: string): void
}

function browserStorage(): WorkspaceStorage | undefined {
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}

export function loadMerchantWorkspace(
  storage: WorkspaceStorage | undefined = browserStorage(),
  now = new Date(),
): MerchantWorkspace | null {
  if (!storage) return null
  try {
    const parsed = workspaceSchema.safeParse(JSON.parse(storage.getItem(STORAGE_KEY) ?? 'null'))
    if (!parsed.success) return null
    if (
      parsed.data.pendingChallenge
      && now.getTime() >= Date.parse(parsed.data.pendingChallenge.expiresAt)
    ) {
      const workspace = savePendingChallenge(parsed.data, undefined)
      storage.setItem(STORAGE_KEY, JSON.stringify(workspace))
      return workspace
    }
    return parsed.data
  } catch {
    return null
  }
}

export function saveMerchantWorkspace(
  workspace: MerchantWorkspace,
  storage: WorkspaceStorage | undefined = browserStorage(),
): boolean {
  if (!storage) return false
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(workspaceSchema.parse(workspace)))
    return true
  } catch {
    return false
  }
}

export function clearMerchantWorkspace(
  storage: WorkspaceStorage | undefined = browserStorage(),
): boolean {
  if (!storage) return false
  try {
    storage.removeItem(STORAGE_KEY)
    return true
  } catch {
    return false
  }
}

export function savePendingChallenge(
  workspace: MerchantWorkspace,
  pendingChallenge: PolicyChallenge | undefined,
): MerchantWorkspace {
  return pendingChallenge
    ? { ...workspace, pendingChallenge }
    : {
        displayName: workspace.displayName,
        merchantPublicId: workspace.merchantPublicId,
        productName: workspace.productName,
        productPublicId: workspace.productPublicId,
      }
}
