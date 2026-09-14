import type { NimiqProvider } from '@nimiq/mini-app-sdk'
import { useEffect, useState } from 'react'

import {
  createMerchant,
  getPublicProduct,
  MerchantApiError,
  publishPolicy,
  requestPolicyChallenge,
  type PolicyChallenge,
  type PolicyTermsInput,
  type PublicVerifiedProduct,
} from '../../lib/api/merchant.js'
import {
  normalizeNimiqAddress,
  verifyNimiqMessageSignature,
} from '../../lib/crypto/nimiq-signature.js'
import {
  initializeNimiqProvider,
  normalizeWalletError,
  requestAccounts,
  requestSignature,
} from '../../lib/nimiq/provider.js'
import {
  loadMerchantWorkspace,
  saveMerchantWorkspace,
  savePendingChallenge,
  type MerchantWorkspace,
} from './merchant-workspace.js'

type Notice = { kind: 'error' | 'info' | 'success'; message: string }
type BusyAction = 'challenge' | 'draft' | 'public-read' | 'sign' | null

interface TermsForm {
  priceLuna: string
  returnDays: string
  settlementAddress: string
  warrantyDays: string
  warrantyTransferAllowed: boolean
}

interface LocalProof {
  listedAccountCount: number
  payloadHash: string
  publicKey: string
  signature: string
  signedMessageDigest: string
  signerAddress: string
}

const EMPTY_TERMS: TermsForm = {
  priceLuna: '1500000',
  returnDays: '14',
  settlementAddress: '',
  warrantyDays: '365',
  warrantyTransferAllowed: false,
}

function requestedPublicProductId(): string | null {
  return new URL(globalThis.location.href).searchParams.get('product')
}

function parseUnsignedInteger(value: string, label: string, allowZero: boolean): number {
  if (!/^(0|[1-9][0-9]*)$/u.test(value)) {
    throw new Error(`${label} must be a whole number.`)
  }
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || (!allowZero && parsed === 0)) {
    throw new Error(`${label} is outside the supported range.`)
  }
  return parsed
}

function dayCountToSeconds(value: string, label: string): number {
  const days = parseUnsignedInteger(value, label, true)
  const seconds = days * 86_400
  if (!Number.isSafeInteger(seconds) || seconds > 157_680_000) {
    throw new Error(`${label} cannot exceed 1,825 days.`)
  }
  return seconds
}

function termsFromPayload(payload: PolicyChallenge['payload']): TermsForm {
  return {
    priceLuna: String(payload.priceLuna),
    returnDays: String(payload.returnWindowSeconds / 86_400),
    settlementAddress: payload.settlementAddress,
    warrantyDays: String(payload.warrantyWindowSeconds / 86_400),
    warrantyTransferAllowed: payload.warrantyTransferAllowed,
  }
}

function termsFromChallenge(challenge: PolicyChallenge): TermsForm {
  return termsFromPayload(challenge.payload)
}

function friendlyError(error: unknown): string {
  if (error instanceof MerchantApiError) return error.message
  const walletError = normalizeWalletError(error)
  return walletError.message
}

function formatNim(valueLuna: number): string {
  return (valueLuna / 100_000).toLocaleString(undefined, {
    maximumFractionDigits: 5,
    minimumFractionDigits: 0,
  })
}

function formatDuration(seconds: number): string {
  if (seconds === 0) return 'Not offered'
  if (seconds % 86_400 === 0) {
    const days = seconds / 86_400
    return `${days.toLocaleString()} day${days === 1 ? '' : 's'}`
  }
  return `${seconds.toLocaleString()} seconds`
}

function formatTimestamp(value: number | string): string {
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    month: 'short',
    timeZoneName: 'short',
    year: 'numeric',
  }).format(new Date(value))
}

function stepState(complete: boolean, active: boolean): string {
  if (complete) return 'complete'
  if (active) return 'active'
  return 'upcoming'
}

export function MerchantPolicyStudio() {
  const [requestedProductId] = useState(requestedPublicProductId)
  const [initialWorkspace] = useState(() => {
    const stored = loadMerchantWorkspace()
    return requestedProductId && stored?.productPublicId !== requestedProductId ? null : stored
  })
  const [productToRead] = useState(
    () => requestedProductId ?? initialWorkspace?.productPublicId ?? null,
  )
  const [workspace, setWorkspace] = useState<MerchantWorkspace | null>(initialWorkspace)
  const [challenge, setChallenge] = useState<PolicyChallenge | null>(
    initialWorkspace?.pendingChallenge ?? null,
  )
  const [publicProduct, setPublicProduct] = useState<PublicVerifiedProduct | null>(null)
  const [editingTerms, setEditingTerms] = useState(
    Boolean(initialWorkspace && !initialWorkspace.pendingChallenge),
  )
  const [draftForm, setDraftForm] = useState({
    description: '',
    displayName: '',
    productName: '',
    settlementAddress: '',
  })
  const [termsForm, setTermsForm] = useState<TermsForm>(
    initialWorkspace?.pendingChallenge
      ? termsFromChallenge(initialWorkspace.pendingChallenge)
      : EMPTY_TERMS,
  )
  const [busy, setBusy] = useState<BusyAction>(productToRead ? 'public-read' : null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [provider, setProvider] = useState<NimiqProvider | null>(null)
  const [localProof, setLocalProof] = useState<LocalProof | null>(null)
  const [publicationSucceeded, setPublicationSucceeded] = useState(false)

  async function loadPublicPolicy(productPublicId: string): Promise<boolean> {
    setBusy('public-read')
    try {
      const product = await getPublicProduct(productPublicId)
      setPublicProduct(product)
      if (!challenge) setEditingTerms(false)
      setNotice(null)
      return true
    } catch (error) {
      if (!(error instanceof MerchantApiError && error.status === 404)) {
        setNotice({ kind: 'error', message: friendlyError(error) })
      }
      return false
    } finally {
      setBusy(null)
    }
  }

  useEffect(() => {
    if (!productToRead) return
    let active = true
    void getPublicProduct(productToRead)
      .then((product) => {
        if (!active) return
        setPublicProduct(product)
        if (!initialWorkspace?.pendingChallenge) setEditingTerms(false)
        setNotice(null)
      })
      .catch((error: unknown) => {
        if (!active) return
        if (!(error instanceof MerchantApiError && error.status === 404)) {
          setNotice({ kind: 'error', message: friendlyError(error) })
        }
      })
      .finally(() => {
        if (active) setBusy(null)
      })
    return () => {
      active = false
    }
  }, [initialWorkspace, productToRead])

  async function submitDraft(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy('draft')
    setNotice(null)
    try {
      const settlementAddress = normalizeNimiqAddress(draftForm.settlementAddress)
      const created = await createMerchant({
        defaultSettlementAddress: settlementAddress,
        description: draftForm.description,
        displayName: draftForm.displayName,
        productName: draftForm.productName,
      })
      const nextWorkspace: MerchantWorkspace = {
        displayName: created.merchant.displayName,
        merchantPublicId: created.merchant.publicId,
        productName: created.product.name,
        productPublicId: created.product.publicId,
      }
      saveMerchantWorkspace(nextWorkspace)
      setWorkspace(nextWorkspace)
      setTermsForm({ ...EMPTY_TERMS, settlementAddress })
      setEditingTerms(true)
      setNotice({
        kind: 'success',
        message: 'Product draft created. Its bootstrap authorization stays in a protected browser cookie.',
      })
    } catch (error) {
      setNotice({ kind: 'error', message: friendlyError(error) })
    } finally {
      setBusy(null)
    }
  }

  async function submitTerms(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!workspace) return
    setBusy('challenge')
    setNotice(null)
    try {
      const terms: PolicyTermsInput = {
        priceLuna: parseUnsignedInteger(termsForm.priceLuna, 'Price in Luna', false),
        returnWindowSeconds: dayCountToSeconds(termsForm.returnDays, 'Return window'),
        settlementAddress: normalizeNimiqAddress(termsForm.settlementAddress),
        warrantyTransferAllowed: termsForm.warrantyTransferAllowed,
        warrantyWindowSeconds: dayCountToSeconds(termsForm.warrantyDays, 'Warranty window'),
      }
      const created = await requestPolicyChallenge({
        merchantPublicId: workspace.merchantPublicId,
        productPublicId: workspace.productPublicId,
        terms,
      })
      const nextWorkspace = savePendingChallenge(workspace, created)
      saveMerchantWorkspace(nextWorkspace)
      setWorkspace(nextWorkspace)
      setChallenge(created)
      setEditingTerms(false)
      setLocalProof(null)
      setPublicationSucceeded(false)
      setNotice({
        kind: 'info',
        message: `Canonical NR1 policy v${created.payload.version} is ready. Review the exact terms before opening Nimiq Pay.`,
      })
    } catch (error) {
      setNotice({ kind: 'error', message: friendlyError(error) })
    } finally {
      setBusy(null)
    }
  }

  async function signAndPublish() {
    if (!workspace || !challenge) return
    setBusy('sign')
    setNotice({ kind: 'info', message: 'Waiting for Nimiq Pay account permission…' })
    try {
      const activeProvider = provider ?? await initializeNimiqProvider()
      setProvider(activeProvider)
      const accounts = await requestAccounts(activeProvider)
      setNotice({ kind: 'info', message: 'Review and sign the exact canonical NR1 policy in Nimiq Pay.' })
      const walletProof = await requestSignature(activeProvider, challenge.canonicalMessage)
      const publicKey = walletProof.publicKey.toLowerCase()
      const signature = walletProof.signature.toLowerCase()
      const verification = verifyNimiqMessageSignature({
        message: challenge.canonicalMessage,
        publicKey,
        signature,
      })
      if (!verification.signatureValid || !verification.actualSignerAddress) {
        throw new Error(verification.error ?? 'The wallet signature did not verify locally.')
      }
      const signerAddress = normalizeNimiqAddress(verification.actualSignerAddress)
      const normalizedAccounts = accounts.map((account) => normalizeNimiqAddress(account))
      if (!normalizedAccounts.includes(signerAddress)) {
        throw new Error('The cryptographic signer was not included in the wallet-disclosed account list.')
      }
      if (verification.payloadHash !== challenge.payloadHash || !verification.signedMessageDigest) {
        throw new Error('The signed bytes did not reproduce the server-issued policy hash.')
      }
      const proof: LocalProof = {
        listedAccountCount: normalizedAccounts.length,
        payloadHash: verification.payloadHash,
        publicKey,
        signature,
        signedMessageDigest: verification.signedMessageDigest,
        signerAddress,
      }
      setLocalProof(proof)
      setNotice({ kind: 'info', message: 'Local bytes and signer binding verified. Publishing for independent server verification…' })
      await publishPolicy({
        challengeNonce: challenge.nonce,
        merchantPublicId: workspace.merchantPublicId,
        productPublicId: workspace.productPublicId,
        proof: {
          canonicalMessage: challenge.canonicalMessage,
          payloadHash: challenge.payloadHash,
          publicKey,
          signature,
        },
      })
      const nextWorkspace = savePendingChallenge(workspace, undefined)
      saveMerchantWorkspace(nextWorkspace)
      setWorkspace(nextWorkspace)
      setChallenge(null)
      setPublicationSucceeded(true)
      const url = new URL(globalThis.location.href)
      url.search = ''
      url.searchParams.set('product', workspace.productPublicId)
      globalThis.history.replaceState(null, '', url)
      const publicReadSucceeded = await loadPublicPolicy(workspace.productPublicId)
      if (publicReadSucceeded) {
        setNotice({
          kind: 'success',
          message: 'Policy verified and published. The public result below was read back through the fail-closed verification endpoint.',
        })
      }
    } catch (error) {
      setNotice({ kind: 'error', message: friendlyError(error) })
    } finally {
      setBusy(null)
    }
  }

  function startNewVersion() {
    if (!workspace || !publicProduct) return
    const nextWorkspace = savePendingChallenge(workspace, undefined)
    saveMerchantWorkspace(nextWorkspace)
    setWorkspace(nextWorkspace)
    setChallenge(null)
    setTermsForm(termsFromPayload(publicProduct.policy.payload))
    setLocalProof(null)
    setPublicationSucceeded(false)
    setEditingTerms(true)
    setNotice({
      kind: 'info',
      message: `Edit the terms below. Publication will create v${publicProduct.policy.payload.version + 1}; earlier verified versions stay preserved.`,
    })
  }

  const draftComplete = workspace !== null || publicProduct !== null
  const termsComplete = Boolean(challenge || publicProduct)
  const proofComplete = Boolean(localProof || publicProduct)
  const publishComplete = publicProduct !== null

  return (
    <>
      <section className="merchant-hero" aria-labelledby="merchant-title">
        <div>
          <p className="eyebrow">Merchant policy studio · NR1</p>
          <h1 id="merchant-title">Make the promise verifiable.</h1>
          <p className="hero-copy">
            Publish return and warranty terms that customers can verify independently. Your wallet
            signs the policy; NimReturn never receives a private key or holds funds.
          </p>
        </div>
        <aside className="protocol-card" aria-label="NR1 trust model">
          <span className="protocol-mark">NR1</span>
          <p>Canonical terms</p>
          <strong>Wallet signed</strong>
          <p>Server re-verified</p>
        </aside>
      </section>

      <ol className="journey-steps" aria-label="Policy publication progress">
        <JourneyStep number="01" label="Product" state={stepState(draftComplete, !draftComplete)} />
        <JourneyStep number="02" label="Terms" state={stepState(termsComplete, draftComplete && !termsComplete)} />
        <JourneyStep number="03" label="Wallet proof" state={stepState(proofComplete, Boolean(challenge && !proofComplete))} />
        <JourneyStep number="04" label="Published" state={stepState(publishComplete, publicationSucceeded && !publishComplete)} />
      </ol>

      {notice && (
        <div className={`notice notice--${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>
          {notice.message}
        </div>
      )}

      {!workspace && !productToRead && (
        <section className="studio-panel" aria-labelledby="draft-title">
          <div className="panel-intro">
            <span className="panel-kicker">Step 1</span>
            <div>
              <h2 id="draft-title">Create your product</h2>
              <p>Start with the public merchant identity and the address that receives direct NIM payments.</p>
            </div>
          </div>
          <form onSubmit={(event) => void submitDraft(event)}>
            <div className="form-grid form-grid--merchant">
              <label>
                Merchant display name
                <input required maxLength={80} autoComplete="organization" value={draftForm.displayName} onChange={(event) => setDraftForm({ ...draftForm, displayName: event.target.value })} placeholder="North Star Goods" />
              </label>
              <label>
                Product name
                <input required maxLength={100} value={draftForm.productName} onChange={(event) => setDraftForm({ ...draftForm, productName: event.target.value })} placeholder="All-weather trail cup" />
              </label>
            </div>
            <label>
              Settlement address
              <input required autoCapitalize="characters" autoComplete="off" spellCheck={false} value={draftForm.settlementAddress} onChange={(event) => setDraftForm({ ...draftForm, settlementAddress: event.target.value })} placeholder="NQ…" />
              <span className="hint">Signed into the policy. It can differ from the wallet account that signs the policy.</span>
            </label>
            <label>
              Short product description <span className="optional">Optional</span>
              <textarea rows={3} maxLength={500} value={draftForm.description} onChange={(event) => setDraftForm({ ...draftForm, description: event.target.value })} placeholder="What the customer is buying." />
            </label>
            <button type="submit" disabled={busy !== null}>
              {busy === 'draft' ? 'Creating protected draft…' : 'Create product draft'}
            </button>
          </form>
        </section>
      )}

      {workspace && editingTerms && !challenge && (
        <section className="studio-panel" aria-labelledby="terms-title">
          <div className="panel-intro">
            <span className="panel-kicker">Step 2</span>
            <div>
              <h2 id="terms-title">Set the promise</h2>
              <p>{workspace.productName} · {workspace.displayName}</p>
            </div>
          </div>
          <form onSubmit={(event) => void submitTerms(event)}>
            <div className="terms-grid">
              <label>
                Price in Luna
                <input required inputMode="numeric" pattern="[0-9]*" value={termsForm.priceLuna} onChange={(event) => setTermsForm({ ...termsForm, priceLuna: event.target.value })} />
                <span className="hint">Whole Luna only. 100,000 Luna = 1 NIM.</span>
              </label>
              <label>
                Return window · days
                <input required inputMode="numeric" pattern="[0-9]*" value={termsForm.returnDays} onChange={(event) => setTermsForm({ ...termsForm, returnDays: event.target.value })} />
              </label>
              <label>
                Warranty window · days
                <input required inputMode="numeric" pattern="[0-9]*" value={termsForm.warrantyDays} onChange={(event) => setTermsForm({ ...termsForm, warrantyDays: event.target.value })} />
              </label>
              <label>
                Settlement address
                <input required autoCapitalize="characters" autoComplete="off" spellCheck={false} value={termsForm.settlementAddress} onChange={(event) => setTermsForm({ ...termsForm, settlementAddress: event.target.value })} />
              </label>
            </div>
            <label className="checkbox-row policy-checkbox">
              <input type="checkbox" checked={termsForm.warrantyTransferAllowed} onChange={(event) => setTermsForm({ ...termsForm, warrantyTransferAllowed: event.target.checked })} />
              <span><strong>Warranty may transfer to a later owner</strong><small>This promise is recorded in the signed policy.</small></span>
            </label>
            <div className="policy-explainer">
              <strong>This next step creates immutable signing bytes.</strong>
              <span>Review carefully. Editing later creates a new version; it never rewrites an old one.</span>
            </div>
            <button type="submit" disabled={busy !== null}>
              {busy === 'challenge' ? 'Building canonical policy…' : 'Review canonical policy'}
            </button>
          </form>
        </section>
      )}

      {workspace && challenge && (
        <section className="studio-panel studio-panel--sign" aria-labelledby="sign-title">
          <div className="panel-intro">
            <span className="panel-kicker">Step 3</span>
            <div>
              <h2 id="sign-title">Sign policy v{challenge.payload.version}</h2>
              <p>One native approval signs these exact server-issued bytes.</p>
            </div>
          </div>
          <PolicySummary payload={challenge.payload} />
          <div className="hash-callout">
            <span>Canonical payload hash · BLAKE2b-256</span>
            <code>{challenge.payloadHash}</code>
          </div>
          <details className="evidence-details canonical-preview">
            <summary>Inspect exact canonical message</summary>
            <pre>{challenge.canonicalMessage}</pre>
          </details>
          <p className="expiry-line">Challenge expires {formatTimestamp(challenge.expiresAt)}.</p>
          <button type="button" onClick={() => void signAndPublish()} disabled={busy !== null}>
            {busy === 'sign' ? 'Waiting for verification…' : 'Sign with Nimiq Pay & publish'}
          </button>
          <p className="button-footnote">NimReturn receives only the public key, signature, and exact public policy—not your private key.</p>
          {localProof && (
            <div className="local-proof" role="status">
              <strong>Local cryptographic check passed</strong>
              <span>Exact framed bytes verified; public key derived {localProof.signerAddress}; signer appeared in {localProof.listedAccountCount} wallet-disclosed account(s).</span>
            </div>
          )}
        </section>
      )}

      {workspace && publicationSucceeded && !publicProduct && (
        <section className="studio-panel">
          <h2>Published; public proof is retrying safely</h2>
          <p>The signature submission succeeded. No second wallet approval is needed.</p>
          <button type="button" disabled={busy !== null} onClick={() => void loadPublicPolicy(workspace.productPublicId)}>
            {busy === 'public-read' ? 'Reading verified policy…' : 'Retry verified public read'}
          </button>
        </section>
      )}

      {publicProduct && (
        <VerifiedPolicyPanel
          product={publicProduct}
          canEdit={workspace?.productPublicId === publicProduct.product.publicId && !challenge}
          onNewVersion={startNewVersion}
        />
      )}
    </>
  )
}

function JourneyStep({ number, label, state }: { label: string; number: string; state: string }) {
  return (
    <li className={`journey-step journey-step--${state}`}>
      <span>{number}</span>
      <strong>{label}</strong>
      <small>{state === 'complete' ? 'Complete' : state === 'active' ? 'Current' : 'Next'}</small>
    </li>
  )
}

function PolicySummary({ payload }: { payload: PolicyChallenge['payload'] }) {
  return (
    <dl className="terms-summary">
      <div><dt>Price</dt><dd>{formatNim(payload.priceLuna)} NIM <small>{payload.priceLuna.toLocaleString()} Luna</small></dd></div>
      <div><dt>Returns</dt><dd>{formatDuration(payload.returnWindowSeconds)}</dd></div>
      <div><dt>Warranty</dt><dd>{formatDuration(payload.warrantyWindowSeconds)}</dd></div>
      <div><dt>Transferable</dt><dd>{payload.warrantyTransferAllowed ? 'Yes' : 'No'}</dd></div>
    </dl>
  )
}

function VerifiedPolicyPanel({
  canEdit,
  onNewVersion,
  product,
}: {
  canEdit: boolean
  onNewVersion: () => void
  product: PublicVerifiedProduct
}) {
  const { payload, proof } = product.policy

  async function copyPublicLink() {
    try {
      await navigator.clipboard.writeText(globalThis.location.href)
    } catch {
      // The visible URL remains available when clipboard permission is unavailable.
    }
  }

  return (
    <section className="verified-policy" aria-labelledby="verified-title">
      <div className="verified-hero">
        <div className="verified-seal" aria-hidden="true">✓</div>
        <div>
          <p className="eyebrow">Public cryptographic result</p>
          <h2 id="verified-title">Policy verified</h2>
          <p>{product.merchant.displayName} · {payload.productName}</p>
        </div>
        <div className="version-lockup"><span>NR1</span><strong>v{payload.version}</strong><small>Active version</small></div>
      </div>

      <div className="verification-statement">
        <strong>Signature, bytes, and address binding passed.</strong>
        <span>The server rebuilt the canonical payload, verified the Nimiq signature, derived the signer from its public key, and matched every stored field before returning this page.</span>
      </div>

      <PolicySummary payload={payload} />

      <div className="evidence-section">
        <div className="evidence-heading">
          <div><span>Verification receipt</span><h3>Public proof</h3></div>
          <button className="text-button" type="button" onClick={() => void copyPublicLink()}>Copy public link</button>
        </div>
        <dl className="proof-grid">
          <ProofItem label="Status" value="Verified" accent />
          <ProofItem label="Protocol" value="NR1" />
          <ProofItem label="Policy version" value={`v${payload.version}`} />
          <ProofItem label="Policy ID" value={product.policy.publicId} mono />
          <ProofItem label="Cryptographic signer" value={product.policy.signerAddress} mono />
          <ProofItem label="Settlement address" value={payload.settlementAddress} mono />
          <ProofItem label="Policy timestamp" value={formatTimestamp(payload.createdAt)} />
          <ProofItem label="Server verified" value={formatTimestamp(product.policy.verifiedAt)} />
          <ProofItem label="Payload hash · BLAKE2b-256" value={proof.payloadHash} mono wide />
          <ProofItem label="Public key" value={proof.publicKey} mono wide />
        </dl>
        <details className="evidence-details canonical-preview">
          <summary>Exact signed canonical message</summary>
          <pre>{proof.canonicalMessage}</pre>
        </details>
      </div>

      <div className="version-history">
        <div className="evidence-heading">
          <div><span>Append-only record</span><h3>Policy versions</h3></div>
          <strong>{product.policyVersions.length} verified</strong>
        </div>
        <p className="immutability-copy">
          Changing terms creates another signed version. Earlier verified versions cannot be
          overwritten or deleted by the runtime role, and every proof is re-verified before this
          history is displayed.
        </p>
        <ol>
          {[...product.policyVersions].reverse().map((version) => (
            <li key={version.publicId}>
              <div className="version-number">v{version.payload.version}</div>
              <div>
                <strong>{version.active ? 'Active verified policy' : 'Preserved verified policy'}</strong>
                <span>{formatNim(version.payload.priceLuna)} NIM · {formatDuration(version.payload.returnWindowSeconds)} returns</span>
                <code>{version.proof.payloadHash}</code>
              </div>
              <time>{formatTimestamp(version.verifiedAt)}</time>
            </li>
          ))}
        </ol>
      </div>

      {canEdit && (
        <button className="button-secondary version-action" type="button" onClick={onNewVersion}>
          Change terms · create v{payload.version + 1}
        </button>
      )}
    </section>
  )
}

function ProofItem({
  accent = false,
  label,
  mono = false,
  value,
  wide = false,
}: {
  accent?: boolean
  label: string
  mono?: boolean
  value: string
  wide?: boolean
}) {
  return (
    <div className={`${wide ? 'proof-item proof-item--wide' : 'proof-item'}${accent ? ' proof-item--accent' : ''}`}>
      <dt>{label}</dt>
      <dd className={mono ? 'mono' : undefined}>{value}</dd>
    </div>
  )
}
