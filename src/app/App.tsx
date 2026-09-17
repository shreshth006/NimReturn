import { lazy, Suspense } from 'react'

import { CompletedExampleLink, NetworkNotice } from '../features/judge/JudgeEntry.js'

const PhaseZeroDiagnostics = lazy(async () => ({
  default: (await import('../features/diagnostics/PhaseZeroDiagnostics.js')).PhaseZeroDiagnostics,
}))
const MerchantPolicyStudio = lazy(async () => ({
  default: (await import('../features/merchant/MerchantPolicyStudio.js')).MerchantPolicyStudio,
}))
const BuyerPurchaseJourney = lazy(async () => ({
  default: (await import('../features/purchase/BuyerPurchaseJourney.js')).BuyerPurchaseJourney,
}))
const PublicPromiseLedger = lazy(async () => ({
  default: (await import('../features/ledger/PublicPromiseLedger.js')).PublicPromiseLedger,
}))

export function App() {
  const params = new URL(globalThis.location.href).searchParams
  const diagnostics = params.has('diagnostics')
  const merchantPublicId = params.get('merchant')
  const passportPublicId = params.get('passport')
  const productPublicId = params.get('product')
  const publicLedger = !diagnostics && Boolean(merchantPublicId)
  const buyerJourney = !diagnostics && !publicLedger && Boolean(passportPublicId || productPublicId)

  return (
    <main>
      <header className="site-header">
        <a className="wordmark" href="/" aria-label="NimReturn home">
          Nim<span>Return</span>
        </a>
        <nav aria-label="Utility navigation">
          <a className="utility-link" href={diagnostics || buyerJourney || publicLedger ? '/' : '/?diagnostics=1'}>
            {diagnostics || buyerJourney || publicLedger ? 'Merchant studio' : 'Diagnostics'}
          </a>
          <span className="phase-badge">{publicLedger ? 'Promise Ledger' : passportPublicId ? 'Purchase Passport' : buyerJourney ? 'Protected purchase' : diagnostics ? 'Diagnostics' : 'Merchant studio'}</span>
        </nav>
      </header>
      <NetworkNotice />
      {!diagnostics && !publicLedger && !passportPublicId && <CompletedExampleLink />}

      <Suspense fallback={<section className="buyer-loading" role="status">Loading the requested NimReturn proof surface…</section>}>
        {diagnostics ? (
          <>
            <section className="hero" id="top">
              <p className="eyebrow">Deferred device verification</p>
              <h1>The payment is your receipt. The merchant&apos;s signature is your policy.</h1>
              <p className="hero-copy">Phase 0 diagnostics remain available for T-001, T-002, and T-020. No unfinished case is represented as passed.</p>
            </section>
            <PhaseZeroDiagnostics />
          </>
        ) : publicLedger && merchantPublicId ? (
          <PublicPromiseLedger merchantPublicId={merchantPublicId} />
        ) : buyerJourney ? (
          <BuyerPurchaseJourney
            passportPublicId={passportPublicId}
            productPublicId={productPublicId}
          />
        ) : <MerchantPolicyStudio />}
      </Suspense>

      <footer>
        <p>NimReturn verifies signed promises and direct-chain evidence. It does not hold funds, reverse payments, or guarantee a merchant&apos;s actions.</p>
        <span>NR1 · Built for Nimiq Pay</span>
      </footer>
    </main>
  )
}
