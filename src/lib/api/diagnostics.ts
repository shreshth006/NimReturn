import type { ExpectedTransaction } from '../protocol/transaction-verification.js'

const baseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/u, '') ?? ''

export interface DiagnosticApiResult {
  body: unknown
  ok: boolean
  status: number
}

export async function verifyDiagnosticTransaction(
  expected: Omit<ExpectedTransaction, 'network'>,
): Promise<DiagnosticApiResult> {
  const response = await fetch(`${baseUrl}/api/v1/diagnostics/transactions/verify`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({
      data: expected.data,
      hash: expected.hash,
      recipient: expected.recipient,
      valueLuna: expected.valueLuna,
    }),
  })

  let body: unknown
  try {
    body = await response.json()
  } catch {
    body = { message: 'The API returned a non-JSON response.' }
  }
  return { body, ok: response.ok, status: response.status }
}
