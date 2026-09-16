import type { NimiqProvider } from '@nimiq/mini-app-sdk'
import { useEffect, useState } from 'react'

import {
  authorizeClaim,
  ClaimApiError,
  createClaim,
  getClaim,
  getResolution,
  renewClaimAuthorization,
  submitClaim,
  type Claim,
  type ClaimResolution,
} from '../../lib/api/claims.js'
import { initializeNimiqProvider, normalizeWalletError, requestSignature } from '../../lib/nimiq/provider.js'
import type { PurchasePassport } from '../../lib/api/purchase.js'
import { getRefund, RefundApiError, type Refund } from '../../lib/api/refunds.js'
import { buildClaimProof } from './claim-proof.js'
import { clearClaimSession, loadClaimSession, saveClaimSession } from './claim-session.js'

type Notice = { kind: 'error' | 'info' | 'success'; message: string }
type Busy = 'authorize' | 'create' | 'renew' | 'restore' | 'sign' | null

function short(value: string): string {
  return value.length <= 18 ? value : `${value.slice(0, 9)}…${value.slice(-7)}`
}

function errorMessage(error: unknown): string {
  if (error instanceof ClaimApiError) return error.message
  return normalizeWalletError(error).message
}

function authorizationExpired(claim: Claim): boolean {
  const expiresAt = claim.authorization?.expiresAt
  return claim.authorization?.status === 'pending' && expiresAt !== null && expiresAt !== undefined
    && Date.parse(expiresAt) <= Date.now()
}

function unsignedClaimExpired(claim: Claim): boolean {
  return claim.signatureStatus === 'expired' || Date.parse(claim.challenge.expiresAt) <= Date.now()
}

export function BuyerClaimJourney({ passport }: { passport: PurchasePassport }) {
  const [initialClaimSession] = useState(() => loadClaimSession(passport.publicId))
  const [busy, setBusy] = useState<Busy>(initialClaimSession ? 'restore' : null)
  const [claim, setClaim] = useState<Claim | null>(null)
  const [resolution, setResolution] = useState<ClaimResolution | null>(null)
  const [refund, setRefund] = useState<Refund | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [provider, setProvider] = useState<NimiqProvider | null>(null)
  const [claimType, setClaimType] = useState<'RETURN' | 'WARRANTY'>(
    passport.policy.payload.returnWindowSeconds > 0 ? 'RETURN' : 'WARRANTY',
  )
  const [reasonCode, setReasonCode] = useState<'CHANGED_MIND' | 'DEFECTIVE' | 'NOT_AS_DESCRIBED' | 'OTHER'>('DEFECTIVE')
  const [note, setNote] = useState('')

  async function refreshResolution(nextClaim: Claim) {
    if (!['approved', 'rejected', 'decision_pending'].includes(nextClaim.workflowState)) {
      setResolution(null)
      return
    }
    try {
      const nextResolution = await getResolution(nextClaim.publicId)
      setResolution(nextResolution)
      if (nextResolution.decision === 'APPROVED') {
        try { setRefund(await getRefund(nextClaim.publicId)) } catch (error) {
          if (!(error instanceof RefundApiError && error.status === 404)) throw error
        }
      } else setRefund(null)
    } catch (error) {
      if (!(error instanceof ClaimApiError && error.status === 404)) throw error
    }
  }

  useEffect(() => {
    let active = true
    const session = initialClaimSession
    if (!session) {
      return () => { active = false }
    }
    void getClaim(session.claimPublicId)
      .then(async (restored) => {
        if (!active) return
        setClaim(restored)
        await refreshResolution(restored)
        if (active) setNotice({ kind: 'info', message: 'Recovered this claim without creating or signing another one.' })
      })
      .catch((error: unknown) => {
        if (active) setNotice({ kind: 'error', message: errorMessage(error) })
      })
      .finally(() => { if (active) setBusy(null) })
    return () => { active = false }
  }, [initialClaimSession])

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy('create')
    setNotice(null)
    try {
      const created = await createClaim({ claimType, note, passportPublicId: passport.publicId, reasonCode })
      saveClaimSession({ claimPublicId: created.publicId, passportPublicId: passport.publicId })
      setClaim(created)
      setResolution(null)
      setNotice({ kind: 'info', message: 'Canonical claim ready. Review the exact facts before opening Nimiq Pay.' })
    } catch (error) {
      setNotice({ kind: 'error', message: errorMessage(error) })
    } finally { setBusy(null) }
  }

  async function sign() {
    if (!claim) return
    setBusy('sign')
    setNotice({ kind: 'info', message: 'Review and sign the exact NR1 claim in Nimiq Pay.' })
    try {
      const activeProvider = provider ?? await initializeNimiqProvider()
      setProvider(activeProvider)
      const walletResult = await requestSignature(activeProvider, claim.challenge.canonicalMessage)
      const { proof, signerAddress } = buildClaimProof(claim.challenge.canonicalMessage, walletResult)
      const next = await submitClaim(claim.publicId, proof)
      setClaim(next)
      if (next.workflowState === 'authorization_pending') {
        setNotice({
          kind: 'info',
          message: `Claim signer ${short(signerAddress)} differs from the chain purchaser. The purchase wallet must approve this exact one-claim delegation.`,
        })
      } else {
        setNotice({
          kind: 'success',
          message: next.eligibility?.eligible
            ? 'Claim accepted and policy eligible. This is not a guaranteed remedy.'
            : 'Claim accepted but policy ineligible under the signed time window.',
        })
      }
    } catch (error) {
      setNotice({ kind: 'error', message: errorMessage(error) })
    } finally { setBusy(null) }
  }

  async function authorize() {
    const authorization = claim?.authorization
    if (!claim || !authorization?.canonicalMessage) return
    setBusy('authorize')
    setNotice({
      kind: 'info',
      message: `Nimiq Pay must sign this authorization with the purchase sender ${short(authorization.requiredSignerAddress)}.`,
    })
    try {
      const activeProvider = provider ?? await initializeNimiqProvider()
      setProvider(activeProvider)
      const walletResult = await requestSignature(activeProvider, authorization.canonicalMessage)
      const { proof, signerAddress } = buildClaimProof(authorization.canonicalMessage, walletResult)
      if (signerAddress !== authorization.requiredSignerAddress) {
        throw new Error(
          `Nimiq Pay signed with ${short(signerAddress)}, but this approval must come from the purchase account ${short(authorization.requiredSignerAddress)}. Switch the active account in Nimiq Pay to that address, then tap Authorize again. Nothing was submitted.`,
        )
      }
      const next = await authorizeClaim(claim.publicId, authorization.publicId, proof)
      setClaim(next)
      setNotice({
        kind: next.eligibility?.eligible ? 'success' : 'info',
        message: next.eligibility?.eligible
          ? 'Purchase-sender authorization verified. The claim is policy eligible—not a guaranteed remedy.'
          : 'Purchase-sender authorization verified. The claim is policy ineligible under the signed terms.',
      })
    } catch (error) {
      setNotice({ kind: 'error', message: errorMessage(error) })
    } finally { setBusy(null) }
  }

  async function renewAuthorization() {
    if (!claim) return
    setBusy('renew')
    try {
      const next = await renewClaimAuthorization(claim.publicId)
      setClaim(next)
      setNotice({ kind: 'info', message: 'A fresh purchase-wallet approval is ready. It stays valid for 10 minutes.' })
    } catch (error) {
      setNotice({ kind: 'error', message: errorMessage(error) })
    } finally { setBusy(null) }
  }

  async function refresh() {
    if (!claim) return
    setBusy('restore')
    try {
      const next = await getClaim(claim.publicId)
      setClaim(next)
      await refreshResolution(next)
      setNotice({ kind: 'info', message: 'Claim and merchant decision evidence refreshed.' })
    } catch (error) {
      setNotice({ kind: 'error', message: errorMessage(error) })
    } finally { setBusy(null) }
  }

  function startOver() {
    clearClaimSession()
    setClaim(null)
    setResolution(null)
    setRefund(null)
    setNotice(null)
  }

  const returnAvailable = passport.policy.payload.returnWindowSeconds > 0
  const warrantyAvailable = passport.policy.payload.warrantyWindowSeconds > 0
  if (!returnAvailable && !warrantyAvailable) return null

  return (
    <section className="claim-journey" aria-labelledby="claim-title">
      <div className="claim-journey__header">
        <div><p className="eyebrow">Phase 3 · signed lifecycle</p><h2 id="claim-title">Use the policy attached to this payment.</h2></div>
        {claim && <button className="text-button" type="button" disabled={busy !== null} onClick={() => void refresh()}>{busy === 'restore' ? 'Refreshing…' : 'Refresh status'}</button>}
      </div>
      <p className="claim-boundary">NimReturn evaluates the signed time window and records the merchant decision. It cannot prove condition or guarantee a refund.</p>
      {notice && <div className={`notice notice--${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.message}</div>}

      {!claim && (
        <form className="claim-form" onSubmit={(event) => void create(event)}>
          <div className="claim-type-picker" role="group" aria-label="Claim type">
            <button aria-pressed={claimType === 'RETURN'} className={claimType === 'RETURN' ? 'selected' : ''} type="button" disabled={!returnAvailable} onClick={() => setClaimType('RETURN')}><strong>Return</strong><span>{passport.deadlines.return ? `Through ${new Date(passport.deadlines.return).toLocaleDateString()}` : 'Not offered'}</span></button>
            <button aria-pressed={claimType === 'WARRANTY'} className={claimType === 'WARRANTY' ? 'selected' : ''} type="button" disabled={!warrantyAvailable} onClick={() => setClaimType('WARRANTY')}><strong>Warranty</strong><span>{passport.deadlines.warranty ? `Through ${new Date(passport.deadlines.warranty).toLocaleDateString()}` : 'Not offered'}</span></button>
          </div>
          <label>Reason<select value={reasonCode} onChange={(event) => setReasonCode(event.target.value as typeof reasonCode)}><option value="DEFECTIVE">Defective</option><option value="NOT_AS_DESCRIBED">Not as described</option><option value="CHANGED_MIND">Changed mind</option><option value="OTHER">Other</option></select></label>
          <label>Short note <span className="optional">Optional · avoid personal information</span><textarea maxLength={280} rows={3} value={note} onChange={(event) => setNote(event.target.value)} /></label>
          <button type="submit" disabled={busy !== null}>{busy === 'create' ? 'Creating canonical claim…' : 'Review claim for signing'}</button>
        </form>
      )}

      {claim && claim.workflowState === 'signature_requested' && unsignedClaimExpired(claim) && (
        <div className="claim-signing-card">
          <div className="claim-facts"><span>{claim.claimType}</span><strong>Signing window ended</strong><small>This unsigned claim expired before a verified signature reached NimReturn. Nothing was submitted to the merchant.</small></div>
          <button type="button" disabled={busy !== null} onClick={startOver}>Start a new claim</button>
        </div>
      )}

      {claim && claim.workflowState === 'signature_requested' && !unsignedClaimExpired(claim) && (
        <div className="claim-signing-card">
          <div className="claim-facts"><span>{claim.claimType}</span><strong>{claim.reasonCode.replaceAll('_', ' ')}</strong><small>Policy v{claim.policyVersion} · buyer copied from verified chain evidence</small></div>
          <p className="claim-boundary">For direct acceptance, sign with the purchase account <code>{short(claim.purchaseSenderAddress)}</code>. Another account needs a second approval from it.</p>
          <details className="evidence-details canonical-preview"><summary>Inspect exact claim bytes</summary><pre>{claim.challenge.canonicalMessage}</pre></details>
          <div className="hash-callout"><span>Claim payload hash</span><code>{claim.payloadHash}</code></div>
          <button type="button" disabled={busy !== null} onClick={() => void sign()}>{busy === 'sign' ? 'Waiting for Nimiq Pay…' : 'Sign claim with Nimiq Pay'}</button>
        </div>
      )}

      {claim?.workflowState === 'authorization_pending' && claim.authorization && (
        <div className="authorization-card">
          <p className="eyebrow">Second proof required</p><h3>Authorize this exact claim from the purchase wallet.</h3>
          <dl><div><dt>Claim signer</dt><dd><code>{claim.claimSignerAddress}</code></dd></div><div><dt>Required purchaser</dt><dd><code>{claim.authorization.requiredSignerAddress}</code></dd></div><div><dt>Claim hash</dt><dd><code>{claim.payloadHash}</code></dd></div></dl>
          <p>This grants no general account access. It binds only this immutable claim and signer. Switch Nimiq Pay to the required purchaser account before approving.</p>
          {authorizationExpired(claim)
            ? <button type="button" disabled={busy !== null} onClick={() => void renewAuthorization()}>{busy === 'renew' ? 'Preparing a fresh approval…' : 'Approval window ended · request a fresh one'}</button>
            : <button type="button" disabled={busy !== null} onClick={() => void authorize()}>{busy === 'authorize' ? 'Waiting for purchase wallet…' : 'Authorize exact claim with Nimiq Pay'}</button>}
        </div>
      )}

      {claim?.eligibility && (
        <div className={claim.eligibility.eligible ? 'eligibility-card eligibility-card--yes' : 'eligibility-card eligibility-card--no'}>
          <span>{claim.eligibility.eligible ? '✓' : '—'}</span><div><p className="eyebrow">Deterministic NR1 result</p><h3>Policy {claim.eligibility.eligible ? 'eligible' : 'ineligible'}</h3><p>{claim.eligibility.eligible ? 'The signed policy window includes this claim time. This does not guarantee a remedy.' : 'The signed policy rules do not include this claim time. Physical or legal rights are not inferred.'}</p></div>
          <dl><div><dt>Authorization</dt><dd>{claim.authorization?.mode === 'self' ? 'Signer = chain purchaser' : 'Purchase-sender delegation verified'}</dd></div><div><dt>Evaluator</dt><dd>{claim.eligibility.evaluatorVersion}</dd></div><div><dt>Inclusive deadline</dt><dd>{claim.eligibility.deadlineMs ? new Date(claim.eligibility.deadlineMs).toLocaleString() : 'Unavailable'}</dd></div><div><dt>Status</dt><dd>{claim.workflowState.replaceAll('_', ' ')}</dd></div></dl>
        </div>
      )}

      {resolution && (
        <div className={resolution.decision === 'APPROVED' ? 'resolution-card resolution-card--approved' : 'resolution-card'}>
          <p className="eyebrow">Merchant-signed decision</p><h3>{resolution.decision === 'APPROVED' ? 'Approved · refund not yet paid' : 'Rejected'}</h3><p>{resolution.note || resolution.reasonCode.replaceAll('_', ' ')}</p>
          <dl><div><dt>Signer</dt><dd><code>{resolution.policySignerAddress}</code></dd></div><div><dt>Proof</dt><dd>{resolution.status}</dd></div><div><dt>Expected refund</dt><dd>{resolution.approvedRefundLuna.toLocaleString()} Luna</dd></div><div><dt>Payload hash</dt><dd><code>{short(resolution.payloadHash)}</code></dd></div></dl>
        </div>
      )}

      {resolution?.decision === 'APPROVED' && refund && (
        <div className={refund.refund ? 'buyer-refund buyer-refund--verified' : 'buyer-refund'}>
          <p className="eyebrow">Phase 4 · independent payment evidence</p>
          <h3>{refund.refund ? 'Refund paid and verified' : 'Approved · refund still pending'}</h3>
          <p>{refund.refund ? 'NimReturn independently matched the purchase-bound settlement sender, original buyer, exact amount and data, execution, and macro finality.' : 'A signed approval is not a payment. This changes only after matching finalized chain evidence exists.'}</p>
          {refund.attempt && <dl><div><dt>Required sender</dt><dd><code>{refund.attempt.expectedPayment.sender}</code></dd></div><div><dt>Recipient</dt><dd><code>{refund.attempt.expectedPayment.recipient}</code></dd></div><div><dt>Amount</dt><dd>{refund.attempt.expectedPayment.valueLuna.toLocaleString()} Luna</dd></div><div><dt>State</dt><dd>{refund.attempt.state.replaceAll('_', ' ')}</dd></div>{refund.attempt.transaction && <><div><dt>Transaction</dt><dd><code>{short(refund.attempt.transaction.hash)}</code></dd></div><div><dt>Finalizing macro</dt><dd>{refund.attempt.transaction.finalizingBlockNumber ?? 'Pending'}</dd></div></>}</dl>}
        </div>
      )}

      {claim && ['approved', 'rejected'].includes(claim.workflowState) && <button className="button-secondary" type="button" onClick={startOver}>Start another available claim type</button>}
    </section>
  )
}
