# Implementation phases

## Operating rule

Phases are sequential security gates, not themes running in parallel. A later phase can be designed but not implemented while a critical prerequisite remains unproven unless the project lead accepts a narrow, recorded deferral with an explicit later test gate. D-022 keeps the device gates open/pending; D-023 explicitly permits Phase 2 implementation, D-025 permits Phase 3 implementation after closing its claimant-authorization design gate, D-029 explicitly permits Phase 4 after correcting D-027's false attribution of blanket authority, and D-030 records the project lead's explicit Phase 5 instruction. Physical checks remain batched for a later session. Percentages live in `STATUS.md`; this file defines scope and exits.

## Phase 0 — Technical proof

### Build

- minimal React/Vite mobile diagnostic surface and Fastify health/RPC diagnostic;
- initialize current `@nimiq/mini-app-sdk` and normalize thrown/returned errors;
- retrieve/select wallet accounts;
- sign exact NR1 candidate message;
- verify signature and public-key/address binding with official `@nimiq/core`;
- check provider consensus and block height;
- encode/decode compact purchase/refund transaction data under 64 bytes;
- send a deliberately low TestAlbatross payment with data to a human-entered test recipient;
- independently fetch/normalize/verify that transaction through configured server RPC/node;
- known-good and tampered automated vectors;
- record device/App/SDK/core/network evidence.

### Exit criteria

- [x] App loads in current Nimiq Pay on Android and iOS, or a documented target-device exception is accepted by the project lead. Android 16/Nimiq Pay 2.19.1 is evidenced; D-016 accepts Android-only Cycle II validation and explicitly defers iOS.
- [ ] `init()` success/timeout and `listAccounts()` approval/cancellation behave as handled. T-001/T-002 require the project lead's explicit personal results.
- [x] Actual `sign()` output verifies over exactly one documented byte sequence, derives the actual signer, and proves wallet-list membership; expected-account mismatch remains diagnostic metadata.
- [x] Known-good, tampered message/signature, malformed key, and wrong-address tests pass.
- [ ] `sendBasicTransactionWithData()` approval/cancellation works on TestAlbatross with exact recipient, Luna, and tag. Approval and verified finality are evidenced; T-020 remains open.
- [x] Returned hash is independently retrieved; network, sender, normalized recipient, value, data, successful execution, and macro finality match.
- [x] SDK/core versions and observed host differences are documented in architecture/protocol/decisions.
- [x] Lint, typecheck, tests, and build pass.

If sign preprocessing differs from the NR1 candidate, change it once with captured evidence and a decision before any product signature exists.

D-022 restores T-001, T-002, and T-020 to open. Only the project lead's explicit result after personally performing each test can close it.

## Phase 1 — Policy + Merchant

### Build

Database migrations/constraints; first-proof-derived merchant policy signer; separately signed settlement address; server-issued policy challenge; canonicalization; signing/verification; append-only versions; role authorization and audit events; configured writer routes; merchant studio; verified public proof and history. D-020 authorizes this complete implementation before the deferred Phase 0 device cases close, but keeps actual Nimiq Pay proof as the phase exit.

### Exit criteria

- [ ] Merchant can create and sign a policy on device and publish product in under 60 seconds. Physical validation remains pending.
- [x] First proof atomically establishes the policy signer; later wrong-signer/invalid/altered/expired/replayed proofs fail; a distinct signed settlement address succeeds.
- [x] Concurrent version creation is monotonic and historical verified policy cannot update/delete under runtime role.
- [x] Product cannot activate without verified policy.
- [ ] API/database integration tests, mobile accessibility, and full gate pass. Automated integration/full gates pass; the physical mobile exit remains pending.
- [ ] Deferred T-001/T-002 actual-device cases pass during the Phase 1 signing run; failure blocks this phase exit.

Phase 1 remains open. Physical signing/publication and physical v1→v2 validation require the project lead's explicit personal results.

D-023 permits Phase 2 implementation despite this open exit. It does not mark any Phase 1 criterion complete.

## Phase 2 — Purchase Passport

### Build

Pending order; immutable expected payment; exact Luna parser; direct payment; hash attachment; independent verifier; confirmation/finality policy; retry/reload/reorg handling; one Passport; lifecycle/evidence UI.

### Exit criteria

- [ ] End-to-end device purchase creates exactly one passport only after valid evidence.
- [x] Wrong network/sender/recipient/value/data/state and duplicate hashes fail in automated verification; physical purchase remains separately open.
- [ ] Cancel, pending, inconclusive, invalid, and verified are distinct and recover on reload. Automated coverage passes; device cancellation/reload remains open.
- [x] Race/idempotency tests pass and append-only chain reconciliation is operational.
- [ ] Passport clearly shows purchase-bound policy and first-minute test passes through passport creation.

Phase 2 cannot formally exit until its automated/code criteria and the consolidated physical-device session pass. D-025 permits Phase 3 implementation without treating that deferral as a Phase 2 exit.

## Phase 3 — Claims

### Build

First close the D-018 claimant-authorization design gate: define how a proof-derived claim signer is authorized for the independently verified purchase sender without assuming signer equality or wallet account selection. Then build RETURN/WARRANTY claim challenge; reason/note validation; deterministic eligibility evaluator/version; inclusive time boundaries; merchant queue; policy-signer approve/reject resolution; historical display.

### Exit criteria

- [x] Automated authorized equal/distinct signer cases pass according to D-025; unrelated/invalid/altered/replayed/duplicate claims fail. Physical equal/distinct-account validation remains open.
- [x] Eligibility unit matrix and exact boundary tests pass.
- [x] Policy eligible copy never promises outcome.
- [x] Only policy merchant can resolve; one final resolution under concurrency.
- [ ] Actual-device claim/resolution signing and reload work.

Phase 3 implementation is code-complete but cannot formally exit until the consolidated physical-device claim/resolution, reload, and mobile checks pass. D-029 explicitly allows Phase 4 implementation to proceed while correcting D-027's authorization history; it does not convert any open item to PASS.

## Phase 4 — Refund

### Build

Approved refund expectation; direct purchase-bound settlement address→original buyer NIM transaction/tag; cancellation/pending/retry UI; independent verification; global hash uniqueness; complete lifecycle and reconciliation.

### Exit criteria

- [ ] Low-value device refund verifies end to end.
- [x] Wrong network/sender/recipient/value/data/state/duplicate fail in automated verification; physical exact-sender validation remains open.
- [x] Approved is never confused with refunded.
- [x] Reload-safe identifiers, RPC outage, cancellation/unknown recovery, double-submit, and concurrent verifier tests pass; actual WebView reload remains open.
- [ ] Full purchase→claim→decision→refund story completes reliably on target devices.

Phase 4 implementation is code-complete but cannot formally exit until the consolidated low-value exact-sender refund, independent finality, recovery/reload, and mobile checks pass. The project lead subsequently authorized the narrowly scoped Phase 5 work recorded in D-030; that later instruction does not close Phase 4.

## Phase 5 — Promise Ledger + polish

### Build

Derived metrics/views and definitions; final/loading/failure/empty states; accessibility/performance/security hardening; privacy copy; public merchant surface; and reconciliation visibility limited to operational need. The verified Promise Ledger intentionally excludes unsigned wallet-open telemetry. Consent-aware pilot instrumentation remains a Phase 6 operational decision and cannot contaminate evidence-derived public metrics.

### Exit criteria

- [x] Mixed integration fixture proves all metric categories and no mutation API/grant exists.
- [x] Metrics reconcile to source evidence and show `as_of`/sample definitions.
- [ ] WCAG 2.2 AA target review, device matrix, performance budgets, and security checklist pass.
- [ ] Five unbriefed testers understand/reach the core in under 60 seconds; critical findings fixed.
- [ ] Production deployment, backups/restore, RPC failover, alerts, and incident runbook tested.

Phase 5 is experimental/code-complete at 90%: its read-only evidence projection, public judge surface, state copy, responsive/accessibility implementation, bundle splitting, security controls, and automated reconciliation suite are complete. It cannot formally exit until the manual accessibility/device/first-minute work and production operations criteria above pass. Phase 6 is not authorized or started.

## Phase 6 — Real pilot

### Build/operate

Recruit one genuine merchant-like campaign and 25–35 real wallet users; use safe low-value NIM purchases; support authentic claims/decisions/refunds; monitor failures and fix core reliability; collect consented aggregate evidence and product feedback without gaming usage.

### Exit criteria

- [ ] 25+ genuine unique wallets measured according to current official rules.
- [ ] Target of 25+ verified purchases and several authentic claims/refunds, without manufactured events.
- [ ] Every pilot transaction/ledger aggregate reconciles; no unresolved security incident.
- [ ] High-severity UX/reliability issues fixed and release smoke/device suite rerun.
- [ ] Evidence is privacy-reviewed and truthful.

## Phase 7 — Competition submission

### Build/prepare

Recheck live rules/portal/schema; public MIT repository; deployed release; screenshots/icon/thumbnail; ≤250-word description if current; concise demo video; builder story; Skool and public social posts; repository/deployment/payout details; final audits.

### Exit criteria

- [ ] Submitted before September 18, 2026 23:59 UTC with confirmation retained.
- [ ] Judge can open deployed app and complete/understand main point on first try.
- [ ] Public repo contains no secret/test success path and all links/assets work.
- [ ] Current rules, eligibility, team, license, payout wallet, and promotion links verified.
- [ ] Post-submission monitoring continues; cutoff is not treated as code freeze, but deployed submitted product was already judgeable.

## Critical path

Actual-device Phase 0 → immutable signed policy → independently verified purchase/passport → signed claim/decision → independently verified refund → derived ledger/polish → real pilot → submission. Any work outside this path must justify why it reduces risk or directly improves rubric evidence.
