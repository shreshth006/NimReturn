# Operational status

Last updated: 2026-09-14 (IST)

## Current phase

**Phase 0 — Technical proof: in progress.** Documentation, architecture, code scaffold, diagnostics, and local automated/runtime checks are established. A live TestAlbatross development RPC is connected through the API. Physical Android/Nimiq Pay testing has confirmed the framing patch and submitted a real tagged transaction that the backend observed included. A clean macro-final verification and v2 evidence capture remain on the critical path; Phase 1 has not started.

## Completion by phase

- Phase 0 — Technical proof: **85%** (provider/accounts/head, framed signing, real tagged submission, and independent inclusion lookup observed on a physical device; clean successful-execution/macro-final verification and evidence capture pending).
- Phase 1 — Policy + Merchant: **0%**.
- Phase 2 — Purchase Passport: **0%**.
- Phase 3 — Claims: **0%**.
- Phase 4 — Refund: **0%**.
- Phase 5 — Promise Ledger + polish: **0%**.
- Phase 6 — Real pilot: **0%**.
- Phase 7 — Competition submission: **5%** (strategy/checklist drafted; no assets or submission).

Percentages are planning estimates, not earned rubric points.

## Build status

Passing on Node 24.13.1/npm 11.8.0: `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build`. GitHub Actions runs the same locked-install gate on pushes to `main` and pull requests; framed-signature run `34815743327` passed. Frontend output includes official Nimiq core WASM (~1.11 MB raw/~471 KB gzip); track mobile performance.

## Test status

63/63 unit tests passing across ten files: canonicalization/domain separation, compact tags, exact Nimiq framed signature/address binding and negative cases, diagnostic expected/actual signer separation, UTF-8 length/raw-message rejection, truthful v2 evidence export, reload-safe transaction records and duplicate locking, wallet consensus payment gating, transaction field/execution/macro-finality matching, retryable RPC outcome state, and RPC normalization/readiness. API health plus invalid-request (400), unconfigured-RPC fail-closed (503), and configured live TestAlbatross readiness behavior were manually checked. A final clean device macro-finality run and database integration/E2E remain pending by phase.

## Deployment status

Not deployed. Vendor intentionally deferred pending owner credentials/region/current limits. Required topology is documented.

## RPC status

The local API is configured through ignored `.env` state to use the public Nimiq Watch TestAlbatross development endpoint. On 2026-09-14 it reported `connected=true`, `networkMatches=true`, network `TestAlbatross`, and a current head through both loopback and LAN. The endpoint is rate-limited and has no SLA; it is evidence for Phase 0 development, not the production primary/failover design.

## Mobile Nimiq Pay status

Physical Android/Nimiq Pay testing initialized the provider, returned two accounts, exercised transient `consensus=false` plus live head behavior, and confirmed the exact framed SHA-256 signature fix. It also showed that changing NimReturn's expected-account dropdown does not select the signer. After consensus became available, the device submitted one approximately 1000-Luna transaction with an `NR1:P:<redacted-token>` tag to an owned recipient; the backend independently found it included on TestAlbatross and waiting for its finalizing macro block. No raw address, hash, signature, or token is committed. The final hardened UI still needs a from-scratch device run through `VERIFIED` and v2 evidence capture.

## Current blockers

- External/runtime: the physical device must perform one clean hardened-flow run, allow TestAlbatross consensus to establish, approve one deliberately tiny tagged payment to an owned recipient, recheck through the finalizing macro block, and capture sanitized v2 evidence.
- External for production transaction lookup: operated primary and independent/failover Nimiq RPC sources; the configured public development endpoint has no guarantee.
- Later external: deployment/database credentials, pilot merchant/users, and promotion accounts. The public GitHub remote is configured.

These do not block local scaffold, pure crypto/protocol tests, or fail-closed RPC integration.

## Critical path

Finish local Phase 0 gate → clean actual-device payment/RPC macro-finality proof and v2 evidence → freeze NR1 → Phase 1 immutable policy → Phase 2 verified purchase/passport → Phase 3 claims/resolution → Phase 4 refund → polish/deploy/pilot/submission.

## Next milestone

**Phase 0 device proof:** run from initialization, observe the derived actual signer, retry until wallet consensus is true, then send and independently retrieve one guarded 1000-Luna TestAlbatross transaction whose observed sender/recipient/value/data/execution/macro-finality all match; capture v2 evidence. Do not start Phase 1 before this passes.
