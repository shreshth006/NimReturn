import { Hash, KeyPair, PrivateKey } from '@nimiq/core'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  CLAIM_PROOF_VERIFIER_VERSION,
  verifyClaimProof,
} from '../../server/domain/claim-proof.js'
import { buildClaimProof } from '../../src/features/claims/claim-proof.js'
import { submitClaim } from '../../src/lib/api/claims.js'
import { hashProtocolPayload } from '../../src/lib/crypto/nimiq-signature.js'
import {
  buildClaimAuthorizationMessage,
  buildClaimMessage,
  type ClaimAuthorizationPayload,
  type ClaimPayload,
} from '../../src/lib/protocol/claim.js'

const PRIVATE_KEY_A = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f'
const PRIVATE_KEY_B = '1f1e1d1c1b1a191817161514131211100f0e0d0c0b0a09080706050403020100'
const NOW = new Date('2026-09-15T00:00:00.000Z')
const UTF8_ENCODER = new TextEncoder()

function signer(privateKeyHex: string) {
  const privateKey = PrivateKey.fromHex(privateKeyHex)
  const keyPair = KeyPair.derive(privateKey)
  const address = keyPair.toAddress()
  try {
    return {
      address: address.toUserFriendlyAddress().replaceAll(' ', '').toUpperCase(),
      publicKey: keyPair.publicKey.toHex(),
      sign(message: string) {
        const messageBytes = UTF8_ENCODER.encode(message)
        const header = UTF8_ENCODER.encode(`\x16Nimiq Signed Message:\n${messageBytes.byteLength}`)
        const preimage = new Uint8Array(header.byteLength + messageBytes.byteLength)
        preimage.set(header)
        preimage.set(messageBytes, header.byteLength)
        const temporaryPrivateKey = PrivateKey.fromHex(privateKeyHex)
        const temporaryKeyPair = KeyPair.derive(temporaryPrivateKey)
        const signature = temporaryKeyPair.sign(Hash.computeSha256(preimage))
        try {
          return signature.toHex()
        } finally {
          signature.free()
          temporaryKeyPair.free()
          temporaryPrivateKey.free()
        }
      },
    }
  } finally {
    address.free()
    keyPair.free()
    privateKey.free()
  }
}

const buyer = signer(PRIVATE_KEY_A)
const delegate = signer(PRIVATE_KEY_B)
const claimPayload: ClaimPayload = {
  claimId: 'bC2v2Ws4EkuJNV0ydOduaw',
  claimType: 'RETURN',
  createdAt: NOW.getTime(),
  nonce: 'L2tiVv4suxPEkzpW3QW8xw',
  note: '',
  orderId: 'Nv2eFQ1dKby8j1h4PV4-4g',
  protocol: 'NR1',
  purchaseSenderAddress: buyer.address,
  reasonCode: 'DEFECTIVE',
  type: 'CLAIM',
}

function proof(message: string, selected = delegate) {
  return {
    canonicalMessage: message,
    payloadHash: hashProtocolPayload(message),
    publicKey: selected.publicKey,
    signature: selected.sign(message),
  }
}

describe('claim proof verification', () => {
  it('derives an unrestricted claim signer without pretending it is authorized', () => {
    const message = buildClaimMessage(claimPayload)
    const result = verifyClaimProof({
      challenge: {
        action: 'CLAIM',
        canonicalMessage: message,
        consumedAt: null,
        expectedSignerAddress: null,
        expiresAt: new Date(NOW.getTime() + 60_000),
        payload: claimPayload,
        payloadHash: hashProtocolPayload(message),
      },
      now: NOW,
      proof: proof(message),
    })
    expect(result).toMatchObject({
      actualSignerAddress: delegate.address,
      valid: true,
      verifierVersion: CLAIM_PROOF_VERIFIER_VERSION,
    })
    expect(delegate.address).not.toBe(buyer.address)
  })

  it('requires delegated authorization to derive to the chain purchase sender', () => {
    const payload: ClaimAuthorizationPayload = {
      authorizationId: '3vM8xK7JjqwYsHhd6b2yVQ',
      claimId: claimPayload.claimId,
      claimPayloadHash: hashProtocolPayload(buildClaimMessage(claimPayload)),
      claimSignerAddress: delegate.address,
      createdAt: NOW.getTime(),
      expiresAt: NOW.getTime() + 60_000,
      nonce: 'Z2dT3L9Vj9Q3nUeM6u7x4A',
      protocol: 'NR1',
      purchaseSenderAddress: buyer.address,
      type: 'CLAIM_AUTHORIZATION',
    }
    const message = buildClaimAuthorizationMessage(payload)
    const challenge = {
      action: 'CLAIM_AUTHORIZATION',
      canonicalMessage: message,
      consumedAt: null,
      expectedSignerAddress: buyer.address,
      expiresAt: new Date(payload.expiresAt),
      payload,
      payloadHash: hashProtocolPayload(message),
    } as const

    expect(verifyClaimProof({ challenge, now: NOW, proof: proof(message, buyer) }))
      .toMatchObject({ actualSignerAddress: buyer.address, valid: true })
    expect(verifyClaimProof({ challenge, now: NOW, proof: proof(message, delegate) }))
      .toMatchObject({ code: 'SIGNER_MISMATCH', valid: false })
  })

  it('rejects mutation, replay, expiry, and malformed proof evidence', () => {
    const message = buildClaimMessage(claimPayload)
    const challenge = {
      action: 'CLAIM',
      canonicalMessage: message,
      consumedAt: null,
      expectedSignerAddress: null,
      expiresAt: new Date(NOW.getTime() + 60_000),
      payload: claimPayload,
      payloadHash: hashProtocolPayload(message),
    } as const
    expect(verifyClaimProof({
      challenge,
      now: NOW,
      proof: { ...proof(message), canonicalMessage: `${message} ` },
    })).toMatchObject({ code: 'MESSAGE_MISMATCH', valid: false })
    expect(verifyClaimProof({
      challenge: { ...challenge, consumedAt: NOW },
      now: NOW,
      proof: proof(message),
    })).toMatchObject({ code: 'CHALLENGE_CONSUMED', valid: false })
    expect(verifyClaimProof({
      challenge: { ...challenge, expiresAt: NOW },
      now: NOW,
      proof: proof(message),
    })).toMatchObject({ code: 'CHALLENGE_EXPIRED', valid: false })
    expect(verifyClaimProof({
      challenge,
      now: NOW,
      proof: { ...proof(message), signature: '00' },
    })).toMatchObject({ code: 'INVALID_PROOF', valid: false })
  })
})

describe('client claim proof envelope', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('submits only the strict four-field envelope and keeps the signer for display', async () => {
    const message = buildClaimMessage(claimPayload)
    const built = buildClaimProof(message, {
      publicKey: buyer.publicKey.toUpperCase(),
      signature: buyer.sign(message).toUpperCase(),
    })
    expect(built.signerAddress).toBe(buyer.address)
    expect(Object.keys(built.proof).sort()).toEqual([
      'canonicalMessage',
      'payloadHash',
      'publicKey',
      'signature',
    ])

    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 500 }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(submitClaim(claimPayload.claimId, built.proof)).rejects.toMatchObject({
      name: 'ClaimApiError',
    })
    expect(fetchMock).toHaveBeenCalledOnce()
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(JSON.parse(init.body as string)).toEqual({ proof: built.proof })

    expect(verifyClaimProof({
      challenge: {
        action: 'CLAIM',
        canonicalMessage: message,
        consumedAt: null,
        expectedSignerAddress: null,
        expiresAt: new Date(NOW.getTime() + 60_000),
        payload: claimPayload,
        payloadHash: hashProtocolPayload(message),
      },
      now: NOW,
      proof: built.proof,
    })).toMatchObject({ actualSignerAddress: buyer.address, valid: true })
  })

  it('rejects a wallet result that does not sign the exact claim bytes', () => {
    const message = buildClaimMessage(claimPayload)
    expect(() => buildClaimProof(message, {
      publicKey: buyer.publicKey,
      signature: buyer.sign(`${message} `),
    })).toThrow()
  })
})
