import type { NimiqProvider, SignatureResult } from '@nimiq/mini-app-sdk'
import { useMemo, useState } from 'react'

import { verifyDiagnosticTransaction } from '../../lib/api/diagnostics.js'
import { normalizeNimiqAddress } from '../../lib/crypto/nimiq-signature.js'
import {
  assertWalletConsensusForPayment,
  initializeNimiqProvider,
  normalizeWalletError,
  readProviderNetwork,
  requestAccounts,
  requestSignature,
  sendTransactionWithData,
  type ProviderNetworkSnapshot,
} from '../../lib/nimiq/provider.js'
import { buildDiagnosticMessage } from '../../lib/protocol/canonical-json.js'
import {
  encodePurchaseTag,
  generateProtocolToken,
  transactionTagByteLength,
} from '../../lib/protocol/transaction-data.js'
import { buildPhaseZeroEvidence } from './evidence.js'
import {
  classifyRpcVerification,
  extractRpcObservedEvidence,
  initialRpcVerificationState,
  isRpcRetryDisabled,
  rpcFailureState,
  rpcOutcomeLabel,
  rpcRetryLabel,
  type RpcVerificationOutcome,
} from './rpc-verification.js'
import {
  verifyDiagnosticSigner,
  type DiagnosticSignerVerification,
} from './signer-identity.js'
import {
  DEFAULT_DIAGNOSTIC_VALUE_LUNA,
  clearPhaseZeroPaymentRecord,
  createSubmittedTransaction,
  createUnknownSubmission,
  isDiagnosticPaymentLocked,
  loadPhaseZeroPaymentRecord,
  persistPhaseZeroPaymentRecord,
  requiresClearConfirmation,
  submittedTransactionFromRecord,
} from './transaction-record.js'

type StepStatus =
  | 'cancelled'
  | 'failed'
  | 'idle'
  | 'pending'
  | 'ready'
  | 'sent'
  | 'verified'
  | 'warning'

interface StatusState {
  detail: string
  status: StepStatus
}

const initialStatus: StatusState = { status: 'idle', detail: 'Not run yet.' }

function providerNetworkState(snapshot: ProviderNetworkSnapshot): StatusState {
  return {
    status: snapshot.consensus ? 'ready' : 'failed',
    detail: snapshot.consensus
      ? 'Provider reachable, head available at block '
        + snapshot.blockNumber.toLocaleString()
        + ', and consensus established.'
      : 'Provider reachable and head available at block '
        + snapshot.blockNumber.toLocaleString()
        + ', but wallet consensus is not established. This is network state, not account state. Payment remains locked; wait and retry.',
  }
}

function short(value: string, visible = 10): string {
  if (value.length <= visible * 2 + 1) return value
  return `${value.slice(0, visible)}…${value.slice(-visible)}`
}

function resultStatus(status: StepStatus): string {
  switch (status) {
    case 'ready':
      return 'Ready'
    case 'verified':
      return 'Verified'
    case 'pending':
      return 'Working'
    case 'sent':
      return 'Sent · unverified'
    case 'cancelled':
      return 'Cancelled'
    case 'failed':
      return 'Needs attention'
    case 'warning':
      return 'Attention'
    default:
      return 'Not run'
  }
}

function errorState(error: unknown): StatusState {
  const normalized = normalizeWalletError(error)
  return {
    status: normalized.kind === 'cancelled' ? 'cancelled' : 'failed',
    detail: normalized.message,
  }
}

function rpcStepStatus(outcome: RpcVerificationOutcome): StepStatus {
  if (outcome === 'verified') return 'verified'
  if (outcome === 'invalid') return 'failed'
  if (outcome === 'pending-finality' || outcome === 'pending-inclusion') return 'pending'
  if (outcome === 'inconclusive') return 'warning'
  return 'idle'
}

export function PhaseZeroDiagnostics() {
  const [paymentRecord, setPaymentRecord] = useState(loadPhaseZeroPaymentRecord)
  const [paymentRecordRestored, setPaymentRecordRestored] = useState(
    () => paymentRecord !== null,
  )
  const [provider, setProvider] = useState<NimiqProvider | null>(null)
  const [providerState, setProviderState] = useState<StatusState>(initialStatus)
  const [accounts, setAccounts] = useState<string[]>([])
  const [selectedAccount, setSelectedAccount] = useState('')
  const [accountState, setAccountState] = useState<StatusState>(initialStatus)
  const [network, setNetwork] = useState<ProviderNetworkSnapshot | null>(null)
  const [networkState, setNetworkState] = useState<StatusState>(initialStatus)
  const [networkCheckedAtUtc, setNetworkCheckedAtUtc] = useState<string | null>(null)
  const [diagnosticNonce, setDiagnosticNonce] = useState(() => generateProtocolToken())
  const [signature, setSignature] = useState<SignatureResult | null>(null)
  const [signatureVerification, setSignatureVerification] =
    useState<DiagnosticSignerVerification | null>(null)
  const [signatureState, setSignatureState] = useState<StatusState>(initialStatus)
  const [recipient, setRecipient] = useState(() => paymentRecord?.recipient ?? '')
  const [valueLuna, setValueLuna] = useState(
    () => String(paymentRecord?.valueLuna ?? DEFAULT_DIAGNOSTIC_VALUE_LUNA),
  )
  const [paymentToken, setPaymentToken] = useState(() => generateProtocolToken())
  const [acknowledged, setAcknowledged] = useState(false)
  const [paymentState, setPaymentState] = useState<StatusState>(() => {
    if (paymentRecord?.status === 'submitted') {
      return {
        status: 'sent',
        detail: 'Previous submitted diagnostic transaction restored. Do not send another transaction.',
      }
    }
    if (paymentRecord?.status === 'submission-outcome-unknown') {
      return {
        status: 'warning',
        detail: 'Previous submission outcome is unknown. Check wallet history and the chain before sending again.',
      }
    }
    return initialStatus
  })
  const [rpcVerification, setRpcVerification] = useState(initialRpcVerificationState)
  const [rpcRequestInFlight, setRpcRequestInFlight] = useState(false)
  const [rpcDetails, setRpcDetails] = useState<unknown>(null)
  const [evidenceSnapshot, setEvidenceSnapshot] = useState('')
  const [devicePlatform, setDevicePlatform] = useState('')
  const [osVersion, setOsVersion] = useState('')
  const [nimiqPayVersion, setNimiqPayVersion] = useState('')

  const canonicalAccount = useMemo(() => {
    if (!selectedAccount) return ''
    try {
      return normalizeNimiqAddress(selectedAccount)
    } catch {
      return selectedAccount
    }
  }, [selectedAccount])
  const signMessage = useMemo(
    () => buildDiagnosticMessage(canonicalAccount || 'NO_ACCOUNT_SELECTED', diagnosticNonce),
    [canonicalAccount, diagnosticNonce],
  )
  const sentTransaction = useMemo(
    () => submittedTransactionFromRecord(paymentRecord),
    [paymentRecord],
  )
  const transactionData = useMemo(
    () => paymentRecord?.data ?? encodePurchaseTag(paymentToken),
    [paymentRecord, paymentToken],
  )
  const rpcObserved = useMemo(
    () => extractRpcObservedEvidence(rpcDetails, sentTransaction?.walletAccounts ?? []),
    [rpcDetails, sentTransaction],
  )

  async function initialize() {
    setProviderState({ status: 'pending', detail: 'Waiting for Nimiq Pay to inject the provider…' })
    setNetwork(null)
    setNetworkState(initialStatus)
    setNetworkCheckedAtUtc(null)
    try {
      const initialized = await initializeNimiqProvider()
      setProvider(initialized)
      setProviderState({ status: 'ready', detail: 'Injected Nimiq provider is available.' })
    } catch (error) {
      setProvider(null)
      setProviderState(errorState(error))
    }
  }

  async function connectAccounts() {
    if (!provider) return
    setAccountState({ status: 'pending', detail: 'Awaiting native account permission…' })
    try {
      const available = await requestAccounts(provider)
      setAccounts(available)
      setSelectedAccount(available[0] ?? '')
      setAccountState({ status: 'ready', detail: `${available.length} account(s) returned.` })
      setSignature(null)
      setSignatureVerification(null)
      setSignatureState(initialStatus)
    } catch (error) {
      setAccountState(errorState(error))
    }
  }

  async function readNetwork() {
    if (!provider) return
    setNetwork(null)
    setNetworkState({ status: 'pending', detail: 'Reading wallet consensus and head height…' })
    try {
      const snapshot = await readProviderNetwork(provider)
      setNetwork(snapshot)
      setNetworkCheckedAtUtc(new Date().toISOString())
      setNetworkState(providerNetworkState(snapshot))
    } catch (error) {
      setNetwork(null)
      setNetworkCheckedAtUtc(new Date().toISOString())
      setNetworkState(errorState(error))
    }
  }

  async function signAndVerify() {
    if (!provider || !selectedAccount) return
    setSignatureState({ status: 'pending', detail: 'Awaiting native signature approval…' })
    try {
      const proof = await requestSignature(provider, signMessage)
      const verification = verifyDiagnosticSigner({
        expectedAccount: selectedAccount,
        listedAccounts: accounts,
        message: signMessage,
        proof,
      })
      setSignature(proof)
      setSignatureVerification(verification)
      const expectedAccountMismatch = verification.valid && !verification.expectedMatchesSigner
      setSignatureState({
        status: expectedAccountMismatch ? 'warning' : verification.valid ? 'verified' : 'failed',
        detail: expectedAccountMismatch
          ? 'Signature is valid, but Nimiq Pay signed with a different listed wallet account than the diagnostic expectation.'
          : verification.valid
            ? 'Exact framed signature verified and the actual signer is listed by the wallet.'
            : verification.signatureValid
              ? 'Signature is valid, but the derived signer is not in the wallet account list.'
              : verification.error ?? 'The framed signature did not verify.',
      })
    } catch (error) {
      setSignature(null)
      setSignatureVerification(null)
      setSignatureState(errorState(error))
    }
  }

  function changeAccount(value: string) {
    setSelectedAccount(value)
    setDiagnosticNonce(generateProtocolToken())
    setSignature(null)
    setSignatureVerification(null)
    setSignatureState(initialStatus)
  }

  async function sendPayment() {
    if (!provider || accounts.length === 0 || !acknowledged || paymentRecord) return
    setPaymentState({ status: 'pending', detail: 'Validating the irreversible test request…' })
    setRpcDetails(null)
    setRpcVerification(initialRpcVerificationState)

    let nativeRequestStarted = false
    let requestContext: Parameters<typeof createUnknownSubmission>[0] | null = null

    try {
      const canonicalRecipient = normalizeNimiqAddress(recipient)
      const amount = Number(valueLuna)
      if (!/^\d+$/u.test(valueLuna) || !Number.isSafeInteger(amount) || amount <= 0) {
        throw new Error('Amount must be a positive safe integer number of Luna.')
      }

      setNetwork(null)
      setNetworkState({ status: 'pending', detail: 'Rechecking wallet consensus and head height…' })
      const snapshot = await readProviderNetwork(provider).catch((error: unknown) => {
        setNetworkCheckedAtUtc(new Date().toISOString())
        setNetworkState(errorState(error))
        throw error
      })
      setNetwork(snapshot)
      setNetworkCheckedAtUtc(new Date().toISOString())
      setNetworkState(providerNetworkState(snapshot))
      assertWalletConsensusForPayment(snapshot)

      requestContext = {
        data: transactionData,
        network: snapshot,
        recipient: canonicalRecipient,
        submittedAtUtc: new Date().toISOString(),
        validityStartHeight: snapshot.blockNumber,
        valueLuna: amount,
        walletAccounts: [...accounts],
      }
      setPaymentState({ status: 'pending', detail: 'Awaiting native payment approval…' })
      nativeRequestStarted = true
      const hash = await sendTransactionWithData(provider, snapshot, {
        recipient: canonicalRecipient,
        value: amount,
        data: transactionData,
        validityStartHeight: snapshot.blockNumber,
      })
      const submitted = createSubmittedTransaction({
        ...requestContext,
        hash,
        submittedAtUtc: new Date().toISOString(),
      })
      const persisted = persistPhaseZeroPaymentRecord(submitted)
      setPaymentRecord(submitted)
      setPaymentRecordRestored(false)
      setPaymentState({
        status: 'sent',
        detail: persisted
          ? 'Transaction submitted and preserved for reload recovery. This is not payment verification.'
          : 'Transaction submitted, but session storage was unavailable. Copy the hash now; do not send again.',
      })
    } catch (error) {
      const normalized = normalizeWalletError(error)
      if (nativeRequestStarted && requestContext && normalized.kind !== 'cancelled') {
        const unknownSubmission = createUnknownSubmission(requestContext)
        persistPhaseZeroPaymentRecord(unknownSubmission)
        setPaymentRecord(unknownSubmission)
        setPaymentRecordRestored(false)
        setPaymentState({
          status: 'warning',
          detail: 'Submission outcome unknown. Check wallet history / chain before sending again.',
        })
        return
      }
      setPaymentState(errorState(normalized))
    }
  }

  async function verifyTransaction() {
    if (!sentTransaction || rpcRequestInFlight) return
    setRpcRequestInFlight(true)
    try {
      const result = await verifyDiagnosticTransaction(sentTransaction)
      setRpcDetails(result.body)
      setRpcVerification(classifyRpcVerification(result, new Date().toISOString()))
    } catch {
      setRpcDetails(null)
      setRpcVerification(rpcFailureState(new Date().toISOString()))
    } finally {
      setRpcRequestInFlight(false)
    }
  }

  function clearLocalDiagnosticRecord() {
    if (!paymentRecord) return
    if (
      requiresClearConfirmation(paymentRecord, rpcVerification.outcome) &&
      !globalThis.confirm(
        'This transaction is not verified. Clear the local record only after checking wallet history and the chain. Continue?',
      )
    ) {
      return
    }
    if (!clearPhaseZeroPaymentRecord()) {
      setPaymentState({
        status: 'warning',
        detail: 'The local diagnostic record could not be cleared. No new payment was enabled.',
      })
      return
    }
    setPaymentToken(generateProtocolToken())
    setPaymentRecord(null)
    setPaymentRecordRestored(false)
    setRecipient('')
    setValueLuna(String(DEFAULT_DIAGNOSTIC_VALUE_LUNA))
    setAcknowledged(false)
    setPaymentState(initialStatus)
    setRpcVerification(initialRpcVerificationState)
    setRpcDetails(null)
    setEvidenceSnapshot('')
  }

  function captureEvidence() {
    setEvidenceSnapshot(JSON.stringify(buildPhaseZeroEvidence({
      capturedAtUtc: new Date().toISOString(),
      device: {
        nimiqPayVersion: nimiqPayVersion.trim(),
        osVersion: osVersion.trim(),
        platform: devicePlatform.trim(),
        userAgent: navigator.userAgent,
      },
      expectedAccount: canonicalAccount,
      listedAccounts: accounts,
      network,
      networkCheckedAtUtc,
      providerAvailable: provider !== null,
      rpcResult: rpcDetails,
      rpcVerification,
      signature,
      signatureMessage: signMessage,
      signatureVerification,
      transaction: sentTransaction,
    }), null, 2))
  }

  return (
    <section className="diagnostics" aria-labelledby="diagnostics-title">
      <div className="section-heading">
        <p className="eyebrow">Technical gate</p>
        <h2 id="diagnostics-title">Nimiq primitive diagnostics</h2>
        <p>Run in order. A failed or cancelled step never marks a later step successful.</p>
      </div>

      <ol className="step-list">
        <li className="diagnostic-card">
          <div className="card-heading">
            <div><span className="step-number">01</span><h3>Provider ready</h3></div>
            <StatusBadge state={providerState.status} />
          </div>
          <p>{providerState.detail}</p>
          <button type="button" onClick={() => void initialize()} disabled={providerState.status === 'pending'}>
            {provider ? 'Retry provider check' : 'Initialize Nimiq provider'}
          </button>
        </li>

        <li className="diagnostic-card">
          <div className="card-heading">
            <div><span className="step-number">02</span><h3>Wallet accounts</h3></div>
            <StatusBadge state={accountState.status} />
          </div>
          <p>{accountState.detail}</p>
          <button type="button" onClick={() => void connectAccounts()} disabled={!provider || accountState.status === 'pending'}>
            Request account permission
          </button>
          {accounts.length > 0 && (
            <label>
              Expected signer (diagnostic only)
              <select value={selectedAccount} onChange={(event) => changeAccount(event.target.value)}>
                {accounts.map((account) => <option key={account} value={account}>{account}</option>)}
              </select>
              <span className="hint">
                Nimiq Pay’s sign() API does not accept an account parameter. The actual signer is
                derived from the returned public key.
              </span>
            </label>
          )}
        </li>

        <li className="diagnostic-card">
          <div className="card-heading">
            <div><span className="step-number">03</span><h3>Consensus and head</h3></div>
            <StatusBadge state={networkState.status} />
          </div>
          <p>{networkState.detail}</p>
          {network && (
            <div className="evidence-grid">
              <Evidence label="Provider reachable" value="true" />
              <Evidence label="Head available" value={'block ' + network.blockNumber.toString()} />
              <Evidence label="Consensus established" value={String(network.consensus)} />
              <Evidence label="Last checked" value={networkCheckedAtUtc ?? 'unavailable'} />
              <Evidence
                label="Payment gate"
                value={network.consensus ? 'unlocked; click rechecks' : 'locked; retry required'}
              />
            </div>
          )}
          <button type="button" onClick={() => void readNetwork()} disabled={!provider || networkState.status === 'pending'}>
            {network ? 'Retry network state' : 'Read network state'}
          </button>
        </li>

        <li className="diagnostic-card">
          <div className="card-heading">
            <div><span className="step-number">04</span><h3>Sign and bind address</h3></div>
            <StatusBadge state={signatureState.status} />
          </div>
          <p>{signatureState.detail}</p>
          <details className="evidence-details">
            <summary>Exact diagnostic message</summary>
            <pre>{signMessage}</pre>
          </details>
          <button type="button" onClick={() => void signAndVerify()} disabled={!provider || !selectedAccount || signatureState.status === 'pending'}>
            Sign exact message
          </button>
          {signature && signatureVerification && (
            <div className="evidence-grid">
              <Evidence label="Public key" value={short(signature.publicKey)} />
              <Evidence label="Signature" value={short(signature.signature)} />
              <Evidence label="Actual signer" value={signatureVerification.actualSignerAddress ?? 'unavailable'} />
              <Evidence label="Signer listed by wallet" value={String(signatureVerification.signerIsListedAccount)} />
              <Evidence label="Expected account" value={canonicalAccount} />
              <Evidence label="Expected matches signer" value={String(signatureVerification.expectedMatchesSigner)} />
              <Evidence label="Nimiq signing SHA-256" value={short(signatureVerification.signedMessageDigest ?? 'unavailable')} />
              <Evidence label="NR1 payload BLAKE2b-256" value={short(signatureVerification.payloadHash ?? 'unavailable')} />
              <Evidence label="Signature valid" value={String(signatureVerification.signatureValid)} />
              <Evidence label="Public-key address derived" value={String(signatureVerification.addressBindingValid)} />
            </div>
          )}
        </li>

        <li className="diagnostic-card diagnostic-card--caution">
          <div className="card-heading">
            <div><span className="step-number">05</span><h3>Low-value payment with data</h3></div>
            <StatusBadge state={paymentState.status} />
          </div>
          <p>{paymentState.detail}</p>
          <div className="warning" role="note">
            This opens a real, irreversible NIM payment request. Use Nimiq Pay testnet and a test recipient you control. NimReturn cannot recover funds.
          </div>
          {paymentRecordRestored && paymentRecord?.status === 'submitted' && (
            <div className="warning" role="alert">
              Previous submitted diagnostic transaction restored. Do not send another transaction.
              Resume independent verification in Step 6.
            </div>
          )}
          {paymentRecord?.status === 'submission-outcome-unknown' && (
            <div className="warning" role="alert">
              Submission outcome unknown. Check wallet history / chain before sending again. NimReturn
              will not retry this payment automatically.
            </div>
          )}
          <div className="form-grid">
            <label>
              Test recipient
              <input value={recipient} onChange={(event) => setRecipient(event.target.value)} placeholder="NQ…" autoComplete="off" disabled={isDiagnosticPaymentLocked(paymentRecord)} />
            </label>
            <label>
              Amount in Luna
              <input value={valueLuna} onChange={(event) => setValueLuna(event.target.value)} inputMode="numeric" pattern="[0-9]*" disabled={isDiagnosticPaymentLocked(paymentRecord)} />
              <span className="hint">Default: 1000 Luna = 0.01 NIM. Verification remains integer Luna.</span>
            </label>
          </div>
          <Evidence label={`Transaction data · ${transactionTagByteLength(transactionData)} bytes`} value={transactionData} />
          <label className="checkbox-row">
            <input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />
            <span>I confirmed the active Nimiq Pay network and control this test recipient.</span>
          </label>
          {network?.consensus !== true && (
            <p className="hint" role="status">
              Payment is locked until Step 3 returns consensus=true. A fresh check also runs
              immediately before the native request.
            </p>
          )}
          <button type="button" className="button-caution" onClick={() => void sendPayment()} disabled={!provider || accounts.length === 0 || !recipient || !acknowledged || network?.consensus !== true || paymentState.status === 'pending' || isDiagnosticPaymentLocked(paymentRecord)}>
            Review irreversible test payment
          </button>
          {sentTransaction && (
            <div className="evidence-grid">
              <Evidence label="Wallet-returned hash · not yet verified" value={sentTransaction.hash} />
              <Evidence label="Expected recipient" value={sentTransaction.recipient} />
              <Evidence label="Expected amount" value={`${sentTransaction.valueLuna} Luna`} />
              <Evidence label="Sender" value="Determined by independent RPC lookup" />
            </div>
          )}
        </li>

        <li className="diagnostic-card">
          <div className="card-heading">
            <div><span className="step-number">06</span><h3>Independent transaction lookup</h3></div>
            <StatusBadge
              state={rpcRequestInFlight ? 'pending' : rpcStepStatus(rpcVerification.outcome)}
              label={rpcRequestInFlight ? 'Request in flight' : rpcOutcomeLabel(rpcVerification.outcome)}
            />
          </div>
          <p>
            {rpcRequestInFlight
              ? 'Asking the API to query its configured Nimiq node…'
              : rpcVerification.detail}
          </p>
          <p className="secondary-copy">
            The API—not this screen—queries its configured Nimiq node and compares network, hash,
            recipient, integer Luna, data, execution result, inclusion, and macro-block finality.
            The sender is taken from chain evidence and checked against the wallet’s submitted
            account list.
          </p>
          {rpcVerification.lastCheckedAtUtc && (
            <p className="hint">Last checked: {rpcVerification.lastCheckedAtUtc}</p>
          )}
          <button type="button" onClick={() => void verifyTransaction()} disabled={isRpcRetryDisabled(Boolean(sentTransaction), rpcRequestInFlight)}>
            {rpcRetryLabel(rpcVerification.outcome, rpcRequestInFlight)}
          </button>
          {rpcObserved && (
            <div className="evidence-grid">
              <Evidence label="Observed sender" value={rpcObserved.observedSender ?? 'unavailable'} />
              <Evidence label="Sender listed by wallet" value={String(rpcObserved.senderIsListedWalletAccount)} />
              <Evidence label="Observed recipient" value={rpcObserved.observedRecipient ?? 'unavailable'} />
              <Evidence label="Observed amount" value={rpcObserved.observedValueLuna === null ? 'unavailable' : `${rpcObserved.observedValueLuna} Luna`} />
              <Evidence label="Observed data" value={rpcObserved.observedData ?? 'unavailable'} />
              <Evidence label="Execution result" value={String(rpcObserved.executionResult)} />
              <Evidence label="Inclusion block" value={String(rpcObserved.inclusionBlock)} />
              <Evidence label="Finalizing macro block" value={String(rpcObserved.finalizingMacroBlock)} />
              <Evidence label="Head block" value={String(rpcObserved.headBlock)} />
              <Evidence label="Finality reached" value={String(rpcObserved.finalityReached)} />
            </div>
          )}
          {rpcDetails !== null && (
            <details className="evidence-details">
              <summary>Normalized API result</summary>
              <pre>{JSON.stringify(rpcDetails, null, 2)}</pre>
            </details>
          )}
          {sentTransaction && (
            <button type="button" className="button-secondary" onClick={clearLocalDiagnosticRecord}>
              Clear local diagnostic record
            </button>
          )}
          {paymentRecord?.status === 'submission-outcome-unknown' && (
            <button type="button" className="button-secondary" onClick={clearLocalDiagnosticRecord}>
              Clear local diagnostic record
            </button>
          )}
        </li>

        <li className="diagnostic-card">
          <div className="card-heading">
            <div><span className="step-number">07</span><h3>Capture device evidence</h3></div>
            <StatusBadge state={evidenceSnapshot ? 'ready' : 'idle'} />
          </div>
          <p>
            Build a local JSON record containing the exact signed UTF-8 bytes, public proof,
            address-binding result, transaction request, and independent RPC result. It contains
            no private key or seed phrase.
          </p>
          <div className="form-grid">
            <label>
              Device platform
              <input value={devicePlatform} onChange={(event) => setDevicePlatform(event.target.value)} placeholder="Android or iOS" autoComplete="off" />
            </label>
            <label>
              OS version
              <input value={osVersion} onChange={(event) => setOsVersion(event.target.value)} placeholder="Example: Android 16" autoComplete="off" />
            </label>
            <label>
              Nimiq Pay version
              <input value={nimiqPayVersion} onChange={(event) => setNimiqPayVersion(event.target.value)} placeholder="From Nimiq Pay settings" autoComplete="off" />
            </label>
          </div>
          <button type="button" onClick={captureEvidence}>
            Capture current evidence
          </button>
          {evidenceSnapshot && (
            <label>
              Evidence JSON · copy this record for the Phase 0 review
              <textarea className="evidence-export" readOnly value={evidenceSnapshot} rows={16} />
            </label>
          )}
        </li>
      </ol>

      <aside className="exit-criteria">
        <p className="eyebrow">Phase 0 exit</p>
        <h2>Local green is not device proof.</h2>
        <p>
          Record the current Nimiq Pay/OS versions and preserve the exact message, proof, address, network, transaction hash, and server result. Only then may the NR1 signing transport be frozen and Phase 1 begin.
        </p>
      </aside>
    </section>
  )
}

function StatusBadge({ state, label }: { label?: string | undefined; state: StepStatus }) {
  return <span className={`status-badge status-badge--${state}`}>{label ?? resultStatus(state)}</span>
}

function Evidence({ label, value }: { label: string; value: string }) {
  return (
    <div className="evidence">
      <span>{label}</span>
      <code>{value}</code>
    </div>
  )
}
