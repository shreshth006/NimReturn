import { useEffect, useState } from 'react'

import { getFeaturedExample } from '../../lib/api/purchase.js'
import { fetchNetworkStatus } from '../../lib/nimiq/network-gate.js'

export function NetworkNotice() {
  const [label, setLabel] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    fetchNetworkStatus()
      .then((status) => { if (active) setLabel(status.label) })
      .catch(() => { if (active) setLabel(null) })
    return () => { active = false }
  }, [])

  if (!label) return null
  return (
    <p className="network-notice" role="note">
      <strong>Runs on {label}.</strong> Switch Nimiq Pay to {label} before buying or signing. Viewing proofs works on any network.
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
