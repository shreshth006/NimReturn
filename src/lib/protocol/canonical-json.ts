export type CanonicalJson = boolean | number | string | CanonicalJson[] | CanonicalJsonObject

export interface CanonicalJsonObject {
  [key: string]: CanonicalJson
}

function assertPlainObject(value: object): asserts value is CanonicalJsonObject {
  const prototype: object | null = Reflect.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError('Canonical JSON objects must be plain objects')
  }
}

/**
 * RFC 8785/JCS serializer for NimReturn's deliberately restricted value set.
 * The protocol rejects null, unsafe/non-integer numbers and undefined before
 * this function is reached.
 */
export function canonicalize(value: CanonicalJson): string {
  if (typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value)
  }

  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw new TypeError('Canonical protocol numbers must be safe integers')
    }
    return JSON.stringify(value)
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item)).join(',')}]`
  }

  assertPlainObject(value)
  const entries = Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key] as CanonicalJson)}`)

  return `{${entries.join(',')}}`
}

export type ProtocolMessageType = 'CLAIM' | 'CLAIM_AUTHORIZATION' | 'POLICY' | 'RESOLUTION'

export function buildProtocolMessage(
  type: ProtocolMessageType,
  payload: CanonicalJsonObject,
): string {
  if (payload.protocol !== 'NR1' || payload.type !== type) {
    throw new TypeError('Protocol payload version/type does not match its domain')
  }

  return `NIMRETURN/1/${type}\n${canonicalize(payload)}`
}

export function buildDiagnosticMessage(expectedSigner: string, nonce: string): string {
  return `NIMRETURN/P0/DIAGNOSTIC\n${canonicalize({ expectedSigner, nonce })}`
}
