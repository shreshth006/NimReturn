# Project identity

NimReturn — “The consumer-protection layer for Nimiq Pay.” Tagline: “The payment is your receipt. The merchant's signature is your policy.” Built for Nimiq Mini Apps Competition Cycle II.

# Product thesis and boundaries

A Purchase Passport will join merchant-signed policy-at-purchase, independently verified direct NIM purchase/refund transactions, and wallet-signed claim/resolution history. NimReturn verifies promises and behavior; it does not enforce refunds, escrow, arbitrate, reverse transactions, or prove physical facts. No custody, private keys, fake chain success, fractional/unsafe Luna, mutable verified policy, or client-certified transaction is permitted.

# Current phase

Phase 0 remains 98%, Phase 1 remains 92%, and Phase 2 remains 90% at their physical-device boundaries. D-025 closes D-018 with exact-claim purchase-sender authorization and authorizes Phase 3 implementation; Phase 3 is code-complete at 90%. Every physical wallet, purchase, Passport, claim, decision, reload, and mobile result remains open/pending until the project lead personally performs the test and explicitly reports it.

# What is complete

Phase 0 diagnostics cover provider/account/network state, exact framed message verification, public-key/address derivation, guarded transaction-with-data, independent RPC verification, reload-safe uncertainty, and sanitized private evidence. The prior Android artifact proves exact framed signing plus one real 1000-Luna TestAlbatross transaction with matching chain-derived sender/recipient/value/data, `executionResult=true`, and macro finality.

Phase 1 includes canonical NR1 policy schemas; PostgreSQL migrations and restricted runtime role; 256-bit hashed first-policy bootstrap; immutable merchant/product/policy identity; exact challenge/proof binding; atomic first-signer establishment and publication; verified-only activation; bounded expiry; append-only events; injectable Fastify API; protected writer authorization and rate limits; fail-closed public reprojection of active and historical proofs; validated frontend API/workspace recovery; and the responsive merchant studio. The UI makes protocol, active version, signer, settlement address, terms, policy/server timestamps, BLAKE2b payload hash, public key, exact signed message, and immutable v1/v2 history judge-visible.

Phase 2 includes immutable server-issued orders bound to one exact active verified policy; strict wallet-state transitions; documented sender-free Nimiq payment calls; reload-safe public order/hash storage; global transaction replay protection; independent network/sender/recipient/integer-Luna/data/execution/Albatross-finality verification; one atomic immutable Passport; fail-closed public policy/chain reprojection; and append-only reconciliation whose latest regression becomes a visible verification exception. The buyer UI shows the direct no-custody path and the full purchase/policy proof in one public Passport.

Phase 3 includes canonical claim and exact-claim authorization messages; proof-derived self/delegated claimant authority; immutable challenge/proof/evaluation evidence; inclusive purchase-bound RETURN/WARRANTY eligibility; a protected merchant queue; full-value approve or zero-value reject resolutions signed only by the historical policy signer; private pending drafts; verified-only public decisions; and buyer/merchant UI with public-only reload recovery. Approval is never displayed as paid.

# Verification status

Local lint, typecheck, all tests, and production builds pass. The configured suite has 149 hermetic plus 26 PostgreSQL tests (175 total with `TEST_DATABASE_URL`). The latest pre-Phase-3 GitHub Actions baseline is run `34950053523`; verify the final Phase 3 documentation commit before handoff. Production dependency audit is clean. No Phase 2/3 device, layout, accessibility, reload, or first-minute result is inferred from automated coverage.

# Important implementation details

`sign()` accepts the exact NR1 string and no signer argument. Nimiq signing verifies `\x16Nimiq Signed Message:\n` + decimal UTF-8 byte length + raw bytes, SHA-256, then Ed25519; NR1 separately stores BLAKE2b-256 of the unframed canonical message. The actual signer is derived from the public key and must be wallet-listed in the merchant UI. The signed `settlementAddress` may differ. First valid proof establishes the immutable policy signer. Later challenge allocation requires the protected merchant session, but later publication still requires that signer. Verified versions never update/delete; public reads re-verify every returned proof.

The browser stores only public merchant workspace/challenge facts and, for a purchase, public product/order IDs plus an optional returned transaction hash. First bootstrap and established session values stay in `HttpOnly` cookies. Production startup requires database URL, exact browser origin, and a server-only session secret. `sendBasicTransactionWithData()` has no sender argument; the purchase writer derives the buyer only from independently verified chain evidence and requires `executionResult=true` plus following-macro finality.

A claim signer is derived from its public key. Exact equality with the independently observed purchase sender self-authorizes; otherwise only a second `CLAIM_AUTHORIZATION` proof derived to the purchase sender can authorize that immutable claim/signer/hash tuple. Resolutions require the purchase-bound policy signer, not the settlement address. Unsigned resolution drafts are merchant-session-private; public reads return verified decisions only.

# Known blockers

Physical Android Nimiq Pay must still prove T-001, T-002, T-020, merchant signing/v1→v2, purchase/Passport, claim authorization, merchant resolution, reload, and mobile behavior. iOS is explicitly deferred by D-016, not claimed compatible. Deployment/database secrets, HTTPS, and operated primary/failover RPC are absent. The public development RPC is not production-grade.

# Next actions

1. Begin the narrowly scoped Phase 4 refund protocol and implementation without claiming earlier phase exit.
2. Keep `docs/evidence/consolidated-device-validation.md` aligned with every deferred physical flow.
3. Record only explicit project-lead results in sanitized evidence; keep wallet/proof/transaction identifiers outside Git.
