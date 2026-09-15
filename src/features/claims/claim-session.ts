import { z } from 'zod'

const STORAGE_KEY = 'nimreturn.phase3.claim.v1'
const token = z.string().regex(/^[A-Za-z0-9_-]{22}$/u)
const schema = z.object({ claimPublicId: token, passportPublicId: token }).strict()

interface Storage {
  getItem(key: string): string | null
  removeItem(key: string): void
  setItem(key: string, value: string): void
}

function browserStorage(): Storage | undefined {
  try { return globalThis.sessionStorage } catch { return undefined }
}

export function loadClaimSession(
  passportPublicId: string,
  storage: Storage | undefined = browserStorage(),
): { claimPublicId: string; passportPublicId: string } | null {
  if (!storage) return null
  try {
    const result = schema.safeParse(JSON.parse(storage.getItem(STORAGE_KEY) ?? 'null'))
    return result.success && result.data.passportPublicId === passportPublicId ? result.data : null
  } catch { return null }
}

export function saveClaimSession(
  value: { claimPublicId: string; passportPublicId: string },
  storage: Storage | undefined = browserStorage(),
): boolean {
  if (!storage) return false
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(schema.parse(value)))
    return true
  } catch { return false }
}

export function clearClaimSession(storage: Storage | undefined = browserStorage()): boolean {
  if (!storage) return false
  try { storage.removeItem(STORAGE_KEY); return true } catch { return false }
}
