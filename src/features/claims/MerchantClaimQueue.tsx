import type { NimiqProvider } from '@nimiq/mini-app-sdk'
import { useCallback, useEffect, useState } from 'react'

import {
  ClaimApiError,
  getMerchantClaims,
  getMerchantResolution,
  publishResolution,
  requestResolution,
  type ClaimResolution,
  type MerchantClaimQueueItem,
} from '../../lib/api/claims.js'
import {
  hashProtocolPayload,
  normalizeNimiqAddress,
  verifyNimiqMessageSignature,
} from '../../lib/crypto/nimiq-signature.js'
import {
  initializeNimiqProvider,
  normalizeWalletError,
  requestSignature,
} from '../../lib/nimiq/provider.js'
import { MerchantRefundJourney } from '../refunds/MerchantRefundJourney.js'

type Notice = { kind: 'error' | 'info' | 'success'; message: string }
type Decision = 'APPROVED' | 'REJECTED'
type Reason = 'INSUFFICIENT_INFORMATION' | 'POLICY_ACCEPTED' | 'POLICY_NOT_APPLICABLE' | 'OTHER'

function messageFor(error: unknown): string {
  if (error instanceof ClaimApiError) return error.message
  return normalizeWalletError(error).message
}

function short(value: string): string {
  return value.length <= 18 ? value : `${value.slice(0, 9)}…${value.slice(-7)}`
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

export function MerchantClaimQueue({
  merchantPublicId,
  onAuthorizationLost,
}: {
  merchantPublicId: string
  onAuthorizationLost?: () => void
}) {
  const [claims, setClaims] = useState<MerchantClaimQueueItem[]>([])
  const [selected, setSelected] = useState<MerchantClaimQueueItem | null>(null)
  const [challenge, setChallenge] = useState<ClaimResolution | null>(null)
  const [decision, setDecision] = useState<Decision>('APPROVED')
  const [reasonCode, setReasonCode] = useState<Reason>('POLICY_ACCEPTED')
  const [note, setNote] = useState('')
  const [provider, setProvider] = useState<NimiqProvider | null>(null)
  const [busy, setBusy] = useState<'load' | 'prepare' | 'sign' | null>('load')
  const [notice, setNotice] = useState<Notice | null>(null)
  const [verified, setVerified] = useState<ClaimResolution | null>(null)

  const recordError = useCallback((error: unknown) => {
    if (
      error instanceof ClaimApiError
      && error.status === 401
      && error.code === 'MERCHANT_AUTH_REQUIRED'
    ) {
      if (onAuthorizationLost) {
        onAuthorizationLost()
        return
      }
    }
    setNotice({ kind: 'error', message: messageFor(error) })
  }, [onAuthorizationLost])

  async function loadClaims(showNotice = false) {
    setBusy('load')
    try {
      const next = await getMerchantClaims(merchantPublicId)
      setClaims(next)
      if (showNotice) setNotice({ kind: 'info', message: 'The protected claim queue was refreshed.' })
    } catch (error) {
      recordError(error)
    } finally {
      setBusy(null)
    }
  }

  useEffect(() => {
    let active = true
    void getMerchantClaims(merchantPublicId)
      .then((next) => { if (active) setClaims(next) })
      .catch((error: unknown) => { if (active) recordError(error) })
      .finally(() => { if (active) setBusy(null) })
    return () => { active = false }
  }, [merchantPublicId, recordError])

  async function choose(item: MerchantClaimQueueItem) {
    setSelected(item)
    setChallenge(null)
    setVerified(null)
    setDecision(item.claim.eligibility === 'eligible' ? 'APPROVED' : 'REJECTED')
    setReasonCode(item.claim.eligibility === 'eligible' ? 'POLICY_ACCEPTED' : 'POLICY_NOT_APPLICABLE')
    setNote('')
    setNotice(null)
    if (item.resolution?.status === 'pending') {
      setBusy('load')
      try {
        const pending = await getMerchantResolution(item.claim.publicId, merchantPublicId)
        setChallenge(pending)
        setNotice({ kind: 'info', message: 'Recovered the exact pending decision. No new challenge was created.' })
      } catch (error) {
        recordError(error)
      } finally { setBusy(null) }
    }
  }

  async function prepare(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selected) return
    setBusy('prepare')
    setNotice(null)
    try {
      const next = await requestResolution({
        claimPublicId: selected.claim.publicId,
        decision,
        merchantPublicId,
        note,
        reasonCode,
      })
      setChallenge(next)
      setNotice({
        kind: 'info',
        message: `Review the exact ${decision.toLowerCase()} decision before opening Nimiq Pay. Only the original policy signer is accepted.`,
      })
    } catch (error) {
      recordError(error)
    } finally { setBusy(null) }
  }

  async function signAndPublish() {
    if (!selected || !challenge) return
    setBusy('sign')
    setNotice({ kind: 'info', message: `Nimiq Pay must sign with policy signer ${short(challenge.policySignerAddress)}.` })
    try {
      const activeProvider = provider ?? await initializeNimiqProvider()
      setProvider(activeProvider)
      const walletResult = await requestSignature(activeProvider, challenge.canonicalMessage)
      const publicKey = walletResult.publicKey.toLowerCase()
      const signature = walletResult.signature.toLowerCase()
      const proof = verifyNimiqMessageSignature({
        message: challenge.canonicalMessage,
        publicKey,
        signature,
      })
      if (!proof.signatureValid || !proof.actualSignerAddress) {
        throw new Error(proof.error ?? 'The resolution signature did not verify locally.')
      }
      const signerAddress = normalizeNimiqAddress(proof.actualSignerAddress)
      if (signerAddress !== normalizeNimiqAddress(challenge.policySignerAddress)) {
        throw new Error(`This wallet signed as ${signerAddress}; the policy requires ${challenge.policySignerAddress}.`)
      }
      const payloadHash = hashProtocolPayload(challenge.canonicalMessage)
      if (payloadHash !== challenge.payloadHash || proof.payloadHash !== challenge.payloadHash) {
        throw new Error('The wallet proof did not bind the exact server-issued resolution bytes.')
      }
      const result = await publishResolution({
        claimPublicId: selected.claim.publicId,
        merchantPublicId,
        proof: {
          canonicalMessage: challenge.canonicalMessage,
          payloadHash,
          publicKey,
          signature,
        },
        resolutionPublicId: challenge.publicId,
      })
      setVerified(result)
      setChallenge(null)
      setNotice({
        kind: 'success',
        message: result.decision === 'APPROVED'
          ? 'Merchant decision verified. Approval records the expected refund; it does not claim payment was sent.'
          : 'Merchant rejection and its signer proof were verified and published.',
      })
      await loadClaims()
    } catch (error) {
      recordError(error)
    } finally { setBusy(null) }
  }

  return (
    <section className="merchant-claims" aria-labelledby="merchant-claims-title">
      <div className="claim-journey__header">
        <div>
          <p className="eyebrow">Phase 3 · protected merchant queue</p>
          <h2 id="merchant-claims-title">Resolve verified claims.</h2>
        </div>
        <button className="text-button" type="button" disabled={busy !== null} onClick={() => void loadClaims(true)}>
          {busy === 'load' ? 'Refreshing…' : 'Refresh claims'}
        </button>
      </div>
      <p className="claim-boundary">Eligibility proves only that the signed policy window and purchase evidence match. Review the customer&apos;s reason independently before signing a decision.</p>
      {notice && <div className={`notice notice--${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.message}</div>}

      {busy === 'load' && claims.length === 0 && (
        <div className="empty-queue" role="status" aria-live="polite" aria-busy="true"><strong>Loading verified claims…</strong><span>Only authorized claims with reproducible eligibility evidence enter this queue.</span></div>
      )}

      {busy !== 'load' && claims.length === 0 && (
        <div className="empty-queue"><strong>No verified claims yet.</strong><span>Accepted customer claims will appear here without exposing wallet secrets.</span></div>
      )}

      <div className="claim-queue">
        {claims.map((item) => (
          <article className={`claim-queue-item${item.resolution?.decision === 'APPROVED' ? ' claim-queue-item--refund' : ''}`} key={item.claim.publicId}>
            <div className="claim-queue-item__top">
              <div><span>{item.claim.claimType}</span><h3>{item.productName}</h3></div>
              <strong className={`eligibility-pill eligibility-pill--${item.claim.eligibility}`}>Policy {item.claim.eligibility}</strong>
            </div>
            <p>{item.claim.note || item.claim.reasonCode.replaceAll('_', ' ')}</p>
            <dl>
              <div><dt>Claim time</dt><dd>{formatTime(item.claim.claimTime)}</dd></div>
              <div><dt>Authorization</dt><dd>{item.claim.claimSignerAddress === item.claim.purchaseSenderAddress ? 'Self · chain purchaser' : 'Delegated by chain purchaser'}</dd></div>
              <div><dt>Claim signer</dt><dd><code>{short(item.claim.claimSignerAddress)}</code></dd></div>
              <div><dt>Workflow</dt><dd>{item.claim.workflowState.replaceAll('_', ' ')}</dd></div>
            </dl>
            {item.resolution?.status === 'verified'
              ? <>
                  <div className="queue-resolution">Signed {item.resolution.decision.toLowerCase()} decision published.</div>
                  {item.resolution.decision === 'APPROVED' && <MerchantRefundJourney claimPublicId={item.claim.publicId} merchantPublicId={merchantPublicId} />}
                </>
              : <button className="button-secondary" type="button" disabled={busy !== null} onClick={() => void choose(item)}>{item.resolution?.status === 'pending' ? 'Resume pending decision' : 'Review and sign decision'}</button>}
          </article>
        ))}
      </div>

      {selected && !challenge && !verified && (
        <form className="resolution-composer" onSubmit={(event) => void prepare(event)}>
          <div><p className="eyebrow">Merchant decision</p><h3>{selected.productName} · {selected.claim.claimType.toLowerCase()}</h3></div>
          <div className="decision-picker" role="group" aria-label="Resolution decision">
            <button aria-pressed={decision === 'APPROVED'} className={decision === 'APPROVED' ? 'selected' : ''} type="button" onClick={() => { setDecision('APPROVED'); setReasonCode('POLICY_ACCEPTED') }}>Approve full refund</button>
            <button aria-pressed={decision === 'REJECTED'} className={decision === 'REJECTED' ? 'selected' : ''} type="button" onClick={() => { setDecision('REJECTED'); setReasonCode('POLICY_NOT_APPLICABLE') }}>Reject claim</button>
          </div>
          <label>Reason<select value={reasonCode} onChange={(event) => setReasonCode(event.target.value as Reason)}><option value="POLICY_ACCEPTED">Policy accepted</option><option value="POLICY_NOT_APPLICABLE">Policy not applicable</option><option value="INSUFFICIENT_INFORMATION">Insufficient information</option><option value="OTHER">Other</option></select></label>
          <label>Public decision note <span className="optional">Optional · avoid personal information</span><textarea maxLength={280} rows={3} value={note} onChange={(event) => setNote(event.target.value)} /></label>
          <button type="submit" disabled={busy !== null}>{busy === 'prepare' ? 'Building exact decision…' : 'Review canonical decision'}</button>
        </form>
      )}

      {selected && challenge && (
        <div className="resolution-signing">
          <p className="eyebrow">Exact merchant-signed result</p>
          <h3>{challenge.decision === 'APPROVED' ? 'Approve full refund' : 'Reject claim'}</h3>
          <dl>
            <div><dt>Required policy signer</dt><dd><code>{challenge.policySignerAddress}</code></dd></div>
            <div><dt>Approved amount</dt><dd>{challenge.approvedRefundLuna.toLocaleString()} Luna</dd></div>
            <div><dt>Reason</dt><dd>{challenge.reasonCode.replaceAll('_', ' ')}</dd></div>
            <div><dt>Challenge expires</dt><dd>{formatTime(challenge.expiresAt)}</dd></div>
          </dl>
          <div className="hash-callout"><span>Resolution payload hash</span><code>{challenge.payloadHash}</code></div>
          <details className="evidence-details canonical-preview"><summary>Inspect exact resolution bytes</summary><pre>{challenge.canonicalMessage}</pre></details>
          <button type="button" disabled={busy !== null} onClick={() => void signAndPublish()}>{busy === 'sign' ? 'Waiting for Nimiq Pay…' : 'Sign exact decision with Nimiq Pay'}</button>
          <button className="text-button" type="button" disabled={busy !== null} onClick={() => setChallenge(null)}>Change decision</button>
        </div>
      )}

      {verified && (
        <div className="resolution-card resolution-card--approved">
          <p className="eyebrow">Verified merchant signature</p>
          <h3>{verified.decision === 'APPROVED' ? 'Approved · refund not yet paid' : 'Rejected'}</h3>
          <dl><div><dt>Signer</dt><dd><code>{verified.signerAddress}</code></dd></div><div><dt>Resolution ID</dt><dd><code>{verified.publicId}</code></dd></div><div><dt>Payload hash</dt><dd><code>{verified.payloadHash}</code></dd></div><div><dt>Server verification</dt><dd>{verified.verifiedAt ? formatTime(verified.verifiedAt) : verified.status}</dd></div></dl>
        </div>
      )}
    </section>
  )
}
