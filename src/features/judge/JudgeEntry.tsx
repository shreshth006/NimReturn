import { useEffect, useState } from 'react'

import { getFeaturedExample } from '../../lib/api/purchase.js'
import { fetchNetworkStatus } from '../../lib/nimiq/network-gate.js'

const SHORT_LABEL: Record<string, string> = {
  MainAlbatross: 'Mainnet',
  TestAlbatross: 'Testnet',
}

/**
 * A quiet indicator of which Nimiq network is in play, in place of the old banner.
 * Judges and buyers need the fact available, not announced.
 */
export function NetworkIndicator({ network }: { network?: string | null }) {
  const [verified, setVerified] = useState<string[] | null>(null)

  useEffect(() => {
    let active = true
    fetchNetworkStatus()
      .then((status) => {
        if (!active) return
        setVerified((status.networks ?? [])
          .filter((entry) => entry.blockNumber !== null)
          .map((entry) => SHORT_LABEL[entry.network] ?? entry.network))
      })
      .catch(() => { if (active) setVerified(null) })
    return () => { active = false }
  }, [])

  // A record on screen states its own chain; otherwise show what this deployment verifies.
  const shown = network ? [SHORT_LABEL[network] ?? network] : verified
  if (!shown || shown.length === 0) return null
  const live = shown.includes('Mainnet')
  return (
    <span className={`network-chip${live ? ' network-chip--live' : ''}`} title="Nimiq network">
      <span className="network-chip__dot" aria-hidden="true" />
      {shown.join(' · ')}
    </span>
  )
}

export function CompletedExampleLink() {
  const [example, setExample] = useState<{ passportPublicId: string; productPublicId: string } | null>(null)

  useEffect(() => {
    let active = true
    getFeaturedExample()
      .then((value) => { if (active) setExample(value) })
      .catch(() => { if (active) setExample(null) })
    return () => { active = false }
  }, [])

  // Only a Passport the server just re-verified is offered; otherwise nothing is shown.
  if (!example) return null
  return (
    <a className="example-link" href={`/?passport=${example.passportPublicId}`}>
      <span>New here? No wallet needed</span>
      <strong>View a completed example</strong>
      <small>Signed promise → verified payment → Purchase Passport → claim → signed approval → verified refund</small>
    </a>
  )
}
