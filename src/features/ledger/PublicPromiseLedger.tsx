import { useEffect, useState } from 'react'

import {
  getPromiseLedger,
  PromiseLedgerApiError,
  type PromiseLedger,
  type PromiseLedgerCountMetric,
} from '../../lib/api/promise-ledger.js'

function formatNim(valueLuna: number): string {
  return (valueLuna / 100_000).toLocaleString(undefined, { maximumFractionDigits: 5 })
}

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(new Date(value)) + ' UTC'
}

function formatResponseTime(value: number | null): string {
  if (value === null) return '—'
  if (value < 1_000) return `${value.toLocaleString()} ms`
  const seconds = value / 1_000
  if (seconds < 60) return `${seconds.toLocaleString(undefined, { maximumFractionDigits: 1 })} sec`
  const minutes = seconds / 60
  if (minutes < 60) return `${minutes.toLocaleString(undefined, { maximumFractionDigits: 1 })} min`
  const hours = minutes / 60
  return `${hours.toLocaleString(undefined, { maximumFractionDigits: 1 })} hr`
}

function short(value: string): string {
  return `${value.slice(0, 8)}…${value.slice(-6)}`
}

const PROOF_STEPS = [
  ['Policy locked', 'Wallet signature', 'The policy signer attests to exact versioned terms and a separate settlement address.'],
  ['Purchase verified', 'Nimiq transaction', 'The chain proves who paid the signed settlement address, how much, and under which order tag.'],
  ['Passport issued', 'Derived record', 'NimReturn binds the verified payment to the policy version active at purchase.'],
  ['Claim filed', 'Wallet signature', 'The claim signer attests to the request; purchaser authority is verified separately.'],
  ['Decision recorded', 'Wallet signature', 'The original policy signer attests to approval or rejection.'],
  ['Refund verified', 'Nimiq transaction', 'Only exact settlement-sender, buyer-recipient, value, tag, execution, and finality evidence counts.'],
  ['Ledger derived', 'Read-only aggregate', 'These figures are recomputed from the verified records above and cannot be edited here.'],
] as const

export function PublicPromiseLedger({ merchantPublicId }: { merchantPublicId: string }) {
  const [ledger, setLedger] = useState<PromiseLedger | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let active = true
    void getPromiseLedger(merchantPublicId)
      .then((result) => {
        if (active) setLedger(result)
      })
      .catch((caught: unknown) => {
        if (!active) return
        setLedger(null)
        setError(caught instanceof PromiseLedgerApiError
          ? caught.message
          : 'The Promise Ledger could not be loaded safely.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [merchantPublicId, reloadKey])

  function retry() {
    setLedger(null)
    setError(null)
    setLoading(true)
    setReloadKey((value) => value + 1)
  }

  if (loading && !ledger) {
    return (
      <section className="ledger-state" role="status" aria-live="polite" aria-busy="true">
        <span className="ledger-state__mark" aria-hidden="true">NR1</span>
        <h1>Deriving verified merchant activity…</h1>
        <p>Purchases, attestations, decisions, and refunds are being reconciled from their source evidence.</p>
      </section>
    )
  }

  if (!ledger) {
    return (
      <section className="ledger-state" role="alert">
        <span className="ledger-state__mark" aria-hidden="true">!</span>
        <h1>Promise Ledger unavailable</h1>
        <p>{error ?? 'No verified merchant evidence was found for this link.'}</p>
        <button type="button" onClick={retry}>Try the verified read again</button>
      </section>
    )
  }

  const { metrics } = ledger
  const hasCommerce = metrics.verifiedPurchases.value > 0

  return (
    <article className="promise-ledger" aria-labelledby="ledger-title">
      <header className="ledger-hero">
        <div>
          <p className="eyebrow">Public Promise Ledger · {ledger.definitionsVersion}</p>
          <h1 id="ledger-title">Promises, counted from proof.</h1>
          <p className="ledger-hero__copy">
            {ledger.merchant.displayName}&apos;s factual Nimiq activity. No ratings, reviews, trust score,
            or merchant-edited numbers—only reproducible counts from verified protocol records.
          </p>
          <p className="ledger-as-of">
            Snapshot as of <time dateTime={ledger.asOf}>{formatTimestamp(ledger.asOf)}</time>
          </p>
        </div>
        <div className="ledger-tally" aria-label="Verified commerce totals">
          <div><strong>{metrics.verifiedPurchases.value}</strong><span>verified purchases</span></div>
          <div><strong>{metrics.verifiedRefunds.value}</strong><span>verified refunds</span></div>
        </div>
      </header>

      <section className="ledger-proof-model" aria-labelledby="proof-model-title">
        <div className="ledger-section-heading">
          <p className="eyebrow">The complete evidence path</p>
          <h2 id="proof-model-title">Two kinds of proof. Seven visible steps.</h2>
          <p>Cryptographic signatures attest to statements. Independently verified chain transactions prove monetary movement. NimReturn never treats one as the other.</p>
        </div>
        <ol className="proof-journey">
          {PROOF_STEPS.map(([title, source, description], index) => (
            <li key={title}>
              <span className="proof-journey__number">{String(index + 1).padStart(2, '0')}</span>
              <div><strong>{title}</strong><small>{description}</small></div>
              <span className={source === 'Nimiq transaction' ? 'proof-source proof-source--chain' : 'proof-source'}>{source}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="ledger-metrics" aria-labelledby="ledger-metrics-title">
        <div className="ledger-section-heading">
          <p className="eyebrow">Derived, never entered</p>
          <h2 id="ledger-metrics-title">Verified lifecycle facts</h2>
          <p>{hasCommerce ? 'Every total below reconciles to the same accepted source set.' : 'Not enough verified activity yet. Definitions remain visible, and every sample starts at zero.'}</p>
        </div>
        <div className="metric-grid">
          <MetricCard label="Verified purchases" metric={metrics.verifiedPurchases} tone="chain" />
          <MetricCard label="Claims filed" metric={metrics.claimsFiled} />
          <MetricCard label="Policy eligible" metric={metrics.eligibleClaims} tone="positive" />
          <MetricCard label="Policy ineligible" metric={metrics.ineligibleClaims} />
          <MetricCard label="Approved" metric={metrics.approvedClaims} tone="positive" />
          <MetricCard label="Rejected" metric={metrics.rejectedClaims} />
          <MetricCard label="Refund pending" metric={metrics.refundPending} tone="pending" />
          <MetricCard label="Verified refunds" metric={metrics.verifiedRefunds} tone="chain" />
          <MetricCard label="Unresolved cases" metric={metrics.unresolvedCases} tone="pending" />
          <article className="metric-card metric-card--time">
            <span>Median verified response</span>
            <strong>{formatResponseTime(metrics.medianResolutionTime.value)}</strong>
            <small>Sample n={metrics.medianResolutionTime.sampleSize}</small>
            <p>{metrics.medianResolutionTime.definition}</p>
          </article>
        </div>
      </section>

      <section className="identity-proof" aria-labelledby="identity-title">
        <div className="ledger-section-heading">
          <p className="eyebrow">Identity roles stay separate</p>
          <h2 id="identity-title">Who attests is not automatically who pays.</h2>
        </div>
        <dl className="identity-grid">
          <div>
            <dt>Policy signer · attestation authority</dt>
            <dd><code aria-label={`Full policy signer address ${ledger.merchant.policySignerAddress}`}>{ledger.merchant.policySignerAddress}</code></dd>
            <small>Derived from the verified policy proof public key.</small>
          </div>
          <div>
            <dt>Purchase sender · monetary evidence</dt>
            <dd>Observed per verified transaction</dd>
            <small>Never inferred from the signer, settlement address, or wallet account list.</small>
          </div>
          <div>
            <dt>Claim signer · attestation authority</dt>
            <dd>Verified per claim</dd>
            <small>Authorized by exact equality with—or a one-claim proof from—the purchase sender.</small>
          </div>
        </dl>
      </section>

      <section className="ledger-products" aria-labelledby="ledger-products-title">
        <div className="ledger-section-heading">
          <p className="eyebrow">Active merchant-signed offers</p>
          <h2 id="ledger-products-title">Verify the promise before paying.</h2>
        </div>
        {ledger.products.length === 0 ? (
          <div className="ledger-empty"><strong>No active verified products.</strong><span>Historical verified activity remains counted above.</span></div>
        ) : (
          <ul>
            {ledger.products.map((product) => (
              <li key={product.publicId}>
                <div>
                  <span>NR1 policy v{product.policyVersion}</span>
                  <h3>{product.name}</h3>
                  <strong>{formatNim(product.priceLuna)} NIM</strong>
                </div>
                <dl>
                  <div><dt>Policy signer</dt><dd><code aria-label={`Full policy signer address ${product.policySignerAddress}`} title={product.policySignerAddress}>{short(product.policySignerAddress)}</code></dd></div>
                  <div><dt>Settlement address</dt><dd><code aria-label={`Full settlement address ${product.settlementAddress}`} title={product.settlementAddress}>{short(product.settlementAddress)}</code></dd></div>
                  <div><dt>Payload hash</dt><dd><code aria-label={`Full policy payload hash ${product.payloadHash}`} title={product.payloadHash}>{short(product.payloadHash)}</code></dd></div>
                </dl>
                <a className="ledger-product-link" href={`/?product=${product.publicId}`}>Open verified product <span aria-hidden="true">→</span></a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="ledger-method" aria-labelledby="ledger-method-title">
        <div>
          <p className="eyebrow">Method and privacy boundary</p>
          <h2 id="ledger-method-title">Inspectable facts, minimal exposure.</h2>
        </div>
        <div>
          <p>{ledger.evidenceModel.walletSignatures}</p>
          <p>{ledger.evidenceModel.chainTransactions}</p>
          <p>Buyer addresses, claim signer addresses, notes, and individual case relationships are not published in this aggregate.</p>
          <details>
            <summary>Why these numbers cannot be edited</summary>
            <p>The API runtime has SELECT-only access to an aggregate database view. The public endpoint accepts no metric body and exposes no mutation method. Reconciliation failures make the read unavailable instead of displaying inconsistent totals.</p>
          </details>
        </div>
      </section>
    </article>
  )
}

function MetricCard({
  label,
  metric,
  tone = 'neutral',
}: {
  label: string
  metric: PromiseLedgerCountMetric
  tone?: 'chain' | 'neutral' | 'pending' | 'positive'
}) {
  return (
    <article className={`metric-card metric-card--${tone}`}>
      <span>{label}</span>
      <strong>{metric.value.toLocaleString()}</strong>
      <small>Sample n={metric.sampleSize.toLocaleString()}</small>
      <p>{metric.definition}</p>
    </article>
  )
}
