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

## D-012 — 2026-09-14 — Wallet account discovery is not signer or sender selection

**Decision:** Treat `listAccounts()` as the wallet's disclosed account set, not as proof that a client dropdown controls a later NIM action. Derive a message signer from the returned public key. Learn a payment sender from independently observed chain evidence. Keep any expected-account choice as separately labeled diagnostic metadata.

**Context:** The installed Mini App SDK 0.1.0 declarations, bundled provider calls, and official provider reference expose no signer parameter on `sign()` and no sender parameter on `sendBasicTransactionWithData()`. A physical Android/TestAlbatross run also observed a valid signer that differed from NimReturn's selected expectation.

**Alternatives:** Assume the first or selected listed account signs and pays; infer a fixed Nimiq Pay account-order rule; use an undocumented request property.

**Rationale:** Cryptographic derivation and chain evidence are authoritative and portable. A one-device account-choice pattern is not an API contract, and undocumented parameters would create fragile, misleading identity claims.

**Consequences:** Phase 0 reports expected signer, actual signer, wallet-list membership, and expectation match independently. Transaction requests contain no invented sender. Future Purchase Passports derive original purchaser identity from the verified transaction sender.

## D-013 — 2026-09-14 — Preserve irreversible diagnostic submissions in session storage

**Decision:** Immediately after a valid wallet transaction hash is returned, persist its public verification context in strictly validated session storage and lock another diagnostic payment until the record is explicitly cleared. If the native request might have completed but no hash is available, persist an outcome-unknown record and require wallet/chain inspection before a confirmed clear.

**Context:** Physical-device testing showed that a page reload could erase the only client copy of a real submitted hash, and an ambiguous post-approval error could tempt a blind second payment.

**Alternatives:** React state only; indefinite local storage; automatic retry; silently clear on reload or token regeneration.

**Rationale:** Session-scoped recovery survives ordinary reloads without creating a long-lived device history. Conservative locking treats uncertainty as a duplicate-payment risk. The stored fields are public transaction expectations and wallet-disclosed addresses, never signing secrets.

**Consequences:** Reload restores Step 6 and visibly warns against resubmission. Unresolved and outcome-unknown records require explicit confirmation before clearing. Closing the browser session may remove the record, so the product phases still require server-side durable correlation before a real purchase request.

## D-014 — 2026-09-14 — Phase 0 evidence v2 separates expectations from authority

**Decision:** Version the diagnostic export as `nimreturn.phase0.evidence.v2` and record provider availability, wallet-disclosed accounts, expected versus derived signer facts, sender-free transaction expectations, and independently observed sender/execution/finality facts in separate objects.

**Context:** The v1 export nested selected account with wallet/network data and retained a raw RPC result, which made it too easy to read a UI expectation as signer or payment-sender authority.

**Alternatives:** Keep v1 field names; record the selected account as sender; export only the raw RPC response; omit mismatch diagnostics.

**Rationale:** Explicit provenance makes the evidence reviewable without trusting UI state or reinterpreting an opaque server blob. The schema directly mirrors the cryptographic and chain trust boundaries proven in Phase 0.

**Consequences:** Existing diagnostic v1 exports are not upgraded in place. V2 never contains an expected sender and remains a local public-proof artifact, not production persistence or authorization.

## D-015 — 2026-09-14 — Keep authoritative device evidence private and checksum its public summary

**Decision:** Retain the authoritative Phase 0 device JSON and its checksum outside Git. Commit only a sanitized summary containing non-identifying environment/outcome facts and the raw file's SHA-256 digest, backed by narrow ignore rules and a pre-push tracked-secret audit.

**Context:** The v2 artifact necessarily contains full wallet addresses, a transaction relationship, public signing proof, a diagnostic nonce, and a detailed device user agent. Those values are useful for private engineering verification but unnecessary and privacy-invasive in a public repository.

**Alternatives:** Commit the raw proof; redact a second JSON copy; omit all public evidence; rely only on `.gitignore` without a tracked-content audit.

**Rationale:** A checksum binds the public claim to the preserved private artifact without publishing pseudonymous identifiers. A prose summary is less likely than partially redacted structured data to leak overlooked fields.

**Consequences:** The sanitized summary proves that Android T-017/T-035 were reviewed but cannot independently reproduce the private proof. Maintainers must preserve the external file/checksum and repeat the no-secret audit before evidence-related pushes. Phase 0's separate cancellation and iOS-or-exception exit criteria remain unchanged.

## D-016 — 2026-09-15 — Cycle II Phase 0 target-device validation is Android-only

**Decision:** For the Cycle II Phase 0 exit, the project lead accepts Android 16 with Nimiq Pay 2.19.1 as the sole physical target-device validation scope. iOS remains explicitly untested and is deferred until after the competition submission.

**Context:** Android has supplied checksum-bound physical evidence for provider/account discovery, consensus/head behavior, exact framed signing, direct transaction data, independent execution verification, and Albatross macro finality. Acquiring an iOS test device before the 2026-09-18 submission deadline would displace completion of the judge-visible core lifecycle.

**Alternatives:** Block Phase 0 and all product implementation until an iPhone is acquired; claim cross-platform equivalence from SDK types; remove iOS from longer-term compatibility requirements.

**Rationale:** The documented exception is narrower and more truthful than an untested compatibility claim. Deadline risk now outweighs the incremental Phase 0 value of a second host, while Android proof covers the current competition demonstration target.

**Consequences:** The Phase 0 Android/iOS-or-exception criterion is satisfied by exception, not by iOS evidence. Documentation and submission claims must say Android-validated rather than cross-platform validated. iOS testing remains required before a mainnet pilot and after the competition submission unless reprioritized by a later decision.

## D-017 — 2026-09-15 — Policy signing authority and settlement address are distinct

**Decision:** NR1 treats the merchant policy signer and the settlement address as separate roles. The server derives the policy signer from the proof public key. A new merchant's first valid policy proof atomically establishes its immutable MVP `policy_signer_address`; later merchant proofs must derive to that address. The canonical policy payload separately binds the `settlementAddress` used for purchase receipt and refund-source verification. The two addresses may be equal or different, and NimReturn never infers equality from `listAccounts()` order or a client selection.

**Context:** Mini App SDK 0.1.0 exposes no signer selector for `sign()` and no sender selector for `sendBasicTransactionWithData()`. Physical Phase 0 evidence also showed that a valid signer, an expected diagnostic account, and an observed transaction sender can differ. A single ambiguous merchant wallet address would therefore create an authority claim the wallet API cannot guarantee.

**Alternatives:** Require policy signer and settlement address to match; trust an account dropdown to select the signing/payment account; accept an unbound settlement recipient after policy signing; let every policy establish a new signer.

**Rationale:** Cryptographic derivation is authoritative for signatures, signed policy bytes are authoritative for the commercial recipient, and chain evidence is authoritative for transaction senders. Separating those facts matches the actual wallet contract while keeping first-policy bootstrap and subsequent merchant authorization deterministic.

**Consequences:** Phase 1 schema and APIs use explicit `policy_signer_address`, `settlement_address`, and derived `signer_address` names. The first proof establishes policy authority under a server-held, expiring bootstrap challenge; concurrent establishment is compare-and-set. A settlement change requires a new signed policy version. Wallet migration is deferred and cannot be improvised by changing a row. Purchases pay, and NR1 refunds originate from, the purchase-bound settlement address.

## D-018 — 2026-09-15 — Claim-signer authorization is a Phase 3 design gate

**Decision:** A verified purchase sender and a claim-message signer are distinct evidence until Phase 3 defines, threat-models, and tests an explicit authorization/binding protocol. The purchase buyer remains the independently observed chain sender; the claim signer is derived from the proof public key. NimReturn must not enable claim writes or require `claim_signer_address == purchase_sender_address` merely because the current wallet API lacks signer selection.

**Context:** The earlier draft said the original purchasing wallet signs and required signer equality. Phase 0 proved only that Nimiq Pay returns a valid signing key without a caller-selected signer. Direct equality could reject the legitimate payer or encourage the UI/server to treat a disclosed/selected account as cryptographic control.

**Alternatives:** Keep direct address equality; accept any claim signer; infer signer routing from one device; solve claim authorization during Phase 1.

**Rationale:** Both direct equality and unrestricted signing are unsafe without a defensible account-control relationship. Phase 3 is the first phase that needs this protocol and can evaluate recovery, multiple accounts, authorization replay, privacy, and device behavior together.

**Consequences:** Claim payload/schema text is explicitly candidate, stores purchase-sender and derived-signer facts separately, and has no enabled production write path before the Phase 3 gate closes. PRD, security controls, tests, and UI copy may describe the intended claim outcome but cannot claim original-buyer authorization until that protocol exists. This decision does not expand Phase 0 or start claim implementation.
