# Design specification

## Brand personality

NimReturn is calm consumer-protection software: credible, quiet, humane, and precise. It should feel closer to a premium receipt/warranty wallet than a trading dashboard. Confidence comes from legible evidence and careful language, not neon, urgency, or claims of technological inevitability.

## Visual principles

- **Evidence before ornament.** The policy, amount, deadlines, and lifecycle dominate.
- **One action at a time.** Each screen has one primary next step and a clear safe exit.
- **Status through words and shape.** Color supports but never carries meaning alone.
- **Progressive disclosure.** Human summary first; addresses, signatures, hashes, and canonical payloads expand on demand.
- **Mobile by construction.** Primary layout targets a 360–430px viewport and one-handed use.
- **Reserved success.** Green appears only for completed, verified facts—not wallet submission or merchant intent.

Initial palette direction: warm off-white canvas, near-black ink, desaturated navy for primary action/trust, restrained green for verified, amber for pending/inconclusive, red for invalid/failure, cool gray borders. Typography should use a readable system or locally bundled sans face; amounts and hashes use tabular/monospace numerals where helpful. This is direction, not a prematurely fixed design system.

## Information hierarchy

1. What was purchased and for how much.
2. Current lifecycle state and next action.
3. Return/warranty deadline and objective eligibility.
4. Merchant identity and policy-at-purchase summary.
5. Evidence details: address, signature, canonical payload, transaction hash/network/block.
6. Honest limitations and definitions.

## Navigation

MVP uses a shallow role-aware structure rather than a dashboard maze:

- **Home:** one-sentence thesis, “I’m buying” / “I’m selling,” recent passports when connected.
- **Products:** merchant's minimal list and create action.
- **Claims:** merchant claim queue or buyer passport claims based on context.
- **Passports:** buyer-linked purchases.
- **Merchant public page:** product entry points and Promise Ledger.

Bottom navigation is limited to three destinations for signed-in contexts. Public product/passport routes work directly from a link without first navigating a dashboard. Wallet address is shown shortened with copy/expand, never as a giant identity banner.

## Screen list

### Submission-critical

1. Welcome/role entry and provider status.
2. Internal Phase 0 diagnostics (development-only route/banner).
3. Merchant connect/account selection.
4. Product + policy editor and review-to-sign.
5. Policy signing/verification result.
6. Public product/checkout.
7. Payment states and recovery.
8. Purchase Passport.
9. Claim type/reason/review-to-sign.
10. Claim eligibility result.
11. Merchant claim queue and claim detail.
12. Resolution review-to-sign.
13. Refund request/status/recovery.
14. Merchant public Promise Ledger.

### Deferred

Transfer, replacement, catalog discovery, policy templates, arbitrary public profiles, rich analytics, and media upload.

## Key components

- **Trust header:** concise merchant name/address and “merchant-signed terms” state.
- **Money:** exact NIM display derived from integer Luna; never float-rounded.
- **Policy summary:** return/warranty durations and transfer policy with version.
- **Evidence drawer:** status, source, timestamp, shortened identifiers, copy actions, and exact payload.
- **Wallet request sheet:** explains what Nimiq Pay will ask and what it cannot authorize.
- **Status panel:** icon, plain headline, supporting fact, one recovery action.
- **Deadline chip:** “Returns through Sep 22” plus exact UTC in details.
- **Eligibility checklist:** each objective condition with pass/fail/unknown; no legal language.
- **Promise metric:** number, definition, sample size, and empty/insufficient-data behavior.

## Purchase Lifecycle component

The lifecycle is the visual center of the product. It is a vertical sequence on mobile and may become horizontal only when space preserves labels:

```text
5 NIM PAID                         VERIFIED
Merchant-signed policy locked     VERIFIED
Return requested                  RECORDED
Policy conditions                 ELIGIBLE
Merchant decision                 APPROVED
5 NIM refund                      VERIFIED
```

Each row has `complete`, `current`, `pending`, `failed`, or `not-started` visual state. Selecting a completed cryptographic/payment row opens its evidence. “Sent” never renders as “paid”; “approved” never renders as “refunded.” A skipped/rejected branch remains visible rather than rewriting history.

## Mobile layouts

- One-column content, 16px minimum gutters, bounded 640px reading width.
- Sticky primary action may sit above the safe-area inset; content retains clearance.
- Minimum 44×44px interactive targets; no hover-only disclosure.
- Native wallet dialog may background/resume the WebView, so returning screens re-fetch state and avoid duplicate requests.
- Long hashes/addresses wrap or truncate safely; no horizontal document overflow.
- Forms use suitable mobile input modes, but money parsing is string-based and validated as Luna.

## State language

- **Awaiting wallet:** “Open Nimiq Pay to review this request.”
- **User cancelled:** “Nothing was sent. You can try again.”
- **Transaction sent:** “Transaction submitted. Payment is not verified yet.”
- **Pending:** “Waiting for the Nimiq network.”
- **Verifying:** “Checking sender, amount, merchant, and order reference.”
- **Inconclusive/RPC unavailable:** “We could not verify this yet. Your transaction may still be valid.”
- **Invalid:** “This transaction does not match the order.” Include safe mismatch reason.
- **Verified:** “Payment verified on-chain.”
- **Eligible:** “This claim matches the merchant-signed policy.”
- **Ineligible:** “This claim does not match the signed policy condition shown below.”
- **Approved:** “Merchant approved. Refund has not been verified yet.”
- **Refunded:** “Refund verified on-chain.”

Cancellation is neutral, not red. Inconclusive is amber/neutral, never failure. Errors preserve entered non-sensitive form data and offer a specific retry/back route.

## Empty states

- No passports: explain that a passport appears after a verified NimReturn payment; link to real merchant product if available.
- No products: one-line merchant value and “Create first product.”
- No claims: “No claims need your decision.” Do not fabricate metrics.
- No ledger history: “Not enough verified activity yet,” with metric definitions and zero sample size.
- Provider unavailable: explain the Mini App must be opened inside Nimiq Pay; keep a documentation link for developers.

## Trust and verification indicators

Use “verified” only when verification completed against its stated source. Label sources explicitly: “Wallet signature verified,” “Verified on Nimiq,” or “Recorded by NimReturn.” A database record alone uses “recorded,” not “on-chain.” Proof detail always exposes network and verification time. Do not use lock icons as a substitute for an explanation.

## Accessibility

- WCAG 2.2 AA contrast; 200% text zoom without content loss.
- Semantic headings, labels, field errors, buttons, lists, and `aria-live` status announcements.
- Focus enters dialogs, stays trapped, and returns to trigger. Visible focus is never removed.
- Motion is subtle and disabled with `prefers-reduced-motion`; status never depends on animation.
- Screen-reader labels expand shortened addresses/hashes or provide a dedicated copy/full-value control.
- Time copy includes date and timezone in evidence; relative time is supplementary.

## Copy rules

Prefer “verified on-chain,” “merchant-signed terms,” “payment verified,” “policy at purchase,” “original purchasing wallet,” and “refund verified.” Avoid “trustless,” “guaranteed refund,” “chargeback,” “decentralized arbitration,” and “immutable consumer rights.” Never imply policy eligibility is legal entitlement or that rejection proves wrongdoing.

Buttons describe the wallet action: “Review and sign terms,” “Pay 5 NIM in Nimiq Pay,” “Sign return request,” “Review refund in Nimiq Pay.” Destructive/final decisions repeat consequences before native confirmation.

## First-minute judge journey

0–10s: product page states “Wireless Mouse — 5 NIM” and “Merchant-signed: 7-day returns, 90-day warranty.”

10–25s: native payment action makes Nimiq central; returned screen says submitted, then verified only after chain evidence.

25–35s: Passport shows policy version, deadlines, merchant identity, and verified payment in one view.

35–48s: buyer signs a RETURN; the objective checklist yields “POLICY ELIGIBLE” with honest disclaimer.

48–57s: merchant approves and pays original wallet; lifecycle distinguishes approval from verified refund.

57–60s: Promise Ledger summarizes factual verified behavior. The story should work without a blockchain explanation.
