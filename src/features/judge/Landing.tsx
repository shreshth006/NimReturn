import { useEffect, useState } from 'react'

import { getFeaturedExample } from '../../lib/api/purchase.js'
import { clearMerchantWorkspace, loadMerchantWorkspace } from '../merchant/merchant-workspace.js'

/**
 * The first screen a visitor meets. It leads with what NimReturn does and offers the
 * two things anyone could want next, rather than opening on a merchant form.
 */
export function Landing() {
  const [examplePassportId, setExamplePassportId] = useState<string | null>(null)
  // Read once at first render: this is device-local storage, not an external system to sync with.
  const [workspaceProduct, setWorkspaceProduct] = useState<string | null>(
    () => loadMerchantWorkspace()?.productName ?? null,
  )

  useEffect(() => {
    let active = true
    getFeaturedExample()
      .then((id) => { if (active) setExamplePassportId(id) })
      .catch(() => { if (active) setExamplePassportId(null) })
    return () => { active = false }
  }, [])

  function forgetWorkspace() {
    clearMerchantWorkspace()
    setWorkspaceProduct(null)
  }

  return (
    <>
      <section className="hero" id="top">
        <p className="eyebrow">Post-purchase proof for NIM</p>
        <h1>The payment is your receipt. The merchant&apos;s signature is your policy.</h1>
        <p className="hero-copy">
          Crypto proves that you paid. It does not prove what the merchant promised when you paid.
          NimReturn keeps the signed return and warranty terms attached to your payment, and verifies
          every claim, decision and refund on Nimiq.
        </p>
      </section>

      <section className="landing-paths" aria-label="Choose how to start">
        {examplePassportId && (
          <a className="landing-card landing-card--primary" href={`/?passport=${examplePassportId}`}>
            <span>Start here · no wallet needed</span>
            <strong>See a real protected purchase</strong>
            <small>
              A genuine Purchase Passport: signed promise → verified payment → claim → signed approval
              → refund verified on Nimiq.
            </small>
          </a>
        )}

        <a className="landing-card" href="/?sell=1">
          <span>For merchants</span>
          <strong>Protect your buyers</strong>
          <small>Sign your return and warranty terms with your Nimiq wallet. It takes about a minute and moves no funds.</small>
        </a>
      </section>

      {workspaceProduct && (
        <section className="landing-resume" aria-label="Your saved product">
          <p>
            <strong>You have a product on this device:</strong> {workspaceProduct}
          </p>
          <div className="landing-resume__actions">
            <a className="text-button" href="/?sell=1">Continue in the studio</a>
            <button className="text-button" type="button" onClick={forgetWorkspace}>
              Forget it on this device
            </button>
          </div>
          <small>Saved only in this browser. Nobody else sees it, and forgetting it here never deletes the signed policy.</small>
        </section>
      )}

      <section className="landing-how" aria-label="How NimReturn works">
        <h2>Three steps, all verifiable</h2>
        <ol>
          <li>
            <strong>The merchant signs the terms</strong>
            <span>Return and warranty windows, signed with their Nimiq wallet.</span>
          </li>
          <li>
            <strong>The buyer pays in NIM</strong>
            <span>Directly to the merchant. NimReturn never holds funds or keys.</span>
          </li>
          <li>
            <strong>A Purchase Passport is issued</strong>
            <span>The payment is locked to those exact terms, even if the merchant changes them later.</span>
          </li>
        </ol>
      </section>
    </>
  )
}
