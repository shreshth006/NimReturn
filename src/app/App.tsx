import { PhaseZeroDiagnostics } from '../features/diagnostics/PhaseZeroDiagnostics.js'

export function App() {
  return (
    <main>
      <header className="site-header">
        <a className="wordmark" href="#top" aria-label="NimReturn home">
          NimReturn
        </a>
        <span className="phase-badge">Internal · Phase 0</span>
      </header>

      <section className="hero" id="top">
        <p className="eyebrow">The consumer-protection layer for Nimiq Pay</p>
        <h1>The payment is your receipt. The merchant's signature is your policy.</h1>
        <p className="hero-copy">
          This internal screen proves the wallet, signature, address, transaction-data, and
          independent lookup primitives before product features are allowed to grow.
        </p>
        <div className="truth-strip" role="note">
          <span>No custody</span>
          <span>No private keys</span>
          <span>No premature success</span>
        </div>
      </section>

      <PhaseZeroDiagnostics />

      <footer>
        <p>
          Diagnostic results are evidence for engineering—not a Purchase Passport and not a promise
          of a refund.
        </p>
      </footer>
    </main>
  )
}
