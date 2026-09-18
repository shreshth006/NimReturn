import { useEffect, useState } from 'react'

import { getFeaturedExample } from '../../lib/api/purchase.js'
import { fetchNetworkStatus } from '../../lib/nimiq/network-gate.js'

export function NetworkNotice() {
  const [labels, setLabels] = useState<string[] | null>(null)

  useEffect(() => {
    let active = true
    fetchNetworkStatus()
      .then((status) => {
        if (!active) return
        const verified = (status.networks ?? [])
          .filter((entry) => entry.blockNumber !== null)
          .map((entry) => entry.label)
        setLabels(verified.length > 0 ? verified : [status.label])
      })
      .catch(() => { if (active) setLabels(null) })
    return () => { active = false }
  }, [])

  if (!labels || labels.length === 0) return null

  // With more than one chain verified there is nothing to switch to: the wallet's own
  // network is detected, and each product is bought on the network it is sold on.
  if (labels.length > 1) {
    const readable = `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`
    return (
      <p className="network-notice" role="note">
        <strong>Verified on {readable}.</strong> NimReturn detects which network your wallet is on.
        Each product is bought on the network it is sold on.
      </p>
    )
  }

  return (
    <p className="network-notice" role="note">
      <strong>Runs on {labels[0]}.</strong> Switch Nimiq Pay to {labels[0]} before buying or signing. Viewing proofs works on any network.
    </p>
  )
}

export function CompletedExampleLink() {
  const [passportPublicId, setPassportPublicId] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    getFeaturedExample()
      .then((id) => { if (active) setPassportPublicId(id) })
      .catch(() => { if (active) setPassportPublicId(null) })
    return () => { active = false }
  }, [])

  // Only a Passport the server just re-verified is offered; otherwise nothing is shown.
  if (!passportPublicId) return null
  return (
    <a className="example-link" href={`/?passport=${passportPublicId}`}>
      <span>New here? No wallet needed</span>
      <strong>View a completed example</strong>
      <small>Signed promise → verified payment → Purchase Passport → claim → signed approval → verified refund</small>
    </a>
  )
}
