# Implementation phases

## Operating rule

Phases are sequential security gates, not themes running in parallel. A later phase can be designed but not implemented while a critical prerequisite remains unproven unless the project lead accepts a narrow, recorded deferral with an explicit later test gate. D-019 permits only Phase 1 backend foundations while three Phase 0 native cases remain open. Percentages live in `STATUS.md`; this file defines scope and exits.

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
- [ ] `init()` success/timeout and `listAccounts()` approval/cancellation behave as handled.
- [x] Actual `sign()` output verifies over exactly one documented byte sequence, derives the actual signer, and proves wallet-list membership; expected-account mismatch remains diagnostic metadata.
- [x] Known-good, tampered message/signature, malformed key, and wrong-address tests pass.
- [ ] `sendBasicTransactionWithData()` approval/cancellation works on TestAlbatross with exact recipient, Luna, and tag. Approval and verified finality are evidenced; actual-device cancellation remains open.
- [x] Returned hash is independently retrieved; network, sender, normalized recipient, value, data, successful execution, and macro finality match.
- [x] SDK/core versions and observed host differences are documented in architecture/protocol/decisions.
- [x] Lint, typecheck, tests, and build pass.

If sign preprocessing differs from the NR1 candidate, change it once with captured evidence and a decision before any product signature exists.

D-019 does not mark the unchecked criteria complete. T-001/T-002 are due in the Phase 1 actual-device suite and T-020 in the Phase 2 payment suite; all remain release-blocking until recorded.

## Phase 1 — Policy + Merchant

### Build

Database migrations/constraints; first-proof-derived merchant policy signer; separately signed settlement address; server-issued policy challenge; canonicalization; signing/verification; append-only versions; role authorization and audit events. D-019 authorizes these backend foundations before the deferred Phase 0 device cases close. Merchant screens, product editor UI, and production writer activation remain outside the authorized batch.

### Exit criteria

- [ ] Merchant can create and sign a policy on device and publish product in under 60 seconds.
- [ ] First proof atomically establishes the policy signer; later wrong-signer/invalid/altered/expired/replayed proofs fail; a distinct signed settlement address succeeds.
- [ ] Concurrent version creation is monotonic and historical verified policy cannot update/delete under runtime role.
- [ ] Product cannot activate without verified policy.
- [ ] API/database integration tests, mobile accessibility, and full gate pass.
- [ ] Deferred T-001/T-002 actual-device cases pass during the Phase 1 signing run; failure blocks this phase exit.

## Phase 2 — Purchase Passport

### Build

Pending order; immutable expected payment; exact Luna parser; direct payment; hash attachment; independent verifier; confirmation/finality policy; retry/reload/reorg handling; one Passport; lifecycle/evidence UI.

### Exit criteria

- [ ] End-to-end device purchase creates exactly one passport only after valid evidence.
- [ ] Wrong network/sender/recipient/value/data/state and duplicate hashes fail.
- [ ] Cancel, pending, inconclusive, invalid, and verified are distinct and recover on reload.
- [ ] Race/idempotency tests pass and chain reconciliation is operational.
- [ ] Passport clearly shows purchase-bound policy and first-minute test passes through passport creation.

## Phase 3 — Claims

### Build

First close the D-018 claimant-authorization design gate: define how a proof-derived claim signer is authorized for the independently verified purchase sender without assuming signer equality or wallet account selection. Then build RETURN/WARRANTY claim challenge; reason/note validation; deterministic eligibility evaluator/version; inclusive time boundaries; merchant queue; policy-signer approve/reject resolution; historical display.

### Exit criteria

- [ ] Authorized equal/distinct signer cases pass according to the reviewed protocol; unrelated/invalid/altered/replayed/duplicate claims fail.
- [ ] Eligibility unit matrix and exact boundary tests pass.
- [ ] Policy eligible copy never promises outcome.
- [ ] Only policy merchant can resolve; one final resolution under concurrency.
- [ ] Actual-device claim/resolution signing and reload work.

## Phase 4 — Refund

### Build

Approved refund expectation; direct purchase-bound settlement address→original buyer NIM transaction/tag; cancellation/pending/retry UI; independent verification; global hash uniqueness; complete lifecycle and reconciliation.

### Exit criteria

- [ ] Low-value device refund verifies end to end.
- [ ] Wrong network/sender/recipient/value/data/state/duplicate fail.
- [ ] Approved is never confused with refunded.
- [ ] Reload, RPC outage, double tap, and concurrent verifier tests pass.
- [ ] Full purchase→claim→decision→refund story completes reliably on target devices.

## Phase 5 — Promise Ledger + polish

### Build

Derived metrics/views and definitions; truthful pilot instrumentation; final states/empty states; accessibility/performance/security hardening; privacy copy; public merchant surface; observability/reconciliation dashboards limited to operational need.

### Exit criteria

- [ ] Mixed integration fixture proves all metric categories and no mutation API/grant exists.
- [ ] Metrics reconcile to source evidence and show `as_of`/sample definitions.
- [ ] WCAG 2.2 AA target review, device matrix, performance budgets, and security checklist pass.
- [ ] Five unbriefed testers understand/reach the core in under 60 seconds; critical findings fixed.
- [ ] Production deployment, backups/restore, RPC failover, alerts, and incident runbook tested.

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
