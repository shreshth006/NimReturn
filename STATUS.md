# Operational status

Last updated: 2026-09-14 (IST)

## Current phase

**Phase 0 — Technical proof: in progress.** Documentation, architecture, code scaffold, diagnostics, and local automated/runtime checks are established. Actual Nimiq Pay and configured TestAlbatross RPC evidence remain on the critical path.

## Completion by phase

- Phase 0 — Technical proof: **70%** (research/specification/scaffold/local verification complete; actual-device signing/payment and RPC round-trip pending).
- Phase 1 — Policy + Merchant: **0%**.
- Phase 2 — Purchase Passport: **0%**.
- Phase 3 — Claims: **0%**.
- Phase 4 — Refund: **0%**.
- Phase 5 — Promise Ledger + polish: **0%**.
- Phase 6 — Real pilot: **0%**.
- Phase 7 — Competition submission: **5%** (strategy/checklist drafted; no assets or submission).

Percentages are planning estimates, not earned rubric points.

## Build status

Passing on Node 24.13.1/npm 11.8.0: `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build`. Frontend output includes official Nimiq core WASM (~1.11 MB raw/~471 KB gzip); track mobile performance.

## Test status

25/25 unit tests passing across five files: canonicalization/domain separation, compact tags, official-core signature/address binding and tampering, transaction field/execution/macro-finality matching, and RPC normalization. API health plus invalid-request (400) and unconfigured-RPC fail-closed (503) behavior manually checked. Actual-device and database integration/E2E remain pending by phase.

## Deployment status

Not deployed. Vendor intentionally deferred pending owner credentials/region/current limits. Required topology is documented.

## Mobile Nimiq Pay status

Responsive browser inspection passed at 390×844: no horizontal overflow, primary controls 48px high, provider-unavailable recovery copy displayed after SDK timeout, and no console errors/warnings. This is **not Nimiq Pay testing**. Exact `sign()` preprocessing, cancellation response shape, WebView resume, transaction data round-trip, and independent lookup require a physical current Nimiq Pay device.

## Current blockers

- External: access to current Nimiq Pay iOS/Android, dedicated TestAlbatross wallet/recipient, and test funds.
- External for transaction lookup: configured Nimiq RPC/node endpoint; official open-server page lists no guaranteed endpoints.
- Later external: deployment/database credentials, public GitHub remote, pilot merchant/users, promotion accounts.

These do not block local scaffold, pure crypto/protocol tests, or fail-closed RPC integration.

## Critical path

Finish local Phase 0 gate → actual-device signing/payment/RPC proof → freeze NR1 transport → Phase 1 immutable policy → Phase 2 verified purchase/passport → Phase 3 claims/resolution → Phase 4 refund → polish/deploy/pilot/submission.

## Next milestone

**Phase 0 device proof:** capture a current Nimiq Pay signature that verifies over exactly the diagnostic bytes, then send and independently retrieve one guarded low-value TestAlbatross transaction whose network/sender/recipient/Luna/data/state all match.
