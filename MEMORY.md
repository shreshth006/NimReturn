# Project identity

NimReturn — “The consumer-protection layer for Nimiq Pay.” Tagline: “The payment is your receipt. The merchant's signature is your policy.” Built for Nimiq Mini Apps Competition Cycle II.

# Product thesis and boundaries

A Purchase Passport will join merchant-signed policy-at-purchase, independently verified direct NIM purchase/refund transactions, and wallet-signed claim/resolution history. NimReturn verifies promises and behavior; it does not enforce refunds, escrow, arbitrate, reverse transactions, or prove physical facts. No custody, private keys, fake chain success, fractional/unsafe Luna, mutable verified policy, or client-certified transaction is permitted.

# Current phase

Phase 0 remains 98%, Phase 1 remains 92%, and Phase 2 remains 90% at their physical-device boundaries. Phase 3 and Phase 4 are preserved at 90% experimental/code-complete. D-025's claimant authorization and D-028's exact-sender refund protocol are fail-closed, but their actual Nimiq Pay account-routing usability is unproven. D-029 supersedes D-027's incorrect attribution of prior blanket authority and explicitly authorized this Phase 4 implementation only. Every physical wallet, purchase, Passport, claim, decision, refund, reload, and mobile result remains open/pending until the project lead personally performs the test and explicitly reports it.

# What is complete

Phase 0 diagnostics cover provider/account/network state, exact framed message verification, public-key/address derivation, guarded transaction-with-data, independent RPC verification, reload-safe uncertainty, and sanitized private evidence. The prior Android artifact proves exact framed signing plus one real 1000-Luna TestAlbatross transaction with matching chain-derived sender/recipient/value/data, `executionResult=true`, and macro finality.

Phase 1 includes canonical NR1 policy schemas; PostgreSQL migrations and restricted runtime role; 256-bit hashed first-policy bootstrap; immutable merchant/product/policy identity; exact challenge/proof binding; atomic first-signer establishment and publication; verified-only activation; bounded expiry; append-only events; injectable Fastify API; protected writer authorization and rate limits; fail-closed public reprojection of active and historical proofs; validated frontend API/workspace recovery; and the responsive merchant studio. The UI makes protocol, active version, signer, settlement address, terms, policy/server timestamps, BLAKE2b payload hash, public key, exact signed message, and immutable v1/v2 history judge-visible.

Phase 2 includes immutable server-issued orders bound to one exact active verified policy; strict wallet-state transitions; documented sender-free Nimiq payment calls; reload-safe public order/hash storage; global transaction replay protection; independent network/sender/recipient/integer-Luna/data/execution/Albatross-finality verification; one atomic immutable Passport; fail-closed public policy/chain reprojection; and append-only reconciliation whose latest regression becomes a visible verification exception. The buyer UI shows the direct no-custody path and the full purchase/policy proof in one public Passport.

Phase 3 includes canonical claim and exact-claim authorization messages; proof-derived self/delegated claimant authority; immutable challenge/proof/evaluation evidence; inclusive purchase-bound RETURN/WARRANTY eligibility; a protected merchant queue; full-value approve or zero-value reject resolutions signed only by the historical policy signer; private pending drafts; verified-only public decisions; and buyer/merchant UI with public-only reload recovery. Approval is never displayed as paid.

Phase 4 includes immutable server-derived refund attempts bound to the approved claim, purchase-bound settlement sender, original buyer, full value, network, and compact refund tag; protected wallet-state/hash attachment; independent exact-field/execution/Albatross-finality verification; global hash uniqueness; one atomic Passport-refunded transition; append-only reconciliation; and merchant/buyer UI for cancellation, unknown outcomes, recovered hashes, pending finality, failure, and verified evidence. The API cannot select or certify the wallet sender.

# Verification status

Local lint, typecheck, all tests, and production builds pass. The configured suite has 159 hermetic plus 26 PostgreSQL tests (185 total with `TEST_DATABASE_URL`). GitHub Actions run `34981815713` passed the complete Phase 4 implementation baseline `804bd57`; the documentation closeout commit still requires its own CI verification. The production dependency audit is clean; `npm ci` reports four moderate development-tree advisories and no forced upgrade should be applied. No Phase 2/3/4 device, layout, accessibility, reload, signer-routing, or first-minute result is inferred from automated coverage.

# Important implementation details

`sign()` accepts the exact NR1 string and no signer argument. Nimiq signing verifies `\x16Nimiq Signed Message:\n` + decimal UTF-8 byte length + raw bytes, SHA-256, then Ed25519; NR1 separately stores BLAKE2b-256 of the unframed canonical message. The actual signer is derived from the public key and must be wallet-listed in the merchant UI. The signed `settlementAddress` may differ. First valid proof establishes the immutable policy signer. Later challenge allocation requires the protected merchant session, but later publication still requires that signer. Verified versions never update/delete; public reads re-verify every returned proof.

The browser stores only public merchant workspace/challenge facts and, for a purchase, public product/order IDs plus an optional returned transaction hash. First bootstrap and established session values stay in `HttpOnly` cookies. Production startup requires database URL, exact browser origin, and a server-only session secret. `sendBasicTransactionWithData()` has no sender argument; the purchase writer derives the buyer only from independently verified chain evidence and requires `executionResult=true` plus following-macro finality.

A claim signer is derived from its public key. Exact equality with the independently observed purchase sender self-authorizes; otherwise only a second `CLAIM_AUTHORIZATION` proof derived to the purchase sender can authorize that immutable claim/signer/hash tuple. Resolutions require the purchase-bound policy signer, not the settlement address. Unsigned resolution drafts are merchant-session-private; public reads return verified decisions only.

# Known blockers

Physical Android Nimiq Pay must still prove T-001, T-002, T-020, merchant signing/v1→v2, purchase/Passport, claim authorization, merchant resolution, an exact-sender refund through finality, reload, and mobile behavior. iOS is explicitly deferred by D-016, not claimed compatible. Deployment/database secrets, HTTPS, and operated primary/failover RPC are absent. The public development RPC is not production-grade.

# Next actions

1. Run the consolidated physical Nimiq Pay checklist when the project lead is available; report an inability to route the purchase-bound settlement account as FAIL rather than weakening sender verification.
2. Record only explicit project-lead results in sanitized evidence; keep wallet/proof/transaction identifiers outside Git.
3. Do not start Phase 5 without a new explicit instruction.
