# Project identity

NimReturn — “The consumer-protection layer for Nimiq Pay.” Tagline: “The payment is your receipt. The merchant's signature is your policy.” Built for Nimiq Mini Apps Competition Cycle II.

# Current product thesis

A Purchase Passport joins merchant-signed policy-at-purchase, independently verified direct NIM purchase/refund transactions, and wallet-signed claim/resolution history. It verifies promises and behavior; it does not enforce refunds, escrow, arbitrate, reverse transactions, or prove physical facts.

# Non-negotiable decisions

No custody/private keys/fake chain success. Integer Luna only. Exact canonical signature + public-key/address binding. Backend independently verifies every payment/refund. Historical policies immutable. Critical actions idempotent. Promise Ledger derived only. RETURN/WARRANTY and full-price single refund are NR1 MVP; AI/NFT/multi-chain/escrow/replacement/transfer are excluded now.

# Current architecture

One React/TypeScript/Vite frontend; one Node/Fastify/Zod API; PostgreSQL/Drizzle planned; Nimiq Pay SDK 0.1.0; official core 2.21.0; configurable server RPC/node adapter. NR1 uses domain-separated RFC 8785 JSON and 28-byte 128-bit-token transaction tags.

# Current phase

Phase 0 — Technical proof. Protocol signing transport remains candidate until actual Nimiq Pay fixture proves exact bytes.

# What is complete

Repository initialized; all required planning/security/protocol/design/testing/competition documents and MIT license created. React/Vite and Fastify scaffold is installed. Phase 0 diagnostics implement provider init, accounts, consensus/head, exact-message signing, official-core signature/address verification, guarded low-value transaction-with-data, fail-closed server RPC verification, and a local evidence export with exact UTF-8 bytes and public proofs. Verification now requires PoS `executionResult: true` plus the finalizing Albatross macro block; confirmation counts are non-authoritative. Protocol/RPC/signature unit suites exist.

# What has been manually verified

Official live docs/rules/scoring and npm package declarations/source were reviewed on 2026-09-14. Lint, typecheck, 27 unit tests, frontend/API production builds, API health/400/503 failure behavior, a 390×844 responsive layout, minimum 48px primary controls, no horizontal overflow, and no browser console warnings/errors were manually checked. The API reached the currently listed public development endpoint at `rpc.testnet.nimiqwatch.com`, observed `TestAlbatross`, and returned a live head over both loopback and LAN. No actual Nimiq Pay device signature/payment, tagged transaction round-trip, deployment, or database has been verified.

# Known bugs/blockers

Physical Nimiq Pay iOS/Android access and a funded TestAlbatross wallet are external. The public development RPC is operational but has no SLA and is not a production-grade independent verifier. Database/deployment credentials and pilot merchant/users are not configured; the public GitHub repository is configured.

# Important implementation details

SDK methods can return `{error}` values despite docs emphasizing thrown errors; normalize both. `sign()` accepts string or `{message,isHex}` and returns hex public key/signature. Never try multiple signing prefixes. Purchase tag `NR1:P:<22>`; refund tag `NR1:R:<22>`; 64-byte Nimiq limit. Server API is authoritative for state, but not chain truth.

# Next 5 highest-priority actions

1. Open diagnostics inside current Nimiq Pay and capture exact sign interoperability fixture.
2. Send/retrieve one low-value transaction with exact data through the configured development RPC and record result shape/finality.
3. Repeat provider/sign/payment cancellation and WebView resume checks on target iOS/Android.
4. Resolve any host/RPC shape differences and freeze NR1 writer behavior with a decision/test fixture.
5. Begin Phase 1 PostgreSQL migrations and immutable merchant policy flow only after Phase 0 exits.

# Competition deadline/status

Cycle II submission cutoff: September 18, 2026 at 23:59 UTC; current date September 14. Not a code freeze, but submitted app must be judgeable. No submission/deployment/pilot exists yet.

# Do not accidentally change

Do not broaden scope, trust client success, mutate signed policies, accept approximate values, conflate eligible/approved/refunded, or claim device/network proof from unit tests.
