import { lazy, Suspense } from 'react'

import { CompletedExampleLink, NetworkIndicator } from '../features/judge/JudgeEntry.js'
import { Landing } from '../features/judge/Landing.js'

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
  // The merchant studio is a destination now, not the front door.
  const merchantStudio = !diagnostics && !publicLedger && !buyerJourney && params.has('sell')
  const landing = !diagnostics && !publicLedger && !buyerJourney && !merchantStudio

  return (
    <main>
      <header className="site-header">
        <a className="wordmark" href="/" aria-label="NimReturn home">
          <img className="wordmark__mark" src="/logo-96.png" alt="" width="28" height="28" />
          <span className="wordmark__text">NimReturn</span>
        </a>
        <nav aria-label="Utility navigation">
          <a className="utility-link" href={landing ? '/?sell=1' : '/'}>
            {landing ? 'Sell' : 'Home'}
          </a>
          <NetworkIndicator />
        </nav>
      </header>
      {merchantStudio && <CompletedExampleLink />}

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
        ) : landing ? <Landing /> : <MerchantPolicyStudio />}
      </Suspense>

      <footer>
        <p>NimReturn verifies signed promises and direct-chain evidence. It does not hold funds, reverse payments, or guarantee a merchant&apos;s actions.</p>
        <span>NR1 · Built for Nimiq Pay</span>
      </footer>
    </main>
  )
}
