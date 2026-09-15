import { PhaseZeroDiagnostics } from '../features/diagnostics/PhaseZeroDiagnostics.js'
import { MerchantPolicyStudio } from '../features/merchant/MerchantPolicyStudio.js'
import { BuyerPurchaseJourney } from '../features/purchase/BuyerPurchaseJourney.js'

export function App() {
  const params = new URL(globalThis.location.href).searchParams
  const diagnostics = params.has('diagnostics')
  const passportPublicId = params.get('passport')
  const productPublicId = params.get('product')
  const buyerJourney = !diagnostics && Boolean(passportPublicId || productPublicId)

  return (
    <main>
      <header className="site-header">
        <a className="wordmark" href="/" aria-label="NimReturn home">
          Nim<span>Return</span>
        </a>
        <nav aria-label="Utility navigation">
          <a className="utility-link" href={diagnostics || buyerJourney ? '/' : '/?diagnostics=1'}>
            {diagnostics || buyerJourney ? 'Merchant studio' : 'Diagnostics'}
          </a>
          <span className="phase-badge">{passportPublicId ? 'Phase 4 · Passport' : buyerJourney ? 'Phase 2 · Purchase' : diagnostics ? 'Phase 0 · Diagnostics' : 'Phase 4 · Merchant'}</span>
        </nav>
      </header>

      {diagnostics ? (
        <>
          <section className="hero" id="top">
            <p className="eyebrow">Deferred device verification</p>
            <h1>The payment is your receipt. The merchant&apos;s signature is your policy.</h1>
            <p className="hero-copy">Phase 0 diagnostics remain available for T-001, T-002, and T-020. No unfinished case is represented as passed.</p>
          </section>
          <PhaseZeroDiagnostics />
        </>
      ) : buyerJourney ? (
        <BuyerPurchaseJourney
          passportPublicId={passportPublicId}
          productPublicId={productPublicId}
        />
      ) : <MerchantPolicyStudio />}

      <footer>
        <p>NimReturn verifies signed promises and direct-chain evidence. It does not hold funds, reverse payments, or guarantee a merchant&apos;s actions.</p>
        <span>NR1 · Built for Nimiq Pay</span>
      </footer>
    </main>
  )
}
