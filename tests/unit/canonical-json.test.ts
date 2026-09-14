import { describe, expect, it } from 'vitest'

import {
  buildDiagnosticMessage,
  buildProtocolMessage,
  canonicalize,
  type CanonicalJsonObject,
} from '../../src/lib/protocol/canonical-json.js'

describe('canonical JSON', () => {
  it('sorts object keys recursively and emits no insignificant whitespace', () => {
    expect(canonicalize({ z: 2, a: { y: true, b: 'text' }, list: [3, 'x'] })).toBe(
      '{"a":{"b":"text","y":true},"list":[3,"x"],"z":2}',
    )
  })

  it('rejects unsafe and non-integer protocol numbers', () => {
    expect(() => canonicalize(1.5)).toThrow(/safe integers/u)
    expect(() => canonicalize(Number.MAX_SAFE_INTEGER + 1)).toThrow(/safe integers/u)
  })

  it('domain-separates and validates the embedded protocol type', () => {
    const payload: CanonicalJsonObject = {
      protocol: 'NR1',
      type: 'POLICY',
      version: 1,
    }
    expect(buildProtocolMessage('POLICY', payload)).toBe(
      'NIMRETURN/1/POLICY\n{"protocol":"NR1","type":"POLICY","version":1}',
    )
    expect(() => buildProtocolMessage('CLAIM', payload)).toThrow(/does not match/u)
  })

  it('uses a separate non-production domain for Phase 0 diagnostics', () => {
    expect(buildDiagnosticMessage('NQTEST', 'token')).toBe(
      'NIMRETURN/P0/DIAGNOSTIC\n{"expectedSigner":"NQTEST","nonce":"token"}',
    )
  })
})
