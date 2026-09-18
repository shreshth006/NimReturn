import type { NimiqProvider } from '@nimiq/mini-app-sdk'
import { useEffect, useState } from 'react'

import { assertWalletOnExpectedNetwork, identifyWalletNetwork } from '../../lib/nimiq/network-gate.js'

import { getPublicProduct, type PublicVerifiedProduct } from '../../lib/api/merchant.js'
import {
  attachTransaction,
  createOrder,
  getOrder,
  getPassport,
  PurchaseApiError,
  type PurchaseOrder,
  type PurchasePassport,
  recheckTransaction,
  recordWalletState,
  requestClaimKey,
  submitClaimKey,
} from '../../lib/api/purchase.js'
import {
  initializeNimiqProvider,
  normalizeWalletError,
  requestSignature,
  sendTransactionWithData,
} from '../../lib/nimiq/provider.js'
import {
  clearPurchaseSession,
  loadPurchaseSession,
  savePurchaseSession,
} from './purchase-session.js'
import { BuyerClaimJourney } from '../claims/BuyerClaimJourney.js'
import { PassportLifecycle } from './PassportLifecycle.js'
import { ProofDisclosure } from '../proof/ProofDisclosure.js'
import { buildClaimProof } from '../claims/claim-proof.js'

type BusyAction = 'binding' | 'loading' | 'paying' | 'preparing' | 'verifying' | null
type Notice = { kind: 'error' | 'info' | 'success'; message: string }

function formatNim(valueLuna: number): string {
  return (valueLuna / 100_000).toLocaleString(undefined, { maximumFractionDigits: 5 })
}

function formatDuration(seconds: number): string {
  if (seconds === 0) return 'Not offered'
  if (seconds % 86_400 === 0) {
    const days = seconds / 86_400
    return `${days.toLocaleString()} day${days === 1 ? '' : 's'}`
  }
  return `${seconds.toLocaleString()} seconds`
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function short(value: string): string {
  return value.length <= 18 ? value : `${value.slice(0, 9)}…${value.slice(-7)}`
}

function errorMessage(error: unknown): string {
  if (error instanceof PurchaseApiError) return error.message
  return normalizeWalletError(error).message
}

function orderReusable(order: PurchaseOrder | null): order is PurchaseOrder {
  return order !== null && !['expired', 'payment_failed'].includes(order.paymentState)
}

function claimKeyUsable(order: PurchaseOrder): boolean {
  return order.claimKey?.status === 'verified'
    || (order.claimKey?.status === 'pending' && Date.parse(order.claimKey.expiresAt) > Date.now())
}

function progressIndex(order: PurchaseOrder | null, recoveredHash: string | null): number {
  if (!order) return 0
  if (order.paymentState === 'purchased') return 4
  if (order.transaction || recoveredHash) return 3
  if (order.paymentState === 'wallet_request_started' || order.paymentState === 'submission_outcome_unknown') return 2
  return 1
}

export function BuyerPurchaseJourney({
  passportPublicId,
  productPublicId,
}: {
  passportPublicId: string | null
  productPublicId: string | null
}) {
  const [busy, setBusy] = useState<BusyAction>('loading')
  const [notice, setNotice] = useState<Notice | null>(null)
  const [order, setOrder] = useState<PurchaseOrder | null>(null)
  const [passport, setPassport] = useState<PurchasePassport | null>(null)
  const [product, setProduct] = useState<PublicVerifiedProduct | null>(null)
  const [provider, setProvider] = useState<NimiqProvider | null>(null)
  const [recoveryHash, setRecoveryHash] = useState<string | null>(
    () => productPublicId ? loadPurchaseSession(productPublicId)?.transactionHash ?? null : null,
  )

  async function acceptOrder(next: PurchaseOrder): Promise<void> {
    setOrder(next)
    if (next.passport) {
      const verifiedPassport = await getPassport(next.passport.publicId)
      setPassport(verifiedPassport)
      const url = new URL(globalThis.location.href)
      url.search = ''
      url.searchParams.set('passport', verifiedPassport.publicId)
      globalThis.history.replaceState(null, '', url)
      clearPurchaseSession()
      setNotice({ kind: 'success', message: 'Payment verified on Nimiq. Your Purchase Passport is ready.' })
    }
  }

  useEffect(() => {
    let active = true
    async function restore() {
      try {
        if (passportPublicId) {
          const restoredPassport = await getPassport(passportPublicId)
          if (active) setPassport(restoredPassport)
          return
        }
        if (!productPublicId) throw new Error('A public product or Passport identifier is required.')
        const restoredProduct = await getPublicProduct(productPublicId)
        if (!active) return
        setProduct(restoredProduct)
        const session = loadPurchaseSession(productPublicId)
        if (!session) return

        let restoredOrder = await getOrder(session.orderPublicId)
        if (session.transactionHash && !restoredOrder.transaction) {
          restoredOrder = await attachTransaction(restoredOrder.publicId, session.transactionHash)
        } else if (restoredOrder.paymentState === 'wallet_request_started') {
          restoredOrder = await recordWalletState(restoredOrder.publicId, 'submission-outcome-unknown')
        }
        if (!active) return
        await acceptOrder(restoredOrder)
        if (!restoredOrder.passport) {
          setNotice({
            kind: 'info',
            message: session.transactionHash
              ? 'Recovered the submitted transaction without opening another payment request.'
              : 'Recovered this purchase. No second payment request was opened.',
          })
        }
      } catch (error) {
        if (active) setNotice({ kind: 'error', message: errorMessage(error) })
      } finally {
        if (active) setBusy(null)
      }
    }
    void restore()
    return () => {
      active = false
    }
  }, [passportPublicId, productPublicId])

  async function preparePurchase() {
    if (!productPublicId || !product) return
    setBusy('preparing')
    setNotice(null)
    try {
      let currentOrder = order
      if (!orderReusable(currentOrder)) {
        // Identify the wallet's chain first, so a wallet on the wrong one is told
        // before an order exists rather than after a payment fails to verify.
        const activeProvider = provider ?? await initializeNimiqProvider()
        setProvider(activeProvider)
        const { network } = await identifyWalletNetwork(activeProvider)
        clearPurchaseSession()
        currentOrder = await createOrder(productPublicId, network)
        savePurchaseSession({ orderPublicId: currentOrder.publicId, productPublicId })
        setOrder(currentOrder)
      }
      if (!claimKeyUsable(currentOrder)) currentOrder = await requestClaimKey(currentOrder.publicId)
      setOrder(currentOrder)
      setNotice({
        kind: 'info',
        message: 'Order frozen. Sign the purchase claim key in Nimiq Pay before paying; it is the account that can later file claims.',
      })
    } catch (error) {
      setNotice({ kind: 'error', message: errorMessage(error) })
    } finally {
      setBusy(null)
    }
  }

  async function signClaimKey() {
    const claimKey = order?.claimKey
    if (!order || claimKey?.status !== 'pending') return
    setBusy('binding')
    setNotice({ kind: 'info', message: 'Review and sign the purchase claim key in Nimiq Pay. This is a signature, not a payment.' })
    try {
      const activeProvider = provider ?? await initializeNimiqProvider()
      setProvider(activeProvider)
      await assertWalletOnExpectedNetwork(activeProvider)
      const walletResult = await requestSignature(activeProvider, claimKey.canonicalMessage)
      const { proof, signerAddress } = buildClaimProof(claimKey.canonicalMessage, walletResult)
      const next = await submitClaimKey(order.publicId, claimKey.nonce, proof)
      setOrder(next)
      setNotice({
        kind: 'success',
        message: `Claim key ${short(signerAddress)} is bound to this order. Claims signed by it are accepted directly. You can pay now.`,
      })
    } catch (error) {
      setNotice({ kind: 'error', message: errorMessage(error) })
    } finally {
      setBusy(null)
    }
  }

  async function pay() {
    if (!productPublicId || !product || !orderReusable(order)) return
    if (order.claimKey?.status !== 'verified') {
      setNotice({ kind: 'error', message: 'This order has no verified claim key. Start a new purchase and sign its claim key first.' })
      return
    }
    setBusy('paying')
    setNotice(null)
    let currentOrder: PurchaseOrder = order
    let nativeRequestBegan = false
    try {

      const activeProvider = provider ?? await initializeNimiqProvider()
      setProvider(activeProvider)
      const network = await assertWalletOnExpectedNetwork(activeProvider)
      currentOrder = await recordWalletState(currentOrder.publicId, 'wallet-request-started')
      setOrder(currentOrder)
      setNotice({
        kind: 'info',
        message: `Review the native payment: ${formatNim(currentOrder.expectedPayment.valueLuna)} NIM goes directly to the merchant.`,
      })

      nativeRequestBegan = true
      const hash = await sendTransactionWithData(activeProvider, network, {
        data: currentOrder.expectedPayment.data,
        recipient: currentOrder.expectedPayment.recipient,
        validityStartHeight: network.blockNumber,
        value: currentOrder.expectedPayment.valueLuna,
      })
      savePurchaseSession({
        orderPublicId: currentOrder.publicId,
        productPublicId,
        transactionHash: hash,
      })
      setRecoveryHash(hash)
      setNotice({ kind: 'info', message: 'Payment submitted. NimReturn is verifying it independently on Nimiq.' })
      await acceptOrder(await attachTransaction(currentOrder.publicId, hash))
    } catch (error) {
      const walletError = normalizeWalletError(error)
      const savedHash = productPublicId ? loadPurchaseSession(productPublicId)?.transactionHash : undefined
      if (savedHash) {
        setRecoveryHash(savedHash)
        setNotice({
          kind: 'error',
          message: 'The transaction hash is saved, but verification did not finish. Retry verification below; do not open another payment.',
        })
      } else if (currentOrder && nativeRequestBegan && walletError.kind === 'cancelled') {
        try {
          await acceptOrder(await recordWalletState(currentOrder.publicId, 'wallet-cancelled'))
        } catch {
          // The next status read remains authoritative if cancellation persistence races expiry.
        }
        setNotice({ kind: 'info', message: 'Payment cancelled. No Passport was created; this exact order can be retried safely.' })
      } else if (currentOrder && nativeRequestBegan) {
        try {
          await acceptOrder(await recordWalletState(currentOrder.publicId, 'submission-outcome-unknown'))
        } catch {
          // Preserve the original wallet error while keeping the client locked against a second payment.
        }
        setNotice({
          kind: 'error',
          message: 'The wallet request began, but its broadcast result is unknown. Do not pay again. Check Nimiq Pay for a transaction hash and reconcile this order.',
        })
      } else {
        setNotice({ kind: 'error', message: errorMessage(error) })
      }
    } finally {
      setBusy(null)
    }
  }

  async function verifyAgain() {
    if (!order || !productPublicId) return
    setBusy('verifying')
    setNotice({ kind: 'info', message: 'Checking transaction execution and Albatross macro-block finality…' })
    try {
      const session = loadPurchaseSession(productPublicId)
      const next = !order.transaction && session?.transactionHash
        ? await attachTransaction(order.publicId, session.transactionHash)
        : await recheckTransaction(order.publicId)
      await acceptOrder(next)
      if (!next.passport) setNotice({ kind: 'info', message: next.transaction?.reason ?? 'Verification is not final yet. Check again shortly.' })
    } catch (error) {
      setNotice({ kind: 'error', message: errorMessage(error) })
    } finally {
      setBusy(null)
    }
  }

  async function reconcilePassport() {
    if (!passport) return
    setBusy('verifying')
    setNotice({ kind: 'info', message: 'Re-reading this purchase from the independent Nimiq verifier…' })
    try {
      await recheckTransaction(passport.orderPublicId)
      const refreshed = await getPassport(passport.publicId)
      setPassport(refreshed)
      setNotice({
        kind: refreshed.reconciliation.status === 'exception' ? 'error' : 'success',
        message: refreshed.reconciliation.reason,
      })
    } catch (error) {
      setNotice({ kind: 'error', message: errorMessage(error) })
    } finally {
      setBusy(null)
    }
  }

  if (busy === 'loading' && !product && !passport) {
    return <section className="buyer-loading" role="status">Loading independently verified purchase evidence…</section>
  }

  if (passport) {
    return (
      <>
        {notice && <div className={`notice notice--${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.message}</div>}
        <PassportPanel
          busy={busy === 'verifying'}
          onReconcile={() => void reconcilePassport()}
          passport={passport}
        />
        {passport.status !== 'verification_exception' && <PassportLifecycle key={passport.publicId} passportPublicId={passport.publicId} />}
        {passport.status === 'active' && <BuyerClaimJourney passport={passport} />}
      </>
    )
  }

  if (!product) {
    return (
      <section className="studio-panel">
        <h2>Verified product unavailable</h2>
        <p>{notice?.message ?? 'This link does not expose an active verified policy.'}</p>
      </section>
    )
  }

  const { payload } = product.policy
  const progress = progressIndex(order, recoveryHash)
  const isAmbiguous = order?.paymentState === 'submission_outcome_unknown'
  const orderOpen = orderReusable(order)
  const needsClaimKey = !orderOpen || (order.paymentState === 'payment_requested' && order.claimKey?.status !== 'verified')
  const claimKeyReady = orderOpen && order.claimKey?.status === 'pending' && claimKeyUsable(order)
  const canPay = !isAmbiguous && !needsClaimKey && orderOpen
    && ['payment_requested', 'payment_cancelled'].includes(order.paymentState)
  const canVerify = Boolean(order?.transaction || recoveryHash)

  return (
    <>
      <section className="buyer-product" aria-labelledby="buyer-product-title">
        <div className="buyer-product__copy">
          <p className="eyebrow">Verified merchant product</p>
          <h1 id="buyer-product-title">{payload.productName}</h1>
          <p className="buyer-description">{product.product.description || `Sold by ${product.merchant.displayName}`}</p>
          <div className="buyer-price"><strong>{formatNim(payload.priceLuna)} NIM</strong><span>{payload.priceLuna.toLocaleString()} Luna</span></div>
        </div>
        <aside className="policy-ticket" aria-label="Verified purchase policy">
          <div><span className="verified-dot">✓</span><strong>Merchant-signed policy</strong></div>
          <span>NR1 · Policy v{payload.version}</span>
          <dl>
            <div><dt>Returns</dt><dd>{formatDuration(payload.returnWindowSeconds)}</dd></div>
            <div><dt>Warranty</dt><dd>{formatDuration(payload.warrantyWindowSeconds)}</dd></div>
            <div><dt>Transferable</dt><dd>{payload.warrantyTransferAllowed ? 'Yes' : 'No'}</dd></div>
          </dl>
          <details><summary>Verify policy evidence</summary><code>{product.policy.proof.payloadHash}</code><code>{product.policy.signerAddress}</code></details>
          <a className="policy-ticket__ledger" href={`/?merchant=${product.merchant.publicId}`}>View public Promise Ledger →</a>
        </aside>
      </section>

      <ol className="purchase-progress" aria-label="Purchase verification progress">
        {['Order frozen', 'Nimiq Pay', 'Chain verification', 'Passport'].map((label, index) => {
          const complete = progress > index
          const active = progress === index
          return (
            <li className={complete ? 'complete' : active ? 'active' : ''} aria-current={active ? 'step' : undefined} key={label}>
              <span>{complete ? '✓' : index + 1}</span>
              <div><strong>{label}</strong><small>{complete ? 'Complete' : active ? 'Current' : 'Next'}</small></div>
            </li>
          )
        })}
      </ol>

      {notice && <div className={`notice notice--${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.message}</div>}

      <section className="checkout-panel">
        <div>
          <p className="eyebrow">Direct payment · no custody</p>
          <h2>{order ? purchaseHeading(order) : 'The payment becomes your receipt.'}</h2>
          <p>{order ? purchaseExplanation(order) : 'The server freezes these exact signed terms, then NIM moves directly from your wallet to the merchant settlement address.'}</p>
        </div>
        {order && <OrderEvidence order={order} />}
        {needsClaimKey && !isAmbiguous && (
          <div className="claim-key-step">
            <p className="eyebrow">Before paying · purchase claim key</p>
            <p>Nimiq Pay may pay from one account and sign from another. Signing this short message records which account can later file return or warranty claims for this purchase. It moves no funds.</p>
            {claimKeyReady && order.claimKey && (
              <details className="evidence-details canonical-preview">
                <summary>Inspect exact claim key message</summary>
                <pre>{order.claimKey.canonicalMessage}</pre>
              </details>
            )}
            {claimKeyReady
              ? (
                  <button type="button" disabled={busy !== null} onClick={() => void signClaimKey()}>
                    {busy === 'binding' ? 'Waiting for Nimiq Pay…' : 'Sign claim key with Nimiq Pay'}
                  </button>
                )
              : (
                  <button type="button" disabled={busy !== null} onClick={() => void preparePurchase()}>
                    {busy === 'preparing' ? 'Preparing order…' : 'Start purchase'}
                  </button>
                )}
          </div>
        )}
        {canPay && (
          <button type="button" disabled={busy !== null} onClick={() => void pay()}>
            {busy === 'paying' ? 'Waiting for Nimiq Pay…' : `${order?.paymentState === 'payment_cancelled' ? 'Retry' : 'Pay'} ${formatNim(payload.priceLuna)} NIM with Nimiq Pay`}
          </button>
        )}
        {canVerify && (
          <button className="button-secondary" type="button" disabled={busy !== null} onClick={() => void verifyAgain()}>
            {busy === 'verifying' ? 'Verifying on Nimiq…' : order?.transaction?.observedState === 'included' ? 'Recheck finality' : 'Check transaction again'}
          </button>
        )}
        {isAmbiguous && !order.transaction && (
          <div className="ambiguity-lock">
            <strong>Second payment blocked</strong>
            <span>No hash was returned, so NimReturn cannot safely assume the first request failed. Find the transaction in Nimiq Pay before taking another payment action.</span>
          </div>
        )}
        <p className="button-footnote">NimReturn never receives funds, a seed phrase, or a private key. Chain sender identity is read independently after payment.</p>
      </section>
    </>
  )
}

function purchaseHeading(order: PurchaseOrder): string {
  if (order.paymentState === 'payment_cancelled') return 'Payment cancelled safely.'
  if (order.paymentState === 'submission_outcome_unknown') return 'Broadcast outcome needs reconciliation.'
  if (order.paymentState === 'payment_failed') return 'Transaction evidence did not match.'
  if (order.transaction?.observedState === 'included') return 'Included. Waiting for real finality.'
  if (order.transaction) return 'Verifying on Nimiq.'
  return 'Exact payment request ready.'
}

function purchaseExplanation(order: PurchaseOrder): string {
  if (order.transaction) return order.transaction.reason
  return `This order permanently targets policy v${order.policy.version}; later merchant policies cannot change it.`
}

function OrderEvidence({ order }: { order: PurchaseOrder }) {
  return (
    <>
      <dl className="order-evidence">
        <div><dt>Terms locked</dt><dd>Policy v{order.policy.version} · {formatNim(order.expectedPayment.valueLuna)} NIM</dd></div>
        <div><dt>Purchase key</dt><dd>{order.claimKey?.status === 'verified' ? '✓ Signed' : 'Not signed yet'}</dd></div>
        {order.transaction && <div><dt>Payment</dt><dd>{order.transaction.observedState}</dd></div>}
      </dl>
      <ProofDisclosure>
        <dl className="order-evidence">
          <div><dt>Order</dt><dd><code>{order.publicId}</code></dd></div>
          <div><dt>Policy payload hash</dt><dd><code>{order.policy.payloadHash}</code></dd></div>
          <div><dt>Recipient</dt><dd><code>{order.expectedPayment.recipient}</code></dd></div>
          {order.claimKey?.status === 'verified' && order.claimKey.signerAddress && <div><dt>Claim key</dt><dd><code>{order.claimKey.signerAddress}</code></dd></div>}
          <div><dt>NR1 data</dt><dd><code>{order.expectedPayment.data}</code></dd></div>
          {order.transaction && <div><dt>Transaction</dt><dd><code>{order.transaction.hash}</code></dd></div>}
        </dl>
      </ProofDisclosure>
    </>
  )
}

function PassportPanel({
  busy,
  onReconcile,
  passport,
}: {
  busy: boolean
  onReconcile: () => void
  passport: PurchasePassport
}) {
  const { payload } = passport.policy
  const hasVerificationException = passport.status === 'verification_exception'
  return (
    <section className={hasVerificationException ? 'passport passport--exception' : 'passport'} aria-labelledby="passport-title">
      <div className="passport__hero">
        <span className="passport__seal" aria-hidden="true">✓</span>
        <div><p className="eyebrow">NR1 · independently verified</p><h1 id="passport-title">Purchase Passport</h1><p>{hasVerificationException ? 'Chain recheck requires attention' : 'Payment verified on Nimiq'}</p></div>
        <strong>Policy v{passport.policy.version}</strong>
      </div>
      <div className="passport__statement">
        <strong>{hasVerificationException ? 'Verification exception detected.' : 'The payment is your receipt.'}</strong>
        <span>{hasVerificationException ? passport.reconciliation.reason : `This purchase is permanently linked to the merchant-signed policy that was active when you paid. The merchant can publish new terms, but this purchase keeps v${passport.policy.version}.`}</span>
      </div>
      <dl className="passport__facts">
        <PassportFact label="Product" value={passport.product.name} />
        <PassportFact label="Paid" value={`${formatNim(passport.payment.valueLuna)} NIM`} detail={`${passport.payment.valueLuna.toLocaleString()} Luna`} />
        <PassportFact label="Merchant" value={passport.merchant.displayName} detail="Signed these terms with their Nimiq wallet" />
        <PassportFact label="Terms you bought under" value={`Policy v${passport.policy.version}`} detail="Later policy changes do not apply" />
        <PassportFact label="Return window" value={formatDuration(payload.returnWindowSeconds)} {...(passport.deadlines.return ? { detail: `Until ${formatDate(passport.deadlines.return)}` } : {})} />
        <PassportFact label="Warranty" value={formatDuration(payload.warrantyWindowSeconds)} {...(passport.deadlines.warranty ? { detail: `Until ${formatDate(passport.deadlines.warranty)}` } : {})} />
        <PassportFact label="Payment" value={hasVerificationException ? 'Exception · recheck required' : 'Verified on Nimiq'} detail={`${formatDate(passport.payment.purchaseTime)} · final`} />
        <PassportFact label="Claims" value={passport.claimKeySignerAddress ? 'Protected by your purchase key' : 'Protected by the paying account'} />
      </dl>
      <div className="passport__evidence">
        <div className="evidence-heading">
          <div><span>Public chain receipt</span><h2>Independently checked on Nimiq</h2></div>
          <button className="text-button" type="button" disabled={busy} onClick={onReconcile}>{busy ? 'Rechecking…' : 'Recheck on Nimiq'}</button>
        </div>
        <ProofDisclosure>
        <dl>
          <PassportFact label="Buyer · chain sender" value={passport.payment.buyerAddress} mono />
          <PassportFact label="Claim key · signed before payment" value={passport.claimKeySignerAddress ?? 'Not bound · chain sender only'} mono={Boolean(passport.claimKeySignerAddress)} />
          <PassportFact label="Finality" value={`Macro ${passport.payment.finality.finalizingBlockNumber.toLocaleString()}`} detail={`Head ${passport.payment.finality.headBlockNumber.toLocaleString()}`} />
          <PassportFact label="Transaction" value={passport.payment.transactionHash} mono />
          <PassportFact label="Purchase timestamp" value={formatDate(passport.payment.purchaseTime)} />
          <PassportFact label="Execution result" value="Successful · true" />
          <PassportFact label="NR1 data" value={passport.payment.data} mono />
          <PassportFact label="Settlement recipient" value={passport.payment.recipient} mono />
          <PassportFact label="Cryptographic policy signer" value={passport.policy.signerAddress} mono />
          <PassportFact label="Policy payload hash" value={passport.policy.payloadHash} mono />
          <PassportFact label="Confirmation rule" value={passport.payment.confirmationPolicy} mono />
          <PassportFact label="Latest reconciliation" value={passport.reconciliation.status} detail={passport.reconciliation.checkedAt ? formatDate(passport.reconciliation.checkedAt) : 'Original verification'} />
        </dl>
        </ProofDisclosure>
      </div>
      <p className="passport__boundary">NimReturn proves payment and the signed policy binding. It does not hold funds or guarantee future merchant performance. <a href={`/?merchant=${passport.merchant.publicId}`}>View this merchant&apos;s factual Promise Ledger →</a></p>
    </section>
  )
}

function PassportFact({ detail, label, mono = false, value }: { detail?: string; label: string; mono?: boolean; value: string }) {
  return <div><dt>{label}</dt><dd className={mono ? 'mono' : undefined}>{value}</dd>{detail && <small>{detail}</small>}</div>
}
