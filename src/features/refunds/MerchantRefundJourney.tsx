import type { NimiqProvider } from '@nimiq/mini-app-sdk'
import { useEffect, useState } from 'react'

import {
  attachRefundTransaction,
  createRefund,
  getRefund,
  recheckRefund,
  reconcileRefundOutcome,
  recordRefundState,
  RefundApiError,
  type Refund,
} from '../../lib/api/refunds.js'
import {
  assertWalletConsensusForPayment,
  initializeNimiqProvider,
  normalizeWalletError,
  readProviderNetwork,
  sendTransactionWithData,
} from '../../lib/nimiq/provider.js'
import {
  clearRefundSession,
  loadRefundSession,
  saveRefundSession,
} from './refund-session.js'

type Notice = { kind: 'error' | 'info' | 'success'; message: string }

function formatNim(luna: number): string {
  return (luna / 100_000).toLocaleString(undefined, { maximumFractionDigits: 5 })
}

function short(value: string): string {
  return value.length <= 18 ? value : `${value.slice(0, 9)}…${value.slice(-7)}`
}

function claimKeyRule(refund: Refund | null): boolean {
  return refund?.attempt?.recipientRule === 'claim-key-v2'
}

function message(error: unknown): string {
  if (error instanceof RefundApiError) return error.message
  return normalizeWalletError(error).message
}

export function MerchantRefundJourney({
  claimPublicId,
  merchantPublicId,
}: {
  claimPublicId: string
  merchantPublicId: string
}) {
  const [refund, setRefund] = useState<Refund | null>(null)
  const [provider, setProvider] = useState<NimiqProvider | null>(null)
  const [busy, setBusy] = useState<'load' | 'pay' | 'reconcile' | 'verify' | null>('load')
  const [notice, setNotice] = useState<Notice | null>(null)
  const [manualHash, setManualHash] = useState('')

  useEffect(() => {
    let active = true
    async function restore() {
      try {
        let current = await getRefund(claimPublicId)
        const session = loadRefundSession(claimPublicId)
        if (session?.transactionHash && current.attempt?.publicId === session.attemptPublicId && !current.attempt.transaction) {
          current = await attachRefundTransaction(merchantPublicId, claimPublicId, session.attemptPublicId, session.transactionHash)
        } else if (current.attempt?.state === 'wallet_request_started') {
          current = await recordRefundState(merchantPublicId, claimPublicId, current.attempt.publicId, 'submission-outcome-unknown')
        }
        if (!active) return
        setRefund(current)
        if (session?.transactionHash && current.attempt?.state !== 'refunded') {
          setNotice({ kind: 'info', message: 'Recovered the submitted refund hash without opening another payment request.' })
        }
      } catch (error) {
        if (active && !(error instanceof RefundApiError && error.status === 404)) {
          setNotice({ kind: 'error', message: message(error) })
        }
      } finally { if (active) setBusy(null) }
    }
    void restore()
    return () => { active = false }
  }, [claimPublicId, merchantPublicId])

  async function pay() {
    setBusy('pay')
    setNotice(null)
    let current = refund
    let nativeRequestBegan = false
    try {
      if (!current?.attempt || ['payment_cancelled', 'payment_failed'].includes(current.attempt.state)) {
        clearRefundSession()
        current = await createRefund(merchantPublicId, claimPublicId)
        setRefund(current)
      }
      const attempt = current.attempt
      if (!attempt) throw new Error('NimReturn did not return a refund attempt.')
      saveRefundSession({ attemptPublicId: attempt.publicId, claimPublicId })

      const activeProvider = provider ?? await initializeNimiqProvider()
      setProvider(activeProvider)
      const network = await readProviderNetwork(activeProvider)
      assertWalletConsensusForPayment(network)
      current = await recordRefundState(merchantPublicId, claimPublicId, attempt.publicId, 'wallet-request-started')
      setRefund(current)
      setNotice({
        kind: 'info',
        message: attempt.recipientRule === 'claim-key-v2'
          ? `Review the native refund: ${formatNim(attempt.expectedPayment.valueLuna)} NIM to the buyer's purchase claim key ${short(attempt.expectedPayment.recipient)}.`
          : `Review the native refund carefully. It must actually send from ${short(attempt.expectedPayment.sender)}; NimReturn cannot select that wallet account.`,
      })
      nativeRequestBegan = true
      const transactionHash = await sendTransactionWithData(activeProvider, network, {
        data: attempt.expectedPayment.data,
        recipient: attempt.expectedPayment.recipient,
        validityStartHeight: network.blockNumber,
        value: attempt.expectedPayment.valueLuna,
      })
      saveRefundSession({
        attemptPublicId: attempt.publicId,
        claimPublicId,
        transactionHash,
      })
      setNotice({ kind: 'info', message: 'Refund submitted. NimReturn is independently verifying sender, fields, execution, and macro finality.' })
      const next = await attachRefundTransaction(merchantPublicId, claimPublicId, attempt.publicId, transactionHash)
      setRefund(next)
      if (next.attempt?.state === 'refunded') {
        clearRefundSession()
        setNotice({
          kind: 'success',
          message: claimKeyRule(next)
            ? 'Refund verified to the purchase claim key; the actual sender is recorded as evidence.'
            : 'Refund verified from the purchase-bound settlement address.',
        })
      }
    } catch (error) {
      const attempt = current?.attempt
      const session = loadRefundSession(claimPublicId)
      const walletError = normalizeWalletError(error)
      if (attempt && session?.transactionHash) {
        setNotice({ kind: 'error', message: 'The refund hash is saved but verification did not finish. Recheck below; do not send another refund.' })
      } else if (attempt && nativeRequestBegan && walletError.kind === 'cancelled') {
        try { setRefund(await recordRefundState(merchantPublicId, claimPublicId, attempt.publicId, 'wallet-cancelled')) } catch { /* status read remains authoritative */ }
        clearRefundSession()
        setNotice({ kind: 'info', message: 'Refund cancelled. No paid status was created; a fresh attempt can be started safely.' })
      } else if (attempt && nativeRequestBegan) {
        try { setRefund(await recordRefundState(merchantPublicId, claimPublicId, attempt.publicId, 'submission-outcome-unknown')) } catch { /* preserve the original failure */ }
        setNotice({ kind: 'error', message: 'The native request began but its outcome is unknown. Do not send again; check the chain for this refund below.' })
      } else {
        setNotice({ kind: 'error', message: message(error) })
      }
    } finally { setBusy(null) }
  }

  async function verifyAgain() {
    const attempt = refund?.attempt
    if (!attempt) return
    setBusy('verify')
    setNotice({ kind: 'info', message: 'Rechecking exact fields, execution, and following-macro finality…' })
    try {
      const session = loadRefundSession(claimPublicId)
      const next = !attempt.transaction && session?.transactionHash
        ? await attachRefundTransaction(merchantPublicId, claimPublicId, attempt.publicId, session.transactionHash)
        : await recheckRefund(merchantPublicId, claimPublicId, attempt.publicId)
      setRefund(next)
      if (next.attempt?.state === 'refunded') {
        clearRefundSession()
        setNotice({ kind: 'success', message: 'Refund chain evidence is verified and the Passport is marked refunded.' })
      } else {
        setNotice({ kind: 'info', message: next.attempt?.transaction?.reason ?? 'The refund is not final yet.' })
      }
    } catch (error) {
      setNotice({ kind: 'error', message: message(error) })
    } finally { setBusy(null) }
  }

  async function attachRecoveredHash(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const attempt = refund?.attempt
    if (!attempt) return
    setBusy('verify')
    setNotice({ kind: 'info', message: 'Attaching the recovered public hash for independent verification…' })
    try {
      const transactionHash = manualHash.trim().toLowerCase()
      saveRefundSession({ attemptPublicId: attempt.publicId, claimPublicId, transactionHash })
      const next = await attachRefundTransaction(merchantPublicId, claimPublicId, attempt.publicId, transactionHash)
      setRefund(next)
      setManualHash('')
      if (next.attempt?.state === 'refunded') {
        clearRefundSession()
        setNotice({ kind: 'success', message: 'Recovered refund verified from independent chain evidence.' })
      } else setNotice({ kind: 'info', message: next.attempt?.transaction?.reason ?? 'The recovered refund is not final yet.' })
    } catch (error) {
      setNotice({ kind: 'error', message: message(error) })
    } finally { setBusy(null) }
  }

  async function reconcileUnknownOutcome() {
    const attempt = refund?.attempt
    if (!attempt) return
    setBusy('reconcile')
    setNotice({ kind: 'info', message: 'Searching the chain for a transaction carrying this refund tag…' })
    try {
      const result = await reconcileRefundOutcome(merchantPublicId, claimPublicId, attempt.publicId)
      setRefund(result.refund)
      if (result.result === 'recovered') {
        saveRefundSession({ attemptPublicId: attempt.publicId, claimPublicId, transactionHash: result.transactionHash })
        setNotice({
          kind: result.refund.attempt?.state === 'refunded' ? 'success' : 'info',
          message: `Found refund transaction ${short(result.transactionHash)} on chain. ${result.refund.attempt?.transaction?.reason ?? ''}`.trim(),
        })
      } else if (result.result === 'ruled-out') {
        clearRefundSession()
        setNotice({ kind: 'success', message: 'No refund was sent, and the original request can no longer be accepted by the network. A new refund can be started safely.' })
      } else {
        const remaining = Math.max(0, result.safeAfterHeight - result.headBlockNumber)
        setNotice({
          kind: 'info',
          message: `No refund transaction found yet. The original request could still be accepted until block ${result.safeAfterHeight.toLocaleString()} (about ${Math.ceil(remaining / 60).toLocaleString()} minutes). Check again after that; do not send another refund.`,
        })
      }
    } catch (error) {
      setNotice({ kind: 'error', message: message(error) })
    } finally { setBusy(null) }
  }

  const attempt = refund?.attempt
  const usesClaimKey = attempt?.recipientRule === 'claim-key-v2'
  const ambiguous = attempt?.state === 'submission_outcome_unknown'
  const canPay = !ambiguous && (!attempt || ['payment_requested', 'payment_cancelled', 'payment_failed'].includes(attempt.state))
  const canVerify = Boolean(attempt?.transaction || loadRefundSession(claimPublicId)?.transactionHash)

  return (
    <div className="merchant-refund">
      <div className="merchant-refund__heading"><p className="eyebrow">Phase 4 · direct verified refund</p><h3>{attempt?.state === 'refunded' ? 'Refund verified' : 'Approval is not payment.'}</h3></div>
      <p>{usesClaimKey
        ? 'NIM moves directly from the merchant wallet to the purchase claim key the buyer signed before paying. NimReturn never holds funds; the verified signed approval authorizes the refund and the actual sender is recorded as evidence.'
        : 'NIM moves directly from the merchant wallet to the original chain buyer. NimReturn never holds funds and accepts only the purchase-bound settlement address as sender.'}</p>
      {notice && <div className={`notice notice--${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.message}</div>}
      {busy === 'load' && !attempt && <div className="empty-queue" role="status" aria-live="polite" aria-busy="true"><strong>Loading refund evidence…</strong><span>Approval remains separate from verified payment while this read completes.</span></div>}

      {attempt && (
        <dl className="refund-expectation">
          <div><dt>{usesClaimKey ? 'Signed settlement address · sender recorded, not required' : 'Required chain sender'}</dt><dd><code>{attempt.expectedPayment.sender}</code></dd></div>
          <div><dt>{usesClaimKey ? 'Recipient · purchase claim key' : 'Original buyer recipient'}</dt><dd><code>{attempt.expectedPayment.recipient}</code></dd></div>
          <div><dt>Exact amount</dt><dd>{formatNim(attempt.expectedPayment.valueLuna)} NIM <small>{attempt.expectedPayment.valueLuna.toLocaleString()} Luna</small></dd></div>
          <div><dt>Exact data</dt><dd><code>{attempt.expectedPayment.data}</code></dd></div>
          <div><dt>Attempt state</dt><dd>{attempt.state.replaceAll('_', ' ')}</dd></div>
          <div><dt>Sender selection</dt><dd>{usesClaimKey ? 'Wallet-controlled · recorded as evidence' : 'Wallet-controlled · independently checked'}</dd></div>
          {attempt.outcome.ruledOutAt && <div><dt>Previous request</dt><dd>Ruled out at block {attempt.outcome.ruledOutHeight?.toLocaleString()}</dd></div>}
        </dl>
      )}

      {ambiguous && <div className="ambiguity-lock"><strong>Do not send another refund.</strong><span>Check the chain for this refund. A matching transaction is recovered automatically; otherwise a new refund unlocks only after the original request can no longer be accepted{attempt.outcome.safeAfterHeight ? ` (block ${attempt.outcome.safeAfterHeight.toLocaleString()})` : ''}.</span></div>}
      {ambiguous && <button type="button" disabled={busy !== null} onClick={() => void reconcileUnknownOutcome()}>{busy === 'reconcile' ? 'Checking the chain…' : 'Check the chain for this refund'}</button>}
      {ambiguous && (
        <form className="recovered-hash" onSubmit={(event) => void attachRecoveredHash(event)}>
          <label>Recovered transaction hash<input required autoComplete="off" spellCheck={false} minLength={64} maxLength={64} pattern="[0-9a-fA-F]{64}" value={manualHash} onChange={(event) => setManualHash(event.target.value)} placeholder="64 hexadecimal characters" /></label>
          <button type="submit" disabled={busy !== null}>{busy === 'verify' ? 'Verifying recovered hash…' : 'Attach hash and verify'}</button>
        </form>
      )}
      {canPay && <button type="button" disabled={busy !== null} onClick={() => void pay()}>{busy === 'pay' ? 'Waiting for Nimiq Pay…' : `${attempt?.state === 'payment_cancelled' || attempt?.state === 'payment_failed' ? 'Start new' : 'Send'} ${attempt ? formatNim(attempt.expectedPayment.valueLuna) : 'approved'} refund`}</button>}
      {canVerify && attempt && attempt.state !== 'refunded' && <button className="button-secondary" type="button" disabled={busy !== null} onClick={() => void verifyAgain()}>{busy === 'verify' ? 'Checking finality…' : 'Recheck refund transaction'}</button>}

      {attempt?.transaction && (
        <div className={attempt.state === 'refunded' ? 'refund-receipt refund-receipt--verified' : 'refund-receipt'}>
          <p className="eyebrow">Independent chain evidence</p><strong>{attempt.state === 'refunded' ? 'Paid and macro-final' : attempt.transaction.reason}</strong>
          <dl><div><dt>Hash</dt><dd><code>{attempt.transaction.hash}</code></dd></div><div><dt>Observed sender</dt><dd><code>{attempt.transaction.sender ?? 'Pending'}</code></dd></div><div><dt>Execution</dt><dd>{attempt.transaction.executionResult === null ? 'Pending' : String(attempt.transaction.executionResult)}</dd></div><div><dt>Finalizing macro</dt><dd>{attempt.transaction.finalizingBlockNumber ?? 'Pending'}</dd></div></dl>
          {attempt.transaction.reconciliation && <p>{attempt.transaction.reconciliation.reason}</p>}
        </div>
      )}
    </div>
  )
}
