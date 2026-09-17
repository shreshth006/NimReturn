import { useEffect, useState } from 'react'

import {
  ClaimApiError,
  getResolution,
  listPassportClaims,
  type ClaimResolution,
  type PublicPassportClaim,
} from '../../lib/api/claims.js'
import { getRefund, RefundApiError, type Refund } from '../../lib/api/refunds.js'
import { ProofDisclosure } from '../proof/ProofDisclosure.js'

interface LifecycleEntry {
  claim: PublicPassportClaim
  refund: Refund | null
  resolution: ClaimResolution | null
}

function formatNim(luna: number): string {
  return (luna / 100_000).toLocaleString(undefined, { maximumFractionDigits: 5 })
}

async function loadEntry(claim: PublicPassportClaim): Promise<LifecycleEntry> {
  let resolution: ClaimResolution | null = null
  let refund: Refund | null = null
  try {
    resolution = await getResolution(claim.publicId)
  } catch (error) {
    if (!(error instanceof ClaimApiError && error.status === 404)) throw error
  }
  if (resolution?.decision === 'APPROVED') {
    try {
      refund = await getRefund(claim.publicId)
    } catch (error) {
      if (!(error instanceof RefundApiError && error.status === 404)) throw error
    }
  }
  return { claim, refund, resolution }
}

export function PassportLifecycle({ passportPublicId }: { passportPublicId: string }) {
  const [entries, setEntries] = useState<LifecycleEntry[]>([])
  const [loadState, setLoadState] = useState<'failed' | 'loading' | 'ready'>('loading')
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    let active = true
    listPassportClaims(passportPublicId)
      .then((claims) => Promise.all(claims.map(loadEntry)))
      .then((loaded) => {
        if (!active) return
        setEntries(loaded)
        setLoadState('ready')
      })
      .catch(() => { if (active) setLoadState('failed') })
    return () => { active = false }
  }, [passportPublicId, revision])

  if (loadState === 'loading') {
    return <p className="lifecycle-note" role="status">Verifying the after-purchase history…</p>
  }
  if (loadState === 'failed') {
    return (
      <section className="passport-lifecycle" aria-labelledby="lifecycle-title">
        <p className="eyebrow">After purchase</p>
        <h2 id="lifecycle-title">What happened to this promise</h2>
        <p className="lifecycle-note" role="alert">The after-purchase history could not be verified right now.</p>
        <button type="button" onClick={() => {
          setLoadState('loading')
          setRevision((value) => value + 1)
        }}>Retry verified history</button>
      </section>
    )
  }
  if (entries.length === 0) {
    return <p className="lifecycle-note" role="status">No verified after-purchase claim has been recorded for this Passport.</p>
  }

  return (
    <section className="passport-lifecycle" aria-labelledby="lifecycle-title">
      <p className="eyebrow">After purchase</p>
      <h2 id="lifecycle-title">What happened to this promise</h2>
      <ol>
        {entries.map(({ claim, refund, resolution }) => {
          const refunded = refund?.attempt?.state === 'refunded'
          return (
            <li key={claim.publicId}>
              <div className="lifecycle-step">
                <strong>{claim.claimType === 'RETURN' ? 'Return' : 'Warranty'} claim · {claim.reasonCode.replaceAll('_', ' ').toLowerCase()}</strong>
                <span>{claim.eligibility?.eligible ? '✓ Eligible under the original purchase policy' : '— Outside the original purchase policy'}</span>
              </div>
              <div className="lifecycle-step">
                <strong>Merchant decision</strong>
                <span>{!resolution ? 'Waiting for a signed decision' : resolution.decision === 'APPROVED' ? '✓ Approved and signed by the merchant' : 'Rejected and signed by the merchant'}</span>
              </div>
              {resolution?.decision === 'APPROVED' && (
                <div className="lifecycle-step">
                  <strong>Refund</strong>
                  <span>{refunded ? `✓ ${formatNim(resolution.approvedRefundLuna)} NIM refund verified on Nimiq` : 'Approved · refund not yet verified'}</span>
                </div>
              )}
              <ProofDisclosure>
                <dl>
                  <div><dt>Claim payload hash</dt><dd><code>{claim.payloadHash}</code></dd></div>
                  <div><dt>Claim authorization</dt><dd>{claim.authorization?.mode ?? 'pending'}</dd></div>
                  {resolution && <div><dt>Decision signer</dt><dd><code>{resolution.policySignerAddress}</code></dd></div>}
                  {resolution && <div><dt>Decision payload hash</dt><dd><code>{resolution.payloadHash}</code></dd></div>}
                  {refund?.attempt?.transaction && <div><dt>Refund transaction</dt><dd><code>{refund.attempt.transaction.hash}</code></dd></div>}
                  {refund?.attempt?.transaction?.finalizingBlockNumber && <div><dt>Finalizing macro block</dt><dd>{refund.attempt.transaction.finalizingBlockNumber}</dd></div>}
                </dl>
              </ProofDisclosure>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
