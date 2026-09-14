# Decision log

Append-only. Corrections supersede an earlier decision with a new ID; do not rewrite history except to fix a typo that does not change meaning.

## D-001 — 2026-09-14 — One TypeScript repository and small three-tier system

**Decision:** Use one repository/package containing a React/Vite frontend and one Fastify API backed by PostgreSQL. No microservices or queue in MVP.

**Context:** The product needs durable concurrency/uniqueness guarantees and one mobile Mini App, under a short competition timeline.

**Alternatives:** Next.js full stack; Cloudflare Worker/D1; separate monorepo services; frontend-only chain state.

**Rationale:** React/Vite is a direct WebView fit; Fastify is small and explicit; PostgreSQL supplies transactions/constraints required by the threat model. One package minimizes build/deploy coordination. Frontend-only storage cannot support merchant queues, durable passports, idempotency, or controlled derived metrics.

**Consequences:** A Node runtime and managed PostgreSQL are needed. API availability matters, so payment is not requested until an order is durable. Scaling is vertical/small replicas first.

## D-002 — 2026-09-14 — Official Nimiq SDK/core packages pinned

**Decision:** Start Phase 0 with `@nimiq/mini-app-sdk` 0.1.0 and `@nimiq/core` 2.21.0, exact versions locked by npm.

**Context:** Current official provider docs and published declarations were inspected on 2026-09-14. SDK unions may return typed error values as well as throw; wallet host behavior still needs device proof.

**Alternatives:** Direct `window.nimiq` ad-hoc types; Hub API; third-party Ed25519 implementation.

**Rationale:** Official types/primitives reduce integration and cryptographic ambiguity. The Mini App competition specifically requires Nimiq Pay integration; Hub behavior must not be assumed equivalent.

**Consequences:** Upgrades are protocol-impacting reviews. WASM/core affects bundle size and initialization, monitored in build. Device tests remain mandatory.

## D-003 — 2026-09-14 — Backend-independent transaction authority

**Decision:** Wallet-returned hashes are untrusted. The API reads transaction evidence through a configured Nimiq RPC/node adapter and a pure verifier; browser consensus/head is advisory.

**Context:** A compromised or buggy frontend can report success or substitute a hash. Public RPC servers have no SLA.

**Alternatives:** Trust wallet response; verify only in browser; use one hardcoded public RPC.

**Rationale:** Server-side verification supports durable, idempotent state and prevents client fabrication. Provider abstraction permits monitored primary/failover sources.

**Consequences:** `NIMIQ_RPC_URL` is server-only; missing/outage produces inconclusive state. Production requires a reliable endpoint and reconciliation.

## D-004 — 2026-09-14 — NR1 domain-separated RFC 8785 canonical messages

**Decision:** Policies, claims, and resolutions are RFC 8785 canonical JSON inside `NIMRETURN/1/<TYPE>\n...`, UTF-8 encoded, with BLAKE2b-256 evidence hashes.

**Context:** Signatures must bind exact deterministic content across client/server and prevent cross-action use.

**Alternatives:** `JSON.stringify` insertion order; URL encoding; bespoke binary format; sign only a hash.

**Rationale:** JCS is established and inspectable; domain/type prefix prevents signature confusion; signing readable content supports approval UX. BLAKE2b-256 is exposed by official core and is only an evidence handle.

**Consequences:** Text normalization/schema are strict. Exact Nimiq Pay preprocessing is a Phase 0 gate; protocol writer remains disabled until actual fixture passes.

## D-005 — 2026-09-14 — Compact 128-bit transaction tags

**Decision:** Purchase data is `NR1:P:<22-char-token>` and refund data is `NR1:R:<22-char-claim-token>`, using unpadded base64url of 16 secure random bytes.

**Context:** Nimiq transaction data permits up to 64 bytes and must uniquely correlate direct payments while leaving safety margin.

**Alternatives:** UUID with hyphens; database integer; full JSON; include both order and claim; hash prefix.

**Rationale:** 28 ASCII bytes, 128-bit entropy, easy exact parser, no guessable sequence. Refund claim resolves to its order/buyer.

**Consequences:** Server generates and uniqueness-checks tokens. IDs are opaque identifiers, not authorization secrets. Exact full-string matching required.

## D-006 — 2026-09-14 — Full-price single refund in NR1 MVP

**Decision:** An approved NR1 refund equals the original price and one verified refund completes a claim. Partial/multiple refunds and replacement fulfillment are stretch.

**Context:** Partial aggregation complicates correctness, UI, ledger definitions, and race/replay controls under submission pressure.

**Alternatives:** arbitrary merchant-entered amount; multiple partial transfers; replacement as MVP.

**Rationale:** Full exact value makes the judge story and verification unambiguous and reliable.

**Consequences:** Some real commerce scenarios are unsupported; copy must disclose limitation. Future support requires protocol/data/ledger changes.

## D-007 — 2026-09-14 — Promise Ledger is derived, never rated or manually edited

**Decision:** Publish only defined aggregates computed from verified normalized records, including sample/as-of context. No star rating or composite trust score.

**Context:** Merchant reputation can mislead and be manipulated. NimReturn's differentiator is objective behavior evidence.

**Alternatives:** five-star reviews; admin-set metrics; weighted trust score.

**Rationale:** Derived facts are defensible, reproducible, and aligned with the product's honesty thesis.

**Consequences:** Sparse merchants show insufficient data rather than a flattering default. Database/API permissions expose no metric write.

## D-008 — 2026-09-14 — Deployment vendor deferred, topology fixed

**Decision:** Require static HTTPS frontend, one Node API, managed PostgreSQL with PITR, secret manager, and reliable Nimiq verifier; select vendor in Phase 5 based on owner credentials, region, and current service limits.

**Context:** No deployment account, region, budget, or existing infrastructure was provided. Choosing a vendor now would create an unverified operational dependency.

**Alternatives:** lock Render/Railway/Fly/Vercel/Cloudflare now; deploy database locally.

**Rationale:** The security/reliability topology is material; brand of provider is not. Deferral avoids an assumption requiring user authority while preserving implementation portability.

**Consequences:** Deployment status remains not started and Phase 5 must make/record the vendor decision early enough for pilot testing.

## D-009 — 2026-09-14 — Phase 0 payment diagnostics are guarded and never self-certifying

**Decision:** The diagnostic UI requires an explicit test-network/owned-recipient acknowledgement, uses a fresh 128-bit tag and positive integer Luna, labels a wallet-returned hash “sent · unverified,” and can mark it verified only through the server's configured RPC comparison. Missing/malformed RPC state fails closed.

**Context:** Phase 0 must exercise a real payment without creating an accidental production success path or encouraging a second payment during uncertainty.

**Alternatives:** Mock payment; default funded amount/recipient; trust the wallet hash; browser-only explorer link.

**Rationale:** A guarded real low-value test supplies the required interoperability evidence while preserving the core trust model and clear states.

**Consequences:** A human must configure the correct TestAlbatross wallet/recipient and server RPC. Local automated tests cannot close Phase 0. The diagnostic surface remains internal and must not be presented as a Purchase Passport.

## D-010 — 2026-09-14 — NR1 requires successful execution and Albatross macro finality

**Decision:** A transaction is verified only when its RPC `executionResult` is `true` and the observed chain head has reached the first macro block after its inclusion block. Ordinary `confirmations` are diagnostic evidence only and never establish NR1 finality.

**Context:** The initial Phase 0 normalizer treated any included transaction, or any positive confirmation count, as verified and did not inspect the PoS execution result. Nimiq PoS finalizes preceding micro blocks through Tendermint macro blocks at batch boundaries.

**Alternatives:** Accept inclusion immediately; require a fixed confirmation count; trust an RPC-provided state label; wait an arbitrary duration.

**Rationale:** `executionResult` prevents a failed state transition from becoming commerce evidence. The protocol-native macro boundary is deterministic and matches Albatross finality rather than approximating it with confirmations or wall-clock time.

**Consequences:** Normalized evidence records inclusion, finalizing macro, and observed head heights. Pre-macro transactions remain pending even with confirmations. Missing/malformed execution or finality fields fail closed. Phase 2 must add persistence and independent-source reconciliation without weakening this rule.

## D-011 — 2026-09-14 — Nimiq signed-message framing is the sole NR1 signature scheme

**Decision:** Verify Nimiq Pay `sign()` results only by UTF-8 encoding the exact NR1 message, prepending `\x16Nimiq Signed Message:\n` plus its base-10 UTF-8 byte length, hashing that frame with SHA-256, and verifying the Ed25519 signature over the digest. Continue to compute `payload_hash` separately as BLAKE2b-256 over the unframed NR1 message.

**Context:** The first physical Android/TestAlbatross diagnostic run returned a public key and signature whose derived address matched the selected wallet account, but raw-message verification failed. Nimiq's wallet and Keyguard implementations specify the framed SHA-256 convention.

**Alternatives:** Verify raw UTF-8; try framed then raw; replace the NR1 payload hash with the signing digest.

**Rationale:** One exact upstream-compatible transformation removes ambiguity. A fallback would expand the accepted signature language and hide integration mistakes; the NR1 BLAKE2b hash remains an integrity/index handle with a distinct role.

**Consequences:** The production adapter exposes both hashes with explicit labels. Regression tests cover wrong messages/keys/addresses, byte mutation, malformed values, Unicode byte length, raw-message rejection, and stable BLAKE2b output. The same device must be rerun to close T-017; no raw device key, signature, or address is committed.
