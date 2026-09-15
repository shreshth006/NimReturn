import { z } from 'zod'

const STORAGE_KEY = 'nimreturn.phase2.purchase.v1'
const publicTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{22}$/u)
const purchaseSessionSchema = z.object({
  orderPublicId: publicTokenSchema,
  productPublicId: publicTokenSchema,
  transactionHash: z.string().regex(/^[0-9a-f]{64}$/u).optional(),
}).strict()

export type PurchaseSession = z.infer<typeof purchaseSessionSchema>

interface SessionStorage {
  getItem(key: string): string | null
  removeItem(key: string): void
  setItem(key: string, value: string): void
}

function browserStorage(): SessionStorage | undefined {
  try {
    return globalThis.sessionStorage
  } catch {
    return undefined
  }
}

export function loadPurchaseSession(
  productPublicId: string,
  storage: SessionStorage | undefined = browserStorage(),
): PurchaseSession | null {
  if (!storage) return null
  try {
    const parsed = purchaseSessionSchema.safeParse(JSON.parse(storage.getItem(STORAGE_KEY) ?? 'null'))
    return parsed.success && parsed.data.productPublicId === productPublicId ? parsed.data : null
  } catch {
    return null
  }
}

export function savePurchaseSession(
  session: PurchaseSession,
  storage: SessionStorage | undefined = browserStorage(),
): boolean {
  if (!storage) return false
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(purchaseSessionSchema.parse(session)))
    return true
  } catch {
    return false
  }
}

export function clearPurchaseSession(storage: SessionStorage | undefined = browserStorage()): boolean {
  if (!storage) return false
  try {
    storage.removeItem(STORAGE_KEY)
    return true
  } catch {
    return false
  }
}
