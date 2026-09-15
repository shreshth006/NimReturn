import { z } from 'zod'

const KEY = 'nimreturn.phase4.refund.v1'
const token = z.string().regex(/^[A-Za-z0-9_-]{22}$/u)
const schema = z.object({
  attemptPublicId: token,
  claimPublicId: token,
  transactionHash: z.string().regex(/^[0-9a-f]{64}$/u).optional(),
}).strict()

interface Storage {
  getItem(key: string): string | null
  removeItem(key: string): void
  setItem(key: string, value: string): void
}

function storage(): Storage | undefined {
  try { return globalThis.sessionStorage } catch { return undefined }
}

export type RefundSession = z.infer<typeof schema>

export function loadRefundSession(claimPublicId: string, target: Storage | undefined = storage()): RefundSession | null {
  if (!target) return null
  try {
    const parsed = schema.safeParse(JSON.parse(target.getItem(KEY) ?? 'null'))
    return parsed.success && parsed.data.claimPublicId === claimPublicId ? parsed.data : null
  } catch { return null }
}

export function saveRefundSession(value: RefundSession, target: Storage | undefined = storage()): boolean {
  if (!target) return false
  try { target.setItem(KEY, JSON.stringify(schema.parse(value))); return true } catch { return false }
}

export function clearRefundSession(target: Storage | undefined = storage()): boolean {
  if (!target) return false
  try { target.removeItem(KEY); return true } catch { return false }
}
