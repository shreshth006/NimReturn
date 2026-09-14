# Operational status

Last updated: 2026-09-14 (IST)

## Current phase

**Phase 0 — Technical proof: in progress.** Documentation, architecture, code scaffold, diagnostics, and local automated/runtime checks are established. A live TestAlbatross development RPC is connected through the API. Actual Nimiq Pay signing/payment and tagged transaction round-trip evidence remain on the critical path.

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

27/27 unit tests passing across six files: canonicalization/domain separation, compact tags, official-core signature/address binding and tampering, exact-byte device evidence export, transaction field/execution/macro-finality matching, and RPC normalization/readiness. API health plus invalid-request (400), unconfigured-RPC fail-closed (503), and configured live TestAlbatross readiness behavior manually checked. Actual-device and database integration/E2E remain pending by phase.

## Deployment status

Not deployed. Vendor intentionally deferred pending owner credentials/region/current limits. Required topology is documented.

## RPC status

The local API is configured through ignored `.env` state to use the public Nimiq Watch TestAlbatross development endpoint. On 2026-09-14 it reported `connected=true`, `networkMatches=true`, network `TestAlbatross`, and a current head through both loopback and LAN. The endpoint is rate-limited and has no SLA; it is evidence for Phase 0 development, not the production primary/failover design.

## Mobile Nimiq Pay status

Responsive browser inspection passed at 390×844: no horizontal overflow, primary controls 48px high, provider-unavailable recovery copy displayed after SDK timeout, and no console errors/warnings. This is **not Nimiq Pay testing**. Exact `sign()` preprocessing, cancellation response shape, WebView resume, transaction data round-trip, and independent lookup require a physical current Nimiq Pay device.

## Current blockers

- External: access to current Nimiq Pay iOS/Android, dedicated TestAlbatross wallet/recipient, and test funds.
- External for production transaction lookup: operated primary and independent/failover Nimiq RPC sources; the configured public development endpoint has no guarantee.
- Later external: deployment/database credentials, public GitHub remote, pilot merchant/users, promotion accounts.

These do not block local scaffold, pure crypto/protocol tests, or fail-closed RPC integration.

## Critical path

Finish local Phase 0 gate → actual-device signing/payment/RPC proof → freeze NR1 transport → Phase 1 immutable policy → Phase 2 verified purchase/passport → Phase 3 claims/resolution → Phase 4 refund → polish/deploy/pilot/submission.

## Next milestone

**Phase 0 device proof:** capture a current Nimiq Pay signature that verifies over exactly the diagnostic bytes, then send and independently retrieve one guarded low-value TestAlbatross transaction whose network/sender/recipient/Luna/data/state all match.
