# Implementation phases

## Operating rule

Phases are sequential security gates, not themes running in parallel. A later phase can be designed but not implemented while a critical prerequisite remains unproven unless the project lead accepts a narrow, recorded deferral with an explicit later test gate. D-023, D-025, D-029, and D-030 record the scoped deferrals that produced Phases 2–5; D-032, D-034, and D-037 record the later explicit physical results. Remaining physical checks stay open until individually reported. Percentages live in `STATUS.md`; this file defines scope and exits.

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
- [x] `init()` success/timeout and `listAccounts()` approval/cancellation behave as handled. T-001 provider failure/recovery and T-002 account-permission cancellation/recovery passed by explicit project-lead reports on 2026-09-16.
- [x] Actual `sign()` output verifies over exactly one documented byte sequence, derives the actual signer, and proves wallet-list membership; expected-account mismatch remains diagnostic metadata.
- [x] Known-good, tampered message/signature, malformed key, and wrong-address tests pass.
- [x] `sendBasicTransactionWithData()` approval/cancellation works on TestAlbatross with exact recipient, Luna, and tag. Approval and verified finality are evidenced; the patched native-cancellation retest passed by explicit project-lead report as T-020 on 2026-09-16.
- [x] Returned hash is independently retrieved; network, sender, normalized recipient, value, data, successful execution, and macro finality match.
- [x] SDK/core versions and observed host differences are documented in architecture/protocol/decisions.
- [x] Lint, typecheck, tests, and build pass.

If sign preprocessing differs from the NR1 candidate, change it once with captured evidence and a decision before any product signature exists.

D-022 restored T-001, T-002, and T-020 to open. Only the project lead's explicit result after personally performing each test can close it. All three were subsequently performed and explicitly reported PASS on 2026-09-16; D-032 records the formal Phase 0 closeout.

## Phase 1 — Policy + Merchant

### Build

Database migrations/constraints; first-proof-derived merchant policy signer; separately signed settlement address; server-issued policy challenge; canonicalization; signing/verification; append-only versions; role authorization and audit events; configured writer routes; merchant studio; verified public proof and history. D-020 authorizes this complete implementation before the deferred Phase 0 device cases close, but keeps actual Nimiq Pay proof as the phase exit.

### Exit criteria

- [x] Merchant can create and sign a policy on device and publish product in under 60 seconds. Passed by explicit project-lead report on 2026-09-16.
- [x] First proof atomically establishes the policy signer; later wrong-signer/invalid/altered/expired/replayed proofs fail; a distinct signed settlement address succeeds.
- [x] Concurrent version creation is monotonic and historical verified policy cannot update/delete under runtime role.
- [x] Product cannot activate without verified policy.
- [x] API/database integration tests, mobile accessibility, and full gate pass. Automated gates pass; the physical v1→v2 mobile exit passed by explicit project-lead report on 2026-09-16.
- [x] Deferred T-001/T-002 actual-device cases pass during the consolidated device run. Both passed by explicit project-lead reports on 2026-09-16.

Phase 1 is closed. The project lead explicitly reported physical signing/publication PASS and physical v1→v2 validation PASS on 2026-09-16; D-034 records the closeout.

D-023 permits Phase 2 implementation despite this open exit. It does not mark any Phase 1 criterion complete.

## Phase 2 — Purchase Passport

### Build

Pending order; immutable expected payment; exact Luna parser; direct payment; hash attachment; independent verifier; confirmation/finality policy; retry/reload/reorg handling; one Passport; lifecycle/evidence UI.

### Exit criteria

- [x] End-to-end device purchase creates exactly one passport only after valid evidence. Passed by explicit project-lead report on 2026-09-17.
- [x] Wrong network/sender/recipient/value/data/state and duplicate hashes fail in automated verification; the real purchase/chain verification passed on 2026-09-17.
- [x] Cancel, pending, inconclusive, invalid, and verified are distinct and recover on reload. Automated coverage and the Phase 2 device reload result pass.
- [x] Race/idempotency tests pass and append-only chain reconciliation is operational.
- [ ] Passport clearly shows purchase-bound policy and first-minute test passes through passport creation.

Physical payment, chain verification, Passport creation, reload/recovery, and mobile/accessibility passed by explicit project-lead reports on 2026-09-16/17. Only the deferred first-minute test remains.

Phase 2 cannot formally exit until its automated/code criteria and the consolidated physical-device session pass. D-025 permits Phase 3 implementation without treating that deferral as a Phase 2 exit.

## Phase 3 — Claims

### Build

First close the D-018 claimant-authorization design gate: define how a proof-derived claim signer is authorized for the independently verified purchase sender without assuming signer equality or wallet account selection. Then build RETURN/WARRANTY claim challenge; reason/note validation; deterministic eligibility evaluator/version; inclusive time boundaries; merchant queue; policy-signer approve/reject resolution; historical display.

### Exit criteria

- [x] Automated chain-sender, purchase-key, and delegated authority cases pass under D-025/D-035; unrelated/invalid/altered/replayed/duplicate claims fail. Physical distinct-signer purchase-key validation passed on 2026-09-17.
- [x] Eligibility unit matrix and exact boundary tests pass.
- [x] Policy eligible copy never promises outcome.
- [x] Only policy merchant can resolve; one final resolution under concurrency.
- [ ] Actual-device claim/resolution signing and reload work. Signing passed on 2026-09-17 (claim via the D-035 purchase claim key, merchant approval via the policy signer); reload remains open.

Phase 3 implementation is code-complete but cannot formally exit until the consolidated physical-device claim/resolution, reload, and mobile checks pass. D-029 explicitly allows Phase 4 implementation to proceed while correcting D-027's authorization history; it does not convert any open item to PASS.

## Phase 4 — Refund

### Build

Approved refund expectation; D-036 claim-key or legacy recipient rule; cancellation/pending/retry and hashless-outcome recovery UI; independent verification; global hash uniqueness; complete lifecycle and reconciliation.

### Exit criteria

- [x] Low-value device refund verifies end to end. Passed on 2026-09-17, paid to the purchase claim key under D-036.
- [x] Wrong network/applicable sender/recipient/value/data/state/duplicate fail in automated verification; claim-key routing and independent finality passed physically on 2026-09-17. Settlement-sender routing was superseded, not passed.
- [x] Approved is never confused with refunded.
- [x] Reload-safe identifiers, RPC outage, cancellation/unknown recovery, double-submit, and concurrent verifier tests pass; actual WebView reload remains open.
- [ ] Full purchase→claim→decision→refund story completes reliably on target devices. One complete Android run passed on 2026-09-17; cancellation and reload paths remain open.

Phase 4 implementation is code-complete but cannot formally exit until native cancellation, recovery/reload, and mobile/accessibility checks pass. Independent finality passed on Android under D-036. The project lead subsequently authorized the narrowly scoped Phase 5 work recorded in D-030; that later instruction does not close Phase 4.

## Phase 5 — Promise Ledger + polish

### Build

Derived metrics/views and definitions; final/loading/failure/empty states; accessibility/performance/security hardening; privacy copy; public merchant surface; and reconciliation visibility limited to operational need. The verified Promise Ledger intentionally excludes unsigned wallet-open telemetry. Consent-aware pilot instrumentation remains a Phase 6 operational decision and cannot contaminate evidence-derived public metrics.

### Exit criteria

- [x] Mixed integration fixture proves all metric categories and no mutation API/grant exists.
- [x] Metrics reconcile to source evidence and show `as_of`/sample definitions.
- [ ] WCAG 2.2 AA target review, device matrix, performance budgets, and security checklist pass.
- [ ] Five unbriefed testers understand/reach the core in under 60 seconds; critical findings fixed.
- [ ] Production deployment, backups/restore, RPC failover, alerts, and incident runbook tested.

Phase 5 is experimental/code-complete at 90%: its read-only evidence projection, public judge surface, state copy, responsive/accessibility implementation, bundle splitting, security controls, automated reconciliation suite, and temporary HTTPS staging preflight are complete. It cannot formally exit until the actual-device lifecycle, manual accessibility/first-minute work, and production operations criteria above pass. Phase 6 is not authorized or started.

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
