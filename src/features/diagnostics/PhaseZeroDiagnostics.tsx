import type { NimiqProvider, SignatureResult } from '@nimiq/mini-app-sdk'
import { useMemo, useState } from 'react'

import { verifyDiagnosticTransaction } from '../../lib/api/diagnostics.js'
import {
  normalizeNimiqAddress,
  verifyNimiqSignature,
  type NimiqSignatureVerification,
} from '../../lib/crypto/nimiq-signature.js'
import {
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
import { buildPhaseZeroEvidence, type PhaseZeroSentTransaction } from './evidence.js'

type StepStatus = 'cancelled' | 'failed' | 'idle' | 'pending' | 'ready' | 'sent' | 'verified'

interface StatusState {
  detail: string
  status: StepStatus
}

const initialStatus: StatusState = { status: 'idle', detail: 'Not run yet.' }

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

function resultSummary(body: unknown): string {
  if (typeof body !== 'object' || body === null) return 'The API returned an unreadable result.'
  const record = body as Record<string, unknown>
  const verification =
    typeof record.verification === 'object' && record.verification !== null
      ? (record.verification as Record<string, unknown>)
      : null
  if (verification && typeof verification.reason === 'string') return verification.reason
  if (typeof record.reason === 'string') return record.reason
  if (typeof record.message === 'string') return record.message
  return 'The API returned a result without a summary.'
}

export function PhaseZeroDiagnostics() {
  const [provider, setProvider] = useState<NimiqProvider | null>(null)
  const [providerState, setProviderState] = useState<StatusState>(initialStatus)
  const [accounts, setAccounts] = useState<string[]>([])
  const [selectedAccount, setSelectedAccount] = useState('')
  const [accountState, setAccountState] = useState<StatusState>(initialStatus)
  const [network, setNetwork] = useState<ProviderNetworkSnapshot | null>(null)
  const [networkState, setNetworkState] = useState<StatusState>(initialStatus)
  const [diagnosticNonce, setDiagnosticNonce] = useState(() => generateProtocolToken())
  const [signature, setSignature] = useState<SignatureResult | null>(null)
  const [signatureVerification, setSignatureVerification] =
    useState<NimiqSignatureVerification | null>(null)
  const [signatureState, setSignatureState] = useState<StatusState>(initialStatus)
  const [recipient, setRecipient] = useState('')
  const [valueLuna, setValueLuna] = useState('1')
  const [paymentToken, setPaymentToken] = useState(() => generateProtocolToken())
  const [acknowledged, setAcknowledged] = useState(false)
  const [paymentState, setPaymentState] = useState<StatusState>(initialStatus)
  const [sentTransaction, setSentTransaction] = useState<PhaseZeroSentTransaction | null>(null)
  const [rpcState, setRpcState] = useState<StatusState>(initialStatus)
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
  const transactionData = useMemo(() => encodePurchaseTag(paymentToken), [paymentToken])

  async function initialize() {
    setProviderState({ status: 'pending', detail: 'Waiting for Nimiq Pay to inject the provider…' })
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
    setNetworkState({ status: 'pending', detail: 'Reading wallet consensus and head height…' })
    try {
      const snapshot = await readProviderNetwork(provider)
      setNetwork(snapshot)
      setNetworkState({
        status: snapshot.consensus ? 'ready' : 'failed',
        detail: snapshot.consensus
          ? `Consensus established at block ${snapshot.blockNumber.toLocaleString()}.`
          : `No consensus at block ${snapshot.blockNumber.toLocaleString()}. Do not send yet.`,
      })
    } catch (error) {
      setNetworkState(errorState(error))
    }
  }

  async function signAndVerify() {
    if (!provider || !selectedAccount) return
    setSignatureState({ status: 'pending', detail: 'Awaiting native signature approval…' })
    try {
      const proof = await requestSignature(provider, signMessage)
      const verification = verifyNimiqSignature({
        address: selectedAccount,
        message: signMessage,
        publicKey: proof.publicKey,
        signature: proof.signature,
      })
      setSignature(proof)
      setSignatureVerification(verification)
      setSignatureState({
        status: verification.valid ? 'verified' : 'failed',
        detail: verification.valid
          ? 'Exact message signature and public-key/address binding verified locally.'
          : verification.error ?? 'The signature or selected-address binding did not verify.',
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
    if (!provider || !selectedAccount || !acknowledged) return
    setPaymentState({ status: 'pending', detail: 'Validating the irreversible test request…' })
    setSentTransaction(null)
    setRpcDetails(null)
    setRpcState(initialStatus)

    try {
      const canonicalRecipient = normalizeNimiqAddress(recipient)
      const amount = Number(valueLuna)
      if (!/^\d+$/u.test(valueLuna) || !Number.isSafeInteger(amount) || amount <= 0) {
        throw new Error('Amount must be a positive safe integer number of Luna.')
      }

      const snapshot = await readProviderNetwork(provider)
      setNetwork(snapshot)
      if (!snapshot.consensus) {
        throw new Error('Nimiq consensus is not established. No payment request was opened.')
      }

      setPaymentState({ status: 'pending', detail: 'Awaiting native payment approval…' })
      const hash = await sendTransactionWithData(provider, {
        recipient: canonicalRecipient,
        value: amount,
        data: transactionData,
        validityStartHeight: snapshot.blockNumber,
      })
      setSentTransaction({
        hash,
        sender: selectedAccount,
        recipient: canonicalRecipient,
        valueLuna: amount,
        data: transactionData,
      })
      setPaymentState({
        status: 'sent',
        detail: 'Transaction submitted. This is not payment verification.',
      })
    } catch (error) {
      setPaymentState(errorState(error))
    }
  }

  async function verifyTransaction() {
    if (!sentTransaction) return
    setRpcState({ status: 'pending', detail: 'Asking the API to query its configured Nimiq node…' })
    try {
      const result = await verifyDiagnosticTransaction(sentTransaction)
      setRpcDetails(result.body)
      const body =
        typeof result.body === 'object' && result.body !== null
          ? (result.body as Record<string, unknown>)
          : null
      const verification =
        body && typeof body.verification === 'object' && body.verification !== null
          ? (body.verification as Record<string, unknown>)
          : null
      const outcome = verification?.outcome ?? body?.outcome

      setRpcState({
        status: outcome === 'verified' ? 'verified' : outcome === 'pending' ? 'pending' : 'failed',
        detail: `${resultSummary(result.body)}${result.ok ? '' : ` (HTTP ${result.status})`}`,
      })
    } catch {
      setRpcDetails(null)
      setRpcState({
        status: 'failed',
        detail: 'The API is unreachable. The transaction remains unverified; do not send again.',
      })
    }
  }

  function prepareAnotherPayment() {
    setPaymentToken(generateProtocolToken())
    setSentTransaction(null)
    setAcknowledged(false)
    setPaymentState(initialStatus)
    setRpcState(initialStatus)
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
      network,
      rpcResult: rpcDetails,
      selectedAccount: canonicalAccount,
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
              Selected NIM account
              <select value={selectedAccount} onChange={(event) => changeAccount(event.target.value)}>
                {accounts.map((account) => <option key={account} value={account}>{account}</option>)}
              </select>
            </label>
          )}
        </li>

        <li className="diagnostic-card">
          <div className="card-heading">
            <div><span className="step-number">03</span><h3>Consensus and head</h3></div>
            <StatusBadge state={networkState.status} />
          </div>
          <p>{networkState.detail}</p>
          {network && <Evidence label="Latest provider result" value={`consensus=${String(network.consensus)}, block=${network.blockNumber}`} />}
          <button type="button" onClick={() => void readNetwork()} disabled={!provider || networkState.status === 'pending'}>
            Read network state
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
              <Evidence label="Derived address" value={signatureVerification.derivedAddress ?? 'unavailable'} />
              <Evidence label="BLAKE2b-256" value={short(signatureVerification.payloadHash ?? 'unavailable')} />
              <Evidence label="Signature valid" value={String(signatureVerification.signatureValid)} />
              <Evidence label="Address matches" value={String(signatureVerification.addressMatches)} />
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
          <div className="form-grid">
            <label>
              Test recipient
              <input value={recipient} onChange={(event) => setRecipient(event.target.value)} placeholder="NQ…" autoComplete="off" />
            </label>
            <label>
              Amount in Luna
              <input value={valueLuna} onChange={(event) => setValueLuna(event.target.value)} inputMode="numeric" pattern="[0-9]*" />
              <span className="hint">1 Luna = 0.00001 NIM</span>
            </label>
          </div>
          <Evidence label={`Transaction data · ${transactionTagByteLength(transactionData)} bytes`} value={transactionData} />
          <label className="checkbox-row">
            <input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />
            <span>I confirmed the active Nimiq Pay network and control this test recipient.</span>
          </label>
          <button type="button" className="button-caution" onClick={() => void sendPayment()} disabled={!provider || !selectedAccount || !recipient || !acknowledged || paymentState.status === 'pending' || Boolean(sentTransaction)}>
            Review irreversible test payment
          </button>
          {sentTransaction && (
            <div className="evidence-grid">
              <Evidence label="Wallet-returned hash · not yet verified" value={sentTransaction.hash} />
              <Evidence label="Expected sender" value={sentTransaction.sender} />
              <Evidence label="Expected recipient" value={sentTransaction.recipient} />
              <Evidence label="Expected amount" value={`${sentTransaction.valueLuna} Luna`} />
            </div>
          )}
        </li>

        <li className="diagnostic-card">
          <div className="card-heading">
            <div><span className="step-number">06</span><h3>Independent transaction lookup</h3></div>
            <StatusBadge state={rpcState.status} />
          </div>
          <p>{rpcState.detail}</p>
          <p className="secondary-copy">
            The API—not this screen—queries its configured Nimiq node and compares network, hash, sender, recipient, integer Luna, data, and inclusion state.
          </p>
          <button type="button" onClick={() => void verifyTransaction()} disabled={!sentTransaction || rpcState.status === 'pending'}>
            Verify through server RPC
          </button>
          {rpcDetails !== null && (
            <details className="evidence-details">
              <summary>Normalized API result</summary>
              <pre>{JSON.stringify(rpcDetails, null, 2)}</pre>
            </details>
          )}
          {sentTransaction && rpcState.status !== 'verified' && (
            <button type="button" className="button-secondary" onClick={prepareAnotherPayment}>
              Clear result and prepare another token
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

function StatusBadge({ state }: { state: StepStatus }) {
  return <span className={`status-badge status-badge--${state}`}>{resultStatus(state)}</span>
}

function Evidence({ label, value }: { label: string; value: string }) {
  return (
    <div className="evidence">
      <span>{label}</span>
      <code>{value}</code>
    </div>
  )
}
