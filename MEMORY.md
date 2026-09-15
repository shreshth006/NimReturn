# Project identity

NimReturn — “The consumer-protection layer for Nimiq Pay.” Tagline: “The payment is your receipt. The merchant's signature is your policy.” Built for Nimiq Mini Apps Competition Cycle II.

# Product thesis and boundaries

A Purchase Passport will join merchant-signed policy-at-purchase, independently verified direct NIM purchase/refund transactions, and wallet-signed claim/resolution history. NimReturn verifies promises and behavior; it does not enforce refunds, escrow, arbitrate, reverse transactions, or prove physical facts. No custody, private keys, fake chain success, fractional/unsafe Luna, mutable verified policy, or client-certified transaction is permitted.

# Current phase

Phase 1 implementation is complete under D-020 but remains at 92%; Phase 0 remains 98%. Under D-022, T-001, T-002, T-020, physical signing/publication, and physical v1→v2 validation are explicitly open/pending until the project lead personally performs each test and reports its result. D-023 authorized Phase 2, whose implementation is now code-complete at 90% and waiting at the consolidated physical-device boundary. D-018 still blocks claim writes until a reviewed claimant-authorization protocol exists.

# What is complete

Phase 0 diagnostics cover provider/account/network state, exact framed message verification, public-key/address derivation, guarded transaction-with-data, independent RPC verification, reload-safe uncertainty, and sanitized private evidence. The prior Android artifact proves exact framed signing plus one real 1000-Luna TestAlbatross transaction with matching chain-derived sender/recipient/value/data, `executionResult=true`, and macro finality.

Phase 1 includes canonical NR1 policy schemas; PostgreSQL migrations and restricted runtime role; 256-bit hashed first-policy bootstrap; immutable merchant/product/policy identity; exact challenge/proof binding; atomic first-signer establishment and publication; verified-only activation; bounded expiry; append-only events; injectable Fastify API; protected writer authorization and rate limits; fail-closed public reprojection of active and historical proofs; validated frontend API/workspace recovery; and the responsive merchant studio. The UI makes protocol, active version, signer, settlement address, terms, policy/server timestamps, BLAKE2b payload hash, public key, exact signed message, and immutable v1/v2 history judge-visible.

Phase 2 includes immutable server-issued orders bound to one exact active verified policy; strict wallet-state transitions; documented sender-free Nimiq payment calls; reload-safe public order/hash storage; global transaction replay protection; independent network/sender/recipient/integer-Luna/data/execution/Albatross-finality verification; one atomic immutable Passport; fail-closed public policy/chain reprojection; and append-only reconciliation whose latest regression becomes a visible verification exception. The buyer UI shows the direct no-custody path and the full purchase/policy proof in one public Passport.

# Verification status

Local lint, typecheck, all tests, and production builds pass. GitHub Actions run `34949910838` passed Phase 2 boundary commit `036671c`, and every focused Phase 2 checkpoint is green. The configured suite has 121 hermetic plus 23 PostgreSQL tests (144 total with `TEST_DATABASE_URL`). Production dependency audit is clean. Existing browser verification covers Phase 1 only; no Phase 2 device, layout, accessibility, or first-minute result is inferred from the build or automated suite.

# Important implementation details

`sign()` accepts the exact NR1 string and no signer argument. Nimiq signing verifies `\x16Nimiq Signed Message:\n` + decimal UTF-8 byte length + raw bytes, SHA-256, then Ed25519; NR1 separately stores BLAKE2b-256 of the unframed canonical message. The actual signer is derived from the public key and must be wallet-listed in the merchant UI. The signed `settlementAddress` may differ. First valid proof establishes the immutable policy signer. Later challenge allocation requires the protected merchant session, but later publication still requires that signer. Verified versions never update/delete; public reads re-verify every returned proof.

The browser stores only public merchant workspace/challenge facts and, for a purchase, public product/order IDs plus an optional returned transaction hash. First bootstrap and established session values stay in `HttpOnly` cookies. Production startup requires database URL, exact browser origin, and a server-only session secret. `sendBasicTransactionWithData()` has no sender argument; the purchase writer derives the buyer only from independently verified chain evidence and requires `executionResult=true` plus following-macro finality.

# Known blockers

Physical Android Nimiq Pay must still prove T-001, T-002, T-020, the current merchant signing/publication journey, and physical v1→v2 preservation. iOS is explicitly deferred by D-016, not claimed compatible. Deployment/database secrets, HTTPS, and operated primary/failover RPC are absent. The public development RPC is not production-grade. Phase 3 cannot assume claim signer equals purchase sender.

# Next actions

1. Have the project lead run `docs/evidence/consolidated-device-validation.md` and report each result explicitly.
2. Record only those explicit results in sanitized evidence; keep wallet/proof/transaction identifiers outside Git.
3. Do not mark any open device case passed or begin Phase 3 before the required Phase 0/1/2 exits are satisfied.
