# Operational status

Last updated: 2026-09-14 (IST)

## Current phase

**Phase 0 — Technical proof: in progress.** Documentation, architecture, code scaffold, diagnostics, and local automated/runtime checks are established. A live TestAlbatross development RPC is connected through the API. A first physical Android/Nimiq Pay run proved provider/accounts/head and exposed the signed-message framing mismatch now patched locally. Device verification of that patch plus the tagged transaction round-trip remain on the critical path.

## Completion by phase

- Phase 0 — Technical proof: **70%** (provider/accounts/head observed on a physical device; framed-signature retest and successful-execution/macro-final transaction proof pending).
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

36/36 unit tests passing across seven files: canonicalization/domain separation, compact tags, exact Nimiq framed signature/address binding and negative cases, UTF-8 length/raw-message rejection, exact-byte device evidence export, wallet consensus payment gating, transaction field/execution/macro-finality matching, and RPC normalization/readiness. API health plus invalid-request (400), unconfigured-RPC fail-closed (503), and configured live TestAlbatross readiness behavior manually checked. Full device transaction and database integration/E2E remain pending by phase.

## Deployment status

Not deployed. Vendor intentionally deferred pending owner credentials/region/current limits. Required topology is documented.

## RPC status

The local API is configured through ignored `.env` state to use the public Nimiq Watch TestAlbatross development endpoint. On 2026-09-14 it reported `connected=true`, `networkMatches=true`, network `TestAlbatross`, and a current head through both loopback and LAN. The endpoint is rate-limited and has no SLA; it is evidence for Phase 0 development, not the production primary/failover design.

## Mobile Nimiq Pay status

The first physical Android/Nimiq Pay run initialized the provider, returned two accounts, returned a block head with `consensus=false`, and returned a sign proof whose public key derived to the selected address. No payment was attempted. The raw-message verifier rejected the proof, leading to the exact framed SHA-256 patch; Step 4 must now be rerun to prove it against the device artifact. The updated consensus-locked layout passed browser inspection at 390×844 with no horizontal overflow, 48px minimum buttons, the payment control disabled, clear retry copy, and no console warnings/errors.

## Current blockers

- External/runtime: the current wallet must establish TestAlbatross consensus; the physical device must rerun signing and then approve one deliberately tiny tagged payment to an owned recipient.
- External for production transaction lookup: operated primary and independent/failover Nimiq RPC sources; the configured public development endpoint has no guarantee.
- Later external: deployment/database credentials, pilot merchant/users, and promotion accounts. The public GitHub remote is configured.

These do not block local scaffold, pure crypto/protocol tests, or fail-closed RPC integration.

## Critical path

Finish local Phase 0 gate → verify framed signature on device → wait for wallet consensus → actual-device payment/RPC finality proof → freeze NR1 → Phase 1 immutable policy → Phase 2 verified purchase/passport → Phase 3 claims/resolution → Phase 4 refund → polish/deploy/pilot/submission.

## Next milestone

**Phase 0 device proof:** rerun signing and confirm framed signature/address binding, retry until wallet consensus is true, then send and independently retrieve one guarded 1-Luna TestAlbatross transaction whose sender/recipient/value/data/execution/macro-finality all match.
