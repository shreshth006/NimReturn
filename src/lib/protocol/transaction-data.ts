const TOKEN_PATTERN = /^[A-Za-z0-9_-]{22}$/u
const TAG_PATTERN = /^NR1:([PR]):([A-Za-z0-9_-]{22})$/u
const BASE64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

export type TransactionPurpose = 'purchase' | 'refund'

export interface ParsedTransactionTag {
  purpose: TransactionPurpose
  token: string
}

export function isProtocolToken(value: string): boolean {
  return TOKEN_PATTERN.test(value)
}

export function encodeBase64Url(bytes: Uint8Array): string {
  let output = ''

  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] as number
    const second = bytes[index + 1]
    const third = bytes[index + 2]

    output += BASE64URL_ALPHABET[first >> 2]
    output += BASE64URL_ALPHABET[((first & 0x03) << 4) | ((second ?? 0) >> 4)]

    if (second !== undefined) {
      output += BASE64URL_ALPHABET[((second & 0x0f) << 2) | ((third ?? 0) >> 6)]
    }
    if (third !== undefined) {
      output += BASE64URL_ALPHABET[third & 0x3f]
    }
  }

  return output
}

export function generateProtocolToken(): string {
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error('Secure random number generation is unavailable')
  }

  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16))
  const token = encodeBase64Url(bytes)
  if (!isProtocolToken(token)) {
    throw new Error('Generated protocol token has an invalid representation')
  }
  return token
}

export function encodePurchaseTag(orderToken: string): string {
  if (!isProtocolToken(orderToken)) {
    throw new TypeError('Order token must be a 22-character base64url value')
  }
  return `NR1:P:${orderToken}`
}

export function encodeRefundTag(claimToken: string): string {
  if (!isProtocolToken(claimToken)) {
    throw new TypeError('Claim token must be a 22-character base64url value')
  }
  return `NR1:R:${claimToken}`
}

export function parseTransactionTag(value: string): ParsedTransactionTag | null {
  const match = TAG_PATTERN.exec(value)
  if (!match) return null

  return {
    purpose: match[1] === 'P' ? 'purchase' : 'refund',
    token: match[2] as string,
  }
}

export function transactionTagByteLength(tag: string): number {
  return new TextEncoder().encode(tag).byteLength
}
