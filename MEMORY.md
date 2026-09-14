# Project identity

NimReturn — “The consumer-protection layer for Nimiq Pay.” Tagline: “The payment is your receipt. The merchant's signature is your policy.” Built for Nimiq Mini Apps Competition Cycle II.

# Current product thesis

A Purchase Passport joins merchant-signed policy-at-purchase, independently verified direct NIM purchase/refund transactions, and wallet-signed claim/resolution history. It verifies promises and behavior; it does not enforce refunds, escrow, arbitrate, reverse transactions, or prove physical facts.

# Non-negotiable decisions

No custody/private keys/fake chain success. Integer Luna only. Exact canonical signature + public-key/address binding. Policy signer is proof-derived; settlement address is separately signed and may differ. Backend independently verifies every payment/refund. Historical policies immutable. Critical actions idempotent. Promise Ledger derived only. RETURN/WARRANTY and full-price single refund are NR1 MVP; AI/NFT/multi-chain/escrow/replacement/transfer are excluded now.

# Current architecture

One React/TypeScript/Vite frontend; one Node/Fastify/Zod API; PostgreSQL/Drizzle with checked-in migrations and real-Postgres tests; Nimiq Pay SDK 0.1.0; official core 2.21.0; configurable server RPC/node adapter. NR1 uses domain-separated RFC 8785 JSON, the exact Nimiq signed-message frame/SHA-256 convention, a separate BLAKE2b-256 payload hash, and 28-byte 128-bit-token transaction tags.

# Current phase

Phase 1 backend foundations are 45% complete under D-019 while Phase 0 remains honestly recorded at 98%. A private checksum-bound Android/Nimiq Pay v2 artifact confirms framed signing plus successful execution, macro finality, and independent verification of a real 1000-Luna NR1 transaction. T-001/T-002 move into the Phase 1 device suite and T-020 into Phase 2; none is marked passed. D-017 separates policy signer from signed settlement address, and D-018 defers claimant authorization to a required Phase 3 design gate. Merchant screens and production NR1 writer activation remain blocked.

# What is complete

Repository initialized; all required planning/security/protocol/design/testing/competition documents and MIT license created. React/Vite and Fastify scaffold is installed. Phase 0 diagnostics implement provider init, account discovery, account-independent consensus/head, exact-message signing with cryptographically derived signer identity, guarded 1000-Luna transaction-with-data, chain-derived sender evidence, fail-closed/retryable server RPC verification, reload-safe session records, ambiguous-submission locking, and a truthful v2 local evidence export. Payment remains locked without fresh wallet consensus. Verification requires PoS `executionResult: true` plus the finalizing Albatross macro block; confirmation counts are non-authoritative. Phase 1 now has strict NR1 policy schemas, four PostgreSQL migrations, 256-bit hashed merchant bootstraps, immutable merchant/product/policy identity, one-bootstrap/one-challenge binding, canonical server challenge allocation, pure exact-proof verification, atomic first-signer establishment/publication, verified-only product activation, and append-only audit events. GitHub Actions runs the locked quality gate and real PostgreSQL integration suite on pushes to `main` and pull requests.

# What has been manually verified

Official Mini App SDK 0.1.0 declarations/bundle and current provider documentation confirm that `listAccounts()` returns disclosed addresses, `sign()` has no account selector, and `sendBasicTransactionWithData()` has no sender selector. Physical Android 16/Nimiq Pay 2.19.1 evidence proves provider availability, two accounts, consensus, exact framed signing/address binding, strict 1000-Luna NR1 data round trip, chain-derived wallet-listed sender, successful execution, macro finality, and final RPC `verified`. The actual signer differed from the expected diagnostic account and payment sender in this run; this is an observation, not a wallet-selection rule. The authoritative artifact remains private outside Git; its sanitized public summary contains only the checksum and non-identifying results. PostgreSQL 16 migrations and domain transactions are verified locally and in GitHub Actions; deployment is not verified.

# Known bugs/blockers

Actual-device T-001 provider timeout/recovery and T-002 account-permission cancellation/recovery remain due with Phase 1 device signing; T-020 native payment cancellation/safe retry remains due with Phase 2 purchase testing. iOS is explicitly untested and deferred by D-016, not claimed compatible. Wallet consensus can be transiently false despite a valid head and remains fail-closed. The public development RPC has no SLA and is not a production-grade independent verifier. Phase 3 must design claimant authorization without assuming the proof signer equals the purchase sender. Database/deployment credentials and pilot merchant/users are not configured.

# Important implementation details

SDK methods can return `{error}` values despite docs emphasizing thrown errors; normalize both. `listAccounts()` is discovery, not action selection. `sign()` receives the exact NR1 string with no signer argument; derive the actual signer from its returned public key. First valid policy proof establishes the merchant policy signer; `settlementAddress` is separately signed and may differ. `sendBasicTransactionWithData()` has no sender argument; derive the purchaser/refund sender from verified chain evidence. Signature verification uses `\x16Nimiq Signed Message:\n` + decimal UTF-8 byte length + raw bytes, SHA-256, then Ed25519, with no raw fallback. Purchase tag `NR1:P:<22>`; refund tag `NR1:R:<22>`; 64-byte Nimiq limit. Wallet consensus gates payment twice; server RPC remains authoritative.

# Next 5 highest-priority actions

1. Add least-privilege PostgreSQL runtime-role grants and prove direct historical evidence mutation remains denied.
2. Add the strict merchant/product draft bootstrap domain operation without exposing production writer routes.
3. Run Phase 1 native canonical policy signing together with deferred T-001/T-002 before Phase 1 exits.
4. Only after that device gate, add the reviewed HTTP authorization boundary; merchant screens remain explicitly out of the current batch.
5. Run deferred T-020 with the Phase 2 native purchase suite; do not mark it passed from the earlier successful transaction.

# Competition deadline/status

Cycle II submission cutoff: September 18, 2026 at 23:59 UTC; current date September 15. Not a code freeze, but submitted app must be judgeable. No submission/deployment/pilot exists yet.

# Do not accidentally change

Do not broaden scope, trust client success, mutate signed policies, accept approximate values, conflate eligible/approved/refunded, or claim device/network proof from unit tests.
