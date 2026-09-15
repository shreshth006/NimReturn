# Project identity

NimReturn — “The consumer-protection layer for Nimiq Pay.” Tagline: “The payment is your receipt. The merchant's signature is your policy.” Built for Nimiq Mini Apps Competition Cycle II.

# Product thesis and boundaries

A Purchase Passport will join merchant-signed policy-at-purchase, independently verified direct NIM purchase/refund transactions, and wallet-signed claim/resolution history. NimReturn verifies promises and behavior; it does not enforce refunds, escrow, arbitrate, reverse transactions, or prove physical facts. No custody, private keys, fake chain success, fractional/unsafe Luna, mutable verified policy, or client-certified transaction is permitted.

# Current phase

Phase 0 and Phase 1 are formally complete under D-021. On 2026-09-15 the project lead reported physical-device PASS outcomes for T-001, T-002, T-020, Phase 1 v1 signing/publication, and the v2 immutable-version flow. The repository stores only a sanitized outcome attestation. Phase 2 Purchase Passport is now active. D-018 still blocks claim writes until a reviewed claimant-authorization protocol exists.

# What is complete

Phase 0 diagnostics cover provider/account/network state, exact framed message verification, public-key/address derivation, guarded transaction-with-data, independent RPC verification, reload-safe uncertainty, and sanitized private evidence. The prior Android artifact proves exact framed signing plus one real 1000-Luna TestAlbatross transaction with matching chain-derived sender/recipient/value/data, `executionResult=true`, and macro finality.

Phase 1 includes canonical NR1 policy schemas; PostgreSQL migrations and restricted runtime role; 256-bit hashed first-policy bootstrap; immutable merchant/product/policy identity; exact challenge/proof binding; atomic first-signer establishment and publication; verified-only activation; bounded expiry; append-only events; injectable Fastify API; protected writer authorization and rate limits; fail-closed public reprojection of active and historical proofs; validated frontend API/workspace recovery; and the responsive merchant studio. The UI makes protocol, active version, signer, settlement address, terms, policy/server timestamps, BLAKE2b payload hash, public key, exact signed message, and immutable v1/v2 history judge-visible.

# Verification status

Local lint, typecheck, all tests, and production builds pass. GitHub Actions run `34904483526` passed for the Phase 1 documentation head. The configured suite has 110 hermetic plus twenty PostgreSQL tests (130 total with `TEST_DATABASE_URL`). Production dependency audit is clean. Browser verification exercised real draft/challenge HTTP calls, truthful provider-unavailable behavior, fail-closed public reads, v1/v2 history, desktop layout, and a 375 CSS-pixel viewport without horizontal overflow or console errors. Deterministic proof and browser checks are not Nimiq Pay evidence.

# Important implementation details

`sign()` accepts the exact NR1 string and no signer argument. Nimiq signing verifies `\x16Nimiq Signed Message:\n` + decimal UTF-8 byte length + raw bytes, SHA-256, then Ed25519; NR1 separately stores BLAKE2b-256 of the unframed canonical message. The actual signer is derived from the public key and must be wallet-listed in the merchant UI. The signed `settlementAddress` may differ. First valid proof establishes the immutable policy signer. Later challenge allocation requires the protected merchant session, but later publication still requires that signer. Verified versions never update/delete; public reads re-verify every returned proof.

The browser stores only public workspace IDs and an unexpired public challenge for reload recovery. First bootstrap and established session values stay in `HttpOnly` cookies. Production startup requires database URL, exact browser origin, and a server-only session secret. `sendBasicTransactionWithData()` has no sender argument; Phase 2 must derive the buyer only from chain evidence and retain the existing execution/finality rules.

# Known blockers

iOS is explicitly deferred by D-016, not claimed compatible. Deployment/database secrets, HTTPS, and operated primary/failover RPC are absent. The public development RPC is not production-grade. Phase 2 must persist immutable order expectations and accept purchase success only from execution-valid, macro-final chain evidence. Phase 3 cannot assume claim signer equals purchase sender.

# Next actions

1. Add the Phase 2 order schema and immutable expected-payment lifecycle with database constraints and tests.
2. Expose strict order creation/hash-attachment/status APIs and reuse the existing independent execution/finality verifier.
3. Build the buyer payment/reload states and verified Purchase Passport projection without enabling claims or refunds.
