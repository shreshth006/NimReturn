# Operational status

Last updated: 2026-09-15 (IST)

## Current phase

**Phase 2 — Purchase Passport: active.** D-021 accepts the project lead's sanitized physical-device PASS results and formally closes Phases 0 and 1. Phase 2 is limited to pending orders, direct purchase payment, independent verification, and the Purchase Passport; claims and later features remain closed.

## Completion by phase

- Phase 0 — Technical proof: **100%** (accepted Android target-device suite complete; iOS remains a documented post-competition exception).
- Phase 1 — Policy + Merchant: **100%** (implementation, automated integration, responsive browser checks, and physical v1/v2 flow complete).
- Phase 2 — Purchase Passport: **0%**.
- Phase 3 — Claims: **0%**.
- Phase 4 — Refund: **0%**.
- Phase 5 — Promise Ledger + polish: **0%**.
- Phase 6 — Real pilot: **0%**.
- Phase 7 — Competition submission: **5%** (strategy/checklist drafted; no assets or submission).

Percentages are planning estimates, not earned rubric points.

## Phase 1 implementation

- The default React app is a responsive merchant studio: create product → set integer-Luna policy terms → review exact canonical challenge → grant wallet account access → sign through Nimiq Pay → locally verify framed bytes/signer/list membership → submit proof → re-read verified public policy.
- Production-configured Fastify routes create drafts, issue resource-bound challenges, publish only verified proofs, and expose a fail-closed public product projection with every verified historical policy version.
- The first signer is established only by a valid proof under a one-time 256-bit bootstrap stored as an `HttpOnly` cookie and a database hash. Successful publication consumes it and rotates to an eight-hour HMAC-authenticated merchant cookie. That cookie authorizes later challenge allocation only; every publication still requires the established wallet signer.
- Production requires `DATABASE_URL`, exact `CORS_ORIGIN`, and a server-only `SESSION_SECRET`. Writer routes have strict schemas, a 16 KiB body ceiling, exact production Origin checks, `SameSite=Strict`/`Secure` cookies, safe errors, redacted cookie logs, and per-IP rate limits.
- The public result makes protocol/version, cryptographic signer, separately signed settlement address, policy/server timestamps, terms, payload hash, public key, exact canonical message, and immutable version history visible.

## Build and test status

Local Node 24.13.1/npm 11.8.0 gates pass: `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build`. GitHub Actions run `34904483526` passed the locked install, PostgreSQL 16, lint, typecheck, all-test, and build gate for `b7fa868`. Production dependency audit reports zero known vulnerabilities; four current moderate advisories are confined to development dependencies.

The configured suite has 110 hermetic tests across eighteen files plus twenty PostgreSQL 16 integration tests (130 total with `TEST_DATABASE_URL`). The real-database API journey covers draft, protected bootstrap, canonical v1, wrong-resource rejection, exact proof publication, public reprojection, stale-bootstrap rejection, established session, changed terms, v2, and preserved verified v1. Existing negative, concurrency, immutability, least-privilege, RPC, execution-result, and Albatross-finality coverage remains passing.

## Manual verification

- In the local in-app browser, the real API/PostgreSQL path created a merchant/product and issued an exact v1 canonical challenge. A normal browser correctly stopped at “Open this page inside Nimiq Pay” and did not fabricate publication.
- A deterministic test-only proof produced public v1 and v2 records. The frontend independently read them through the fail-closed API and visibly showed v2 active plus v1 preserved, with distinct hashes and terms.
- Desktop and 375 CSS-pixel mobile layouts were inspected; the mobile document had no horizontal overflow and the tested page emitted no console warning/error. This is not a substitute for Nimiq Pay or full accessibility evidence.
- The project lead reported physical-device PASS outcomes for T-001 provider recovery, T-002 account cancellation/recovery, T-020 payment cancellation/safe retry, Phase 1 v1 signing/publication, and the v2 immutable-version flow. Only the sanitized outcome record is committed; wallet and raw proof material remain private.

## Deployment and RPC

Not deployed. Vendor/region/credentials remain owner decisions. The ignored local configuration can reach the public Nimiq Watch TestAlbatross development endpoint, but that source has no SLA and is not an operated production primary/failover verifier.

## Current blockers

- **Deployment:** production database/origin/session/RPC secrets, HTTPS host, and operated RPC redundancy are not configured.
- **Phase 3 later:** D-018 claimant authorization must be specified and security-reviewed before any claim writes.

## Next milestone

Implement the Phase 2 order and immutable expected-payment foundation, then connect strict hash attachment to the existing independent execution/finality verifier and create exactly one Purchase Passport from valid macro-final evidence. Do not build claims, refunds, Promise Ledger, AI, NFTs, or escrow.
