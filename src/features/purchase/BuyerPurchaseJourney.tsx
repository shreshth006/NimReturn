import type { NimiqProvider } from '@nimiq/mini-app-sdk'
import { useEffect, useState } from 'react'

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
} from '../../lib/api/purchase.js'
import {
  assertWalletConsensusForPayment,
  initializeNimiqProvider,
  normalizeWalletError,
  readProviderNetwork,
  sendTransactionWithData,
} from '../../lib/nimiq/provider.js'
import {
  clearPurchaseSession,
  loadPurchaseSession,
  savePurchaseSession,
} from './purchase-session.js'

type BusyAction = 'loading' | 'paying' | 'verifying' | null
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

  async function pay() {
    if (!productPublicId || !product) return
    setBusy('paying')
    setNotice(null)
    let currentOrder = order
    let nativeRequestBegan = false
    try {
      if (!currentOrder || ['expired', 'payment_failed'].includes(currentOrder.paymentState)) {
        clearPurchaseSession()
        currentOrder = await createOrder(productPublicId)
        savePurchaseSession({ orderPublicId: currentOrder.publicId, productPublicId })
        setOrder(currentOrder)
      }

      const activeProvider = provider ?? await initializeNimiqProvider()
      setProvider(activeProvider)
      const network = await readProviderNetwork(activeProvider)
      assertWalletConsensusForPayment(network)
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

  if (busy === 'loading' && !product && !passport) {
    return <section className="buyer-loading" role="status">Loading independently verified purchase evidence…</section>
  }

  if (passport) return <PassportPanel passport={passport} />

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
  const canPay = !isAmbiguous && (!order || ['payment_requested', 'payment_cancelled', 'expired', 'payment_failed'].includes(order.paymentState))
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
        </aside>
      </section>

      <ol className="purchase-progress" aria-label="Purchase verification progress">
        {['Order frozen', 'Nimiq Pay', 'Chain verification', 'Passport'].map((label, index) => (
          <li className={progress > index ? 'complete' : progress === index ? 'active' : ''} key={label}>
            <span>{progress > index ? '✓' : index + 1}</span><strong>{label}</strong>
          </li>
        ))}
      </ol>

      {notice && <div className={`notice notice--${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.message}</div>}

      <section className="checkout-panel">
        <div>
          <p className="eyebrow">Direct payment · no custody</p>
          <h2>{order ? purchaseHeading(order) : 'The payment becomes your receipt.'}</h2>
          <p>{order ? purchaseExplanation(order) : 'The server freezes these exact signed terms, then NIM moves directly from your wallet to the merchant settlement address.'}</p>
        </div>
        {order && <OrderEvidence order={order} />}
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
    <dl className="order-evidence">
      <div><dt>Order</dt><dd><code>{order.publicId}</code></dd></div>
      <div><dt>Policy frozen</dt><dd>v{order.policy.version} · <code>{short(order.policy.payloadHash)}</code></dd></div>
      <div><dt>Recipient</dt><dd><code>{short(order.expectedPayment.recipient)}</code></dd></div>
      <div><dt>NR1 data</dt><dd><code>{order.expectedPayment.data}</code></dd></div>
      {order.transaction && <div><dt>Transaction</dt><dd><code>{short(order.transaction.hash)}</code></dd></div>}
      {order.transaction && <div><dt>Observed</dt><dd>{order.transaction.observedState}</dd></div>}
    </dl>
  )
}

function PassportPanel({ passport }: { passport: PurchasePassport }) {
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
        <PassportFact label="Buyer · chain sender" value={short(passport.payment.buyerAddress)} mono />
        <PassportFact label="Merchant" value={passport.merchant.displayName} detail={short(passport.payment.recipient)} />
        <PassportFact label="Policy at purchase" value={`v${passport.policy.version}`} detail={short(passport.policy.payloadHash)} />
        <PassportFact label="Return window" value={formatDuration(payload.returnWindowSeconds)} {...(passport.deadlines.return ? { detail: `Until ${formatDate(passport.deadlines.return)}` } : {})} />
        <PassportFact label="Warranty" value={formatDuration(payload.warrantyWindowSeconds)} {...(passport.deadlines.warranty ? { detail: `Until ${formatDate(passport.deadlines.warranty)}` } : {})} />
        <PassportFact label="Finality" value={hasVerificationException ? 'Exception · recheck required' : 'Verified'} detail={`Macro ${passport.payment.finality.finalizingBlockNumber.toLocaleString()} · head ${passport.payment.finality.headBlockNumber.toLocaleString()}`} />
      </dl>
      <div className="passport__evidence">
        <h2>Independent evidence</h2>
        <dl>
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
      </div>
      <p className="passport__boundary">NimReturn proves payment and the signed policy binding. It does not hold funds or guarantee future merchant performance.</p>
    </section>
  )
}

function PassportFact({ detail, label, mono = false, value }: { detail?: string; label: string; mono?: boolean; value: string }) {
  return <div><dt>{label}</dt><dd className={mono ? 'mono' : undefined}>{value}</dd>{detail && <small>{detail}</small>}</div>
}
