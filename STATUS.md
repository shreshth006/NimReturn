# Operational status

Last updated: 2026-09-15 (IST)

## Current phase

**Phase 1 — Policy + Merchant backend foundations: in progress under D-019.** Phase 0 remains 98% rather than being declared complete. Its critical Android cryptographic/chain proof is complete; T-001/T-002 are scheduled into the Phase 1 device suite and T-020 into Phase 2. The canonical policy, PostgreSQL, challenge, proof-verification, and atomic-publication foundations are implemented. D-019 still authorizes backend/data/protocol work only—no merchant screens or production NR1 writer activation.

## Completion by phase

- Phase 0 — Technical proof: **98%** (Android chain/signature proof complete, stale cancellation state fixed, and Android-only exception documented; three short actual-device cancellation/recovery results pending).
- Phase 1 — Policy + Merchant: **55%** (canonical policy, least-privilege database, and complete write-domain trust core implemented; read/expiry projections, HTTP authorization, native signing, deferred device cases, and user flow remain).
- Phase 2 — Purchase Passport: **0%**.
- Phase 3 — Claims: **0%**.
- Phase 4 — Refund: **0%**.
- Phase 5 — Promise Ledger + polish: **0%**.
- Phase 6 — Real pilot: **0%**.
- Phase 7 — Competition submission: **5%** (strategy/checklist drafted; no assets or submission).

Percentages are planning estimates, not earned rubric points.

## Build status

Passing on Node 24.13.1/npm 11.8.0: `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build`. GitHub Actions runs the same locked-install gate plus PostgreSQL 16 integration tests on pushes to `main` and pull requests. Frontend output includes official Nimiq core WASM (~1.11 MB raw/~471 KB gzip); track mobile performance.

## Test status

95 hermetic tests pass across fourteen files. Seventeen additional integration cases pass against PostgreSQL 16 (112 total with `TEST_DATABASE_URL`), covering migrations, restricted runtime-role behavior, immutable identity/evidence, one-bootstrap/one-challenge binding, hashed capability storage, normalized atomic draft creation, exact stored policy evidence, invalid-attempt rollback, safe retry, replay rejection, first-signer compare-and-set, wrong established signer, verified-only activation, append-only events, and concurrent monotonic versions/publication. API health plus invalid-request (400), unconfigured-RPC fail-closed (503), and configured live TestAlbatross readiness behavior were manually checked. The Android v2 artifact supplies actual-device T-017 and T-035 proof. Phase 1 HTTP and browser/device E2E remain pending.

## Deployment status

Not deployed. Vendor intentionally deferred pending owner credentials/region/current limits. Required topology is documented.

## RPC status

The local API is configured through ignored `.env` state to use the public Nimiq Watch TestAlbatross development endpoint. On 2026-09-14 it reported `connected=true`, `networkMatches=true`, network `TestAlbatross`, and a current head through both loopback and LAN. The endpoint is rate-limited and has no SLA; it is evidence for Phase 0 development, not the production primary/failover design.

## Mobile Nimiq Pay status

Physical Android 16/Nimiq Pay 2.19.1 testing initialized the provider, returned two accounts, exercised transient `consensus=false` plus live head behavior, and confirmed exact framed SHA-256 signing. A real 1000-Luna transaction with a strict redacted NR1 purchase tag was independently retrieved with matching normalized recipient/value/data, a wallet-listed observed sender, `executionResult=true`, reached macro finality, and final RPC outcome `verified`. The valid message signer differed from both the expected diagnostic account and transaction sender in this recorded run; this is an observation, not a routing rule. The authoritative v2 JSON and checksum remain private outside Git; only the sanitized checksum-bound summary is public.

## Current blockers

- Deferred external/runtime: record actual-device T-001/T-002 during the Phase 1 native signing suite and T-020 during the Phase 2 payment suite. D-019 permits Phase 1 backend foundations but does not mark these cases passed.
- External for production transaction lookup: operated primary and independent/failover Nimiq RPC sources; the configured public development endpoint has no guarantee.
- Phase 3 design gate (not a Phase 0/1 blocker): specify and security-review signed authorization between a proof-derived claim signer and the independently verified purchase sender. Direct equality is not an accepted shortcut.
- Later external: deployment/database credentials, pilot merchant/users, and promotion accounts. The public GitHub remote is configured.

These do not block the remaining backend-only Phase 1 work, pure crypto/protocol tests, or fail-closed RPC integration.

## Critical path

Phase 1 distinct policy-signer/settlement backend foundation → combined Phase 1 device signing plus deferred T-001/T-002 → Phase 2 verified purchase/passport plus deferred T-020 → Phase 3 claimant-authorization gate and claims/resolution → Phase 4 refund → polish/deploy/pilot/submission.

## Next milestone

**Phase 1 read/expiry boundary:** add the verified-only public product projection and bounded stale-challenge expiry transition. Keep canonical Nimiq Pay policy signing plus deferred T-001/T-002 on the explicit device TODO; production NR1 writer routes and merchant screens stay disabled until that gate passes.
