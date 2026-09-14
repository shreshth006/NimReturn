# Operational status

Last updated: 2026-09-14 (IST)

## Current phase

**Phase 0 — Technical proof: in progress.** The critical Android cryptographic/chain proof is complete: a private checksum-bound v2 artifact records valid framed signing and an independently verified, successfully executed, macro-final NR1-tagged TestAlbatross transaction. Existing Phase 0 iOS-or-approved-exception and actual-device provider/account cancellation-recovery criteria remain open. Phase 1 has not started.

## Completion by phase

- Phase 0 — Technical proof: **95%** (Android provider/accounts/head, framed signing, real tagged submission, successful execution, macro finality, independent verification, and private v2 evidence complete; cross-platform exception/coverage and cancellation-recovery evidence pending).
- Phase 1 — Policy + Merchant: **0%**.
- Phase 2 — Purchase Passport: **0%**.
- Phase 3 — Claims: **0%**.
- Phase 4 — Refund: **0%**.
- Phase 5 — Promise Ledger + polish: **0%**.
- Phase 6 — Real pilot: **0%**.
- Phase 7 — Competition submission: **5%** (strategy/checklist drafted; no assets or submission).

Percentages are planning estimates, not earned rubric points.

## Build status

Passing on Node 24.13.1/npm 11.8.0: `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build`. GitHub Actions runs the same locked-install gate on pushes to `main` and pull requests; Phase 0 hardening run `34843529727` passed. Frontend output includes official Nimiq core WASM (~1.11 MB raw/~471 KB gzip); track mobile performance.

## Test status

63/63 unit tests pass across ten files: canonicalization/domain separation, compact tags, exact Nimiq framed signature/address binding and negative cases, diagnostic expected/actual signer separation, UTF-8 length/raw-message rejection, truthful v2 evidence export, reload-safe transaction records and duplicate locking, wallet consensus payment gating, transaction field/execution/macro-finality matching, retryable RPC outcome state, and RPC normalization/readiness. API health plus invalid-request (400), unconfigured-RPC fail-closed (503), and configured live TestAlbatross readiness behavior were manually checked. The Android v2 artifact now supplies actual-device T-017 and T-035 proof. Database integration/E2E remain pending by phase.

## Deployment status

Not deployed. Vendor intentionally deferred pending owner credentials/region/current limits. Required topology is documented.

## RPC status

The local API is configured through ignored `.env` state to use the public Nimiq Watch TestAlbatross development endpoint. On 2026-09-14 it reported `connected=true`, `networkMatches=true`, network `TestAlbatross`, and a current head through both loopback and LAN. The endpoint is rate-limited and has no SLA; it is evidence for Phase 0 development, not the production primary/failover design.

## Mobile Nimiq Pay status

Physical Android 16/Nimiq Pay 2.19.1 testing initialized the provider, returned two accounts, exercised transient `consensus=false` plus live head behavior, and confirmed exact framed SHA-256 signing. A real 1000-Luna transaction with a strict redacted NR1 purchase tag was independently retrieved with matching normalized recipient/value/data, a wallet-listed observed sender, `executionResult=true`, reached macro finality, and final RPC outcome `verified`. The valid message signer differed from both the expected diagnostic account and transaction sender in this recorded run; this is an observation, not a routing rule. The authoritative v2 JSON and checksum remain private outside Git; only the sanitized checksum-bound summary is public.

## Current blockers

- External/runtime: record actual-device provider-timeout/recovery and account-permission cancellation behavior, then test current Nimiq Pay on iOS or obtain an explicit project-lead exception to the existing Phase 0 cross-platform criterion.
- External for production transaction lookup: operated primary and independent/failover Nimiq RPC sources; the configured public development endpoint has no guarantee.
- Later external: deployment/database credentials, pilot merchant/users, and promotion accounts. The public GitHub remote is configured.

These do not block local scaffold, pure crypto/protocol tests, or fail-closed RPC integration.

## Critical path

Close actual-device cancellation/recovery plus iOS-or-approved-exception criteria → freeze NR1 → Phase 1 immutable policy → Phase 2 verified purchase/passport → Phase 3 claims/resolution → Phase 4 refund → polish/deploy/pilot/submission.

## Next milestone

**Phase 0 closeout:** record T-001 provider timeout/recovery and T-002 account-permission cancellation on an actual host; then run current Nimiq Pay on iOS or have the project lead explicitly accept the documented Android-only Phase 0 exception. Do not start Phase 1 before that decision is recorded.
