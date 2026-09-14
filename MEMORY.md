# Project identity

NimReturn — “The consumer-protection layer for Nimiq Pay.” Tagline: “The payment is your receipt. The merchant's signature is your policy.” Built for Nimiq Mini Apps Competition Cycle II.

# Current product thesis

A Purchase Passport joins merchant-signed policy-at-purchase, independently verified direct NIM purchase/refund transactions, and wallet-signed claim/resolution history. It verifies promises and behavior; it does not enforce refunds, escrow, arbitrate, reverse transactions, or prove physical facts.

# Non-negotiable decisions

No custody/private keys/fake chain success. Integer Luna only. Exact canonical signature + public-key/address binding. Backend independently verifies every payment/refund. Historical policies immutable. Critical actions idempotent. Promise Ledger derived only. RETURN/WARRANTY and full-price single refund are NR1 MVP; AI/NFT/multi-chain/escrow/replacement/transfer are excluded now.

# Current architecture

One React/TypeScript/Vite frontend; one Node/Fastify/Zod API; PostgreSQL/Drizzle planned; Nimiq Pay SDK 0.1.0; official core 2.21.0; configurable server RPC/node adapter. NR1 uses domain-separated RFC 8785 JSON, the exact Nimiq signed-message frame/SHA-256 convention, a separate BLAKE2b-256 payload hash, and 28-byte 128-bit-token transaction tags.

# Current phase

Phase 0 — Technical proof. Nimiq signed-message framing is specified and implemented, but the NR1 writer remains candidate until the same physical device re-verifies the patched adapter and completes the transaction proof.

# What is complete

Repository initialized; all required planning/security/protocol/design/testing/competition documents and MIT license created. React/Vite and Fastify scaffold is installed. Phase 0 diagnostics implement provider init, accounts, consensus/head, exact-message signing, official-core framed signature/address verification, guarded low-value transaction-with-data, fail-closed server RPC verification, and a local evidence export with exact UTF-8 bytes and public proofs. The payment control is locked unless the wallet reports consensus, and the send path rechecks and refuses to invoke the native transaction method on `consensus=false`. Verification requires PoS `executionResult: true` plus the finalizing Albatross macro block; confirmation counts are non-authoritative. Protocol/RPC/signature unit suites exist. GitHub Actions runs the locked quality gate on pushes to `main` and pull requests.

# What has been manually verified

Official live docs/rules/scoring, npm package declarations/source, and the official Nimiq wallet/Keyguard signed-message implementations were reviewed on 2026-09-14. Lint, typecheck, 36 unit tests, frontend/API production builds, API health/400/503 failure behavior, a 390×844 responsive layout, minimum 48px primary controls, no horizontal overflow, and no browser console warnings/errors were checked. The API reached the listed public development endpoint at `rpc.testnet.nimiqwatch.com`, observed `TestAlbatross`, and returned a live head over loopback and LAN. GitHub Actions run `34815743327` passed the framed-signature batch. The first physical Android/Nimiq Pay run proved provider injection, two returned accounts, a readable head, a returned public key/signature, and correct public-key/address derivation. Wallet consensus was false, so no payment was attempted. Raw-message signature verification failed as expected from the upstream framing convention; the patched framed verifier still needs a device retest. No raw device proof values are committed. No tagged transaction round-trip, deployment, or database has been verified.

# Known bugs/blockers

The current Nimiq Pay wallet reported `consensus=false` despite returning a head; payment must remain blocked until a retry returns true. The patched framed signature verifier needs a physical-device retest, followed by a funded low-value transaction. The public development RPC is operational but has no SLA and is not a production-grade independent verifier. Database/deployment credentials and pilot merchant/users are not configured; the public GitHub repository is configured.

# Important implementation details

SDK methods can return `{error}` values despite docs emphasizing thrown errors; normalize both. `sign()` receives the exact NR1 string, while verification uses `\x16Nimiq Signed Message:\n` + decimal UTF-8 byte length + raw bytes, SHA-256, then Ed25519. Never try a raw-message fallback. The signing SHA-256 digest is distinct from the BLAKE2b-256 NR1 payload hash. Purchase tag `NR1:P:<22>`; refund tag `NR1:R:<22>`; 64-byte Nimiq limit. Wallet consensus gates opening the payment request; server RPC remains authoritative for transaction evidence.

# Next 5 highest-priority actions

1. Rerun Step 4 on the same Nimiq Pay device and confirm framed signature plus address binding both verify.
2. Retry wallet network state until `consensus=true`; do not bypass the payment lock.
3. Send and independently retrieve one 1-Luna tagged TestAlbatross transaction, then wait for successful execution and macro finality.
4. Repeat cancellation and WebView background/resume checks, sanitize the evidence, and freeze the NR1 writer only after all proof agrees.
5. Begin Phase 1 PostgreSQL migrations and immutable merchant policy flow only after Phase 0 exits.

# Competition deadline/status

Cycle II submission cutoff: September 18, 2026 at 23:59 UTC; current date September 14. Not a code freeze, but submitted app must be judgeable. No submission/deployment/pilot exists yet.

# Do not accidentally change

Do not broaden scope, trust client success, mutate signed policies, accept approximate values, conflate eligible/approved/refunded, or claim device/network proof from unit tests.
