import { PhaseZeroDiagnostics } from '../features/diagnostics/PhaseZeroDiagnostics.js'
import { MerchantPolicyStudio } from '../features/merchant/MerchantPolicyStudio.js'

export function App() {
  const diagnostics = new URL(globalThis.location.href).searchParams.has('diagnostics')

  return (
    <main>
      <header className="site-header">
        <a className="wordmark" href="/" aria-label="NimReturn merchant studio">
          Nim<span>Return</span>
        </a>
        <nav aria-label="Utility navigation">
          <a className="utility-link" href={diagnostics ? '/' : '/?diagnostics=1'}>
            {diagnostics ? 'Merchant studio' : 'Diagnostics'}
          </a>
          <span className="phase-badge">Phase 1 · Merchant</span>
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
      ) : <MerchantPolicyStudio />}

      <footer>
        <p>NimReturn verifies signed promises and direct-chain evidence. It does not hold funds, reverse payments, or guarantee a merchant&apos;s actions.</p>
        <span>NR1 · Built for Nimiq Pay</span>
      </footer>
    </main>
  )
}
