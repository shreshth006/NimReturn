# Product requirements document

## Product definition

NimReturn is the consumer-protection layer for Nimiq Pay. It records a merchant's signed commercial policy beside independently verified purchase, claim, resolution, and refund evidence. The user-facing artifact is a wallet-linked **Purchase Passport**.

The product solves an evidence problem, not the irreversibility of cryptocurrency. It can prove what was promised, who paid, when an objective deadline applies, what the merchant decided, and whether money moved back. It cannot force physical or legal outcomes.

## Problem statement

Direct crypto payments are easy to verify in isolation but usually lose the surrounding purchase context. Buyers need durable evidence of return and warranty terms; honest merchants need a low-friction way to make those promises credible and demonstrate fulfillment. Existing accounting and wallet products explain where money moved but not the signed policy and post-purchase lifecycle.

## Target users and jobs to be done

### Merchant persona

A small merchant, service provider, event seller, or campus store already willing to accept NIM. They want to:

- publish simple, credible commercial terms without operating a key-management system;
- receive direct payment without an escrow fee or custody risk;
- identify authentic claims from the original buyer wallet;
- approve, reject, and refund with an auditable history;
- demonstrate factual fulfillment behavior to future customers.

### Buyer persona

A Nimiq Pay user making a small real-world purchase. They want to:

- understand the price and policy before approving payment;
- retain evidence even if the merchant changes future terms;
- prove which wallet paid without creating another account;
- see whether a return or warranty claim is within the signed policy;
- follow a clear status without blockchain expertise;
- verify a refund rather than trust a status label.

## Core concepts

### Policy Lock

An immutable, versioned, canonical policy payload signed by the merchant wallet. A changed policy creates a new version and never alters existing passports.

### Verified Purchase

A pending server order becomes purchased only after independent chain verification of the direct buyer-to-merchant NIM transaction.

### Purchase Passport

The durable view joining merchant, product snapshot, signed policy version, original buyer wallet, purchase transaction, deadlines, claims, decisions, and refunds.

### Claim Protocol

The original purchasing wallet signs a versioned RETURN or WARRANTY claim. NimReturn validates signer and replay resistance and evaluates objective policy eligibility at a recorded evaluation time.

### Merchant Resolution

The merchant wallet signs APPROVED or REJECTED plus a reason. Approval can create an expected refund; approval is not the same as a verified payment.

### Promise Ledger

Public factual aggregates derived from verified events. It contains no user-entered rating and no opaque score.

## End-to-end flows

### Merchant setup and policy

1. Merchant opens NimReturn inside Nimiq Pay and grants account access.
2. Merchant selects one returned Nimiq address.
3. Merchant creates a product/service with name and exact price in Luna (UI may accept a precisely parsed decimal NIM string).
4. Merchant defines non-negative return/warranty windows and transferability metadata.
5. Server allocates IDs, nonce, version, and timestamp, then returns the exact canonical policy message.
6. Merchant reviews readable terms and approves native signing.
7. Server verifies message equality, signature, public key, address binding, nonce, and uniqueness before marking the version signed.
8. Product page exposes only a verified active policy version.

### Purchase

1. Buyer opens product and sees merchant, integer-derived NIM price, return/warranty terms, and no guarantee language.
2. Buyer grants wallet account access.
3. Server creates a pending order bound to product, policy version, merchant, buyer, price, network, and an expiring nonce.
4. Client requests `sendBasicTransactionWithData()` directly to the merchant with the server-issued compact tag.
5. Cancellation returns to an actionable cancelled state; no passport is created.
6. A returned hash moves the order to verifying and is sent to the server.
7. Server independently queries chain/mempool evidence and checks every expected field and hash uniqueness.
8. Pending/inconclusive transactions remain retryable. Invalid evidence becomes failed with a non-sensitive reason.
9. Included/confirmed valid evidence atomically creates one passport and one protocol event.

### Claim

1. Original buyer opens a purchased passport and chooses RETURN or WARRANTY.
2. UI shows the relevant deadline and whether it appears open, without declaring final eligibility before verification.
3. Server creates claim ID and nonce, and returns the canonical payload.
4. Buyer signs it in Nimiq Pay.
5. Server checks payload, signature, address binding, signer equals original buyer, order/passport state, nonce, uniqueness, and eligibility.
6. Eligibility is stored as a reproducible result with rule outputs and evaluation time.
7. Merchant queue receives the claim; reloads do not duplicate it.

### Resolution and refund

1. Merchant sees claim facts and computed eligibility.
2. Merchant selects APPROVE or REJECT and a reason; server provides a canonical resolution payload.
3. Merchant signs. Server verifies merchant binding and ensures the claim has no prior final resolution.
4. Approval records an expected refund amount but remains distinct from payment.
5. Merchant initiates a direct NIM transaction to the original buyer using a compact refund tag.
6. Server independently verifies transaction sender, recipient, exact Luna value, data, network, state, and unique hash.
7. Only valid included/confirmed evidence changes the lifecycle to refunded.

## Functional requirements

Requirement IDs are stable. Tests should refer to them where useful.

### Identity and policy

- **FR-001:** The app shall initialize the injected Nimiq provider with a visible unavailable/timeout state.
- **FR-002:** Account access rejection shall be shown as a normal cancelled outcome and shall not create identity state.
- **FR-003:** A merchant shall create a product/service with a non-empty bounded name, exact positive Luna price, and signed policy.
- **FR-004:** The server shall assign monotonic policy versions per product and reject client-selected versions.
- **FR-005:** The server shall store exact canonical message, hash, public key, signature, merchant address, and verification result.
- **FR-006:** A policy version shall be immutable after signing; a database update attempting to change signed content shall fail.
- **FR-007:** Verification shall reject an altered message, invalid signature, malformed public key, or public key not deriving to the claimed merchant address.
- **FR-008:** An unsigned or invalid policy shall never be offered as purchasable.

### Purchase and passport

- **FR-010:** The server shall create one pending order with unpredictable ID/nonce, bound expected values, and expiration.
- **FR-011:** The client shall request a direct NIM transaction to the bound merchant using exact integer Luna and versioned data.
- **FR-012:** Wallet cancellation, pending, verifying, inconclusive, invalid, and verified shall remain visually distinct.
- **FR-013:** A returned transaction hash shall be treated as untrusted input.
- **FR-014:** The server shall independently validate network, existence/state, sender, recipient, value, data, order ID, and global hash uniqueness.
- **FR-015:** Repeating submission of the same hash for the same order shall be idempotent; another order using it shall fail.
- **FR-016:** Reloading a verifying order shall resume status instead of initiating a second payment.
- **FR-017:** Exactly one passport shall be created for a verified order.
- **FR-018:** A passport shall show the product snapshot, exact policy, signatures, chain evidence, deadlines, and lifecycle in plain language.

### Claims, resolutions, refunds

- **FR-020:** Only RETURN and WARRANTY are accepted MVP claim types.
- **FR-021:** Claim reason shall be a bounded code; note is optional, normalized, and length-limited.
- **FR-022:** A claim shall include a server-issued unique nonce and be signed by the original buyer address.
- **FR-023:** Claim verification shall reject wrong signer, altered payload, replayed nonce, duplicate active claim when prohibited, or invalid order.
- **FR-024:** Eligibility shall be deterministic from verified purchase time, signed window, claim timestamp/evaluation policy, and claim type.
- **FR-025:** Boundary behavior is inclusive: a claim at its exact deadline is eligible; one millisecond later is not.
- **FR-026:** The UI shall label the result “policy eligible” or “policy ineligible” and explain it is not a guaranteed remedy.
- **FR-027:** A merchant resolution shall require a valid merchant-bound signature and shall be final for MVP.
- **FR-028:** Repeated resolution requests shall be idempotent; conflicting second decisions shall fail.
- **FR-029:** Refund approval and refund payment shall be separate states.
- **FR-030:** A refund shall be verified independently for network, state, merchant sender, original buyer recipient, exact amount, correct tag, and unique hash.
- **FR-031:** A rejected or unresolved claim shall remain historically visible.

### Promise Ledger and instrumentation

- **FR-040:** Ledger metrics shall be computed from immutable verified records, not accepted as writeable API inputs.
- **FR-041:** Metrics shall distinguish eligible/ineligible, approved/rejected, paid/pending, and unresolved claims.
- **FR-042:** Median resolution time shall be measured from accepted claim creation to signed decision, with definition visible.
- **FR-043:** Verified purchase count shall count unique purchased orders; refund count shall count verified refund transactions.
- **FR-044:** Pilot instrumentation shall count genuine unique wallet opens and verified commerce events without names, emails, or cross-app tracking.
- **FR-045:** Device identifier use, if adopted, shall require explicit purpose/consent and shall not replace wallet identity. It is not MVP until privacy review.

## State transitions

### Order payment state

`payment_requested → payment_cancelled | payment_pending | payment_verifying | payment_failed`

`payment_pending → payment_verifying | payment_failed`

`payment_verifying → purchased | payment_pending | payment_failed`

`purchased` is terminal for the purchase transaction. Cancellation may allow a new wallet request for the same unexpired order only if no hash has been attached; the server remains idempotent.

### Claim state

`draft → signature_requested → submitted → eligible | ineligible → decision_pending → approved | rejected`

Eligibility describes a result attached to a submitted claim, not merchant approval. `approved → refund_pending → refunded | refund_verification_failed`; failures are retryable with a new transaction, while used hashes remain unique.

## Eligibility rules

- Purchasing wallet matches the verified order sender.
- Policy signature/version remains valid.
- Purchase is verified and not refunded for an equivalent completed claim.
- Claim type maps to a policy window greater than zero.
- Effective claim time is not before purchase and is at or before `purchase_time + window`.
- Server time is authoritative for claim acceptance; chain block timestamp anchors purchase time. Clock semantics must be tested and documented.
- Physical condition, delivery, use, and legal rights are explicitly not inferred.

## Edge cases

- Provider missing or injected after app load; init timeout and retry.
- Multiple wallet accounts; explicit selected address and revalidation on each signed action.
- Wallet returns an SDK `ErrorResponse` as a value instead of throwing; normalize both paths.
- Browser insecure context lacks `crypto.randomUUID`; IDs are server-generated, with no client security dependence.
- User double taps or reloads during approval.
- Transaction exists only in mempool, is later evicted, included, or unavailable due to RPC outage.
- Same amount and merchant across concurrent orders; compact tag disambiguates them.
- Unicode/lookalike policy text; canonical protocol restricts/normalizes fields and signs exact UTF-8 JSON.
- Daylight-saving/timezone display; protocol stores UTC milliseconds and windows as durations.
- Policy changes while product is open; order creation binds the current version and checkout displays it again.
- Claim at exact expiry; inclusive comparison is covered by tests.
- Merchant changes wallet; historical versions remain bound to the original address and refunds must use that policy merchant unless an explicit future migration protocol exists.
- Partial refund, over-refund, or multiple refunds; not accepted as completion in MVP.
- API/RPC outage; return inconclusive, retry with backoff, never downgrade verification.

## Non-functional requirements

- **NFR-001 Reliability:** Critical writes are transactional, idempotent, and constrained at the database level.
- **NFR-002 Performance:** First contentful product/passport view target under 2.5 seconds on a mid-range mobile connection; local input feedback under 100 ms.
- **NFR-003 Accessibility:** WCAG 2.2 AA target; keyboard/focus support, 44px touch targets, semantic status announcements, contrast, reduced motion.
- **NFR-004 Security:** Follow `SECURITY.md`; no secrets or keys in client/logs/repository.
- **NFR-005 Privacy:** Wallet address is the identity; no mandatory PII. Retention and public visibility are disclosed.
- **NFR-006 Compatibility:** Current Nimiq Pay iOS and Android WebViews are actual-device tested on TestAlbatross before mainnet pilot.
- **NFR-007 Observability:** Correlated structured events for state transitions, verifier latency/errors, and invariant violations without secret leakage.
- **NFR-008 Recovery:** A user can reload any pending workflow and see/resume its authoritative state.
- **NFR-009 Integrity:** Derived ledger results are reproducible from source events and periodic reconciliation reports mismatches.

## Success metrics

### Product

- 95%+ of valid testnet purchase flows complete without assistance after wallet approval.
- Zero passports from deliberately invalid transaction fixtures.
- 100% of test tampering and replay scenarios rejected.
- First-time test users explain the promise accurately and reach purchase intent within 60 seconds.
- Median product page interactive time under 2.5 seconds on target mobile hardware.

### Competition and pilot

- Target score: 92+/100, without claiming a guaranteed result.
- 25–35 genuine unique Nimiq wallets in the measurement period.
- At least 25 genuine low-value verified purchases with one merchant-like pilot.
- Several authentic signed claims, multiple approved and verified refunds, and at least one defensible rejection if it naturally occurs.
- Skool post and one public social post with direct submission links.

## Submission-critical MVP

Merchant wallet connection; product/policy creation and signing; purchasable public product; buyer wallet/payment; independent transaction verification; passport/lifecycle; signed RETURN/WARRANTY claims; deterministic eligibility; merchant queue and signed decision; direct refund and independent verification; factual Promise Ledger; robust mobile/cancel/pending/error states; pilot-safe aggregate instrumentation.

## Stretch scope

Only after the MVP and real-device gates pass: transferable warranty, richer factual metrics, replacement workflow, QR/deep links, richer public verification, catalog expansion, policy templates, and shareable passports. Transfer design may reserve fields now; no transfer behavior is submission-critical.

## Explicit non-goals

Escrow, arbitration, chargebacks, transaction reversal, legal advice, product/delivery proof, product-quality guarantee, custody, key storage, AI, NFTs/tokens, multi-chain, smart contracts, marketplace, loyalty/referral/coupons, CRM, shipping, fiat/KYC, arbitrary reviews, and manually editable trust scores.

## Competition-specific acceptance

- Public MIT-licensed GitHub repository and working deployed Mini App.
- Nimiq Pay Mini Apps Framework used for core identity/signing/payment operations.
- Direct NIM lifecycle works on a real mobile device on first try.
- The full product is judgeable; no prototype-only or simulated success.
- Payment cancellation/failure/pending and trustworthy UX are visible.
- Main thesis is understood within 60 seconds.
- Real usage is genuine and not botted or gamed.
