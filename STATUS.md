# Operational status

Last updated: 2026-09-15 (IST)

## Current phase

**Phase 2 — Purchase Passport: code-complete at the consolidated device boundary under D-023.** Phase 0 stays 98% and Phase 1 stays 92%. T-001, T-002, T-020, physical policy signing/publication, and physical v1→v2 validation remain open/pending until the project lead personally performs and explicitly reports each result. They are batched with the Phase 2 device suite, not waived.

## Completion by phase

- Phase 0 — Technical proof: **98%** (prior Android chain/signature proof complete; T-001/T-002/T-020 remain open).
- Phase 1 — Policy + Merchant: **92%** (implementation, automated integration, and responsive browser checks complete; physical policy and v1→v2 validation remain pending).
- Phase 2 — Purchase Passport: **90%** (implementation and automated gates complete; physical purchase/Passport, reload, mobile/accessibility, and first-minute validation pending).
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

## Phase 2 implementation

- The public product route now presents a buyer-focused verified-policy checkout. The API creates an expiring order whose merchant/product/policy version/hash, NR1 protocol, settlement recipient, integer-Luna price, and `NR1:P:<order>` tag are server-derived and immutable.
- The client calls the documented Nimiq Pay payment surface with recipient, integer value, data, and validity height only. It never submits or persists a sender claim; the independently observed chain sender becomes the order buyer.
- Hash attachment reserves one global network/hash binding. Absent, mempool, included/pre-macro, RPC-inconclusive, invalid, and finalized evidence stay distinct. Only matching network/recipient/value/data, `executionResult=true`, and following-macro finality create one purchase transaction and one Passport atomically.
- Session storage contains only public product/order IDs and an optional returned hash. A saved hash resumes attachment/recheck without another wallet request. Explicit cancellation creates no Passport and can retry; a hashless ambiguous native outcome blocks another payment.
- The public Passport re-verifies its purchase-bound historical policy and stored normalized chain evidence before display. It shows chain buyer, recipient, exact Luna/data/hash, purchase timestamp, execution, macro/head finality, policy signer/version/hash/terms/deadlines, and explains that later policies cannot rewrite the purchase.
- Rechecks append immutable reconciliation records. A prior finalized record that regresses or changes produces a public `verification_exception`; RPC absence/outage is separately inconclusive and never rewrites the original evidence.

## Build and test status

Local Node 24.13.1/npm 11.8.0 gates pass: `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build`. GitHub Actions passed the Phase 2 API checkpoint (`b9ca6c0`) and buyer-flow checkpoint (`6688000`); reconciliation checkpoint `22b5930` was still running at this documentation edit and must pass before handoff. Production dependency audit reports zero known vulnerabilities.

The configured suite has 121 hermetic tests across twenty files plus 23 PostgreSQL 16 integration tests (144 total with `TEST_DATABASE_URL`). Phase 2 coverage includes exact active-policy capture, preserved v1 after v2, strict integer money, wallet-state recovery, no client sender field, mismatch/execution/finality/RPC failure matrices, global hash replay rejection, chain-derived buyer, concurrent/idempotent one-Passport finalization, immutable Passport evidence, reload pointers, and append-only reconciliation exception/recovery.

## Manual verification

- In the local in-app browser, the real API/PostgreSQL path created a merchant/product and issued an exact v1 canonical challenge. A normal browser correctly stopped at “Open this page inside Nimiq Pay” and did not fabricate publication.
- A deterministic test-only proof produced public v1 and v2 records. The frontend independently read them through the fail-closed API and visibly showed v2 active plus v1 preserved, with distinct hashes and terms.
- Desktop and 375 CSS-pixel mobile layouts were inspected; the mobile document had no horizontal overflow and the tested page emitted no console warning/error. This is not a substitute for Nimiq Pay or full accessibility evidence.
- No current personal PASS confirmation exists for T-001, T-002, T-020, Phase 1 physical signing/publication, or physical v1→v2 validation. Automated, CI, browser, code-completeness, simulated, and earlier cryptographic results are not substitutes.
- No Phase 2 physical payment, real-chain Passport, WebView reload/recovery, mobile accessibility, or first-minute result is claimed. These remain in the consolidated project-lead checklist.

## Deployment and RPC

Not deployed. Vendor/region/credentials remain owner decisions. The ignored local configuration can reach the public Nimiq Watch TestAlbatross development endpoint, but that source has no SLA and is not an operated production primary/failover verifier.

## Current blockers

- **Phase 0 exit:** T-001, T-002, and T-020 require explicit project-lead results after personal physical Nimiq Pay testing.
- **Phase 1 exit:** physical signing/publication and physical v1→v2 validation require explicit project-lead results after personal testing.
- **Phase 2 exit:** a real low-value buyer payment, independent chain verification, Passport creation, reload/recovery, and first-minute/mobile checks require explicit project-lead results.
- **Deployment:** production database/origin/session/RPC secrets, HTTPS host, and operated RPC redundancy are not configured.
- **Phase 3 later:** D-018 claimant authorization must be specified and security-reviewed before any claim writes.

## Next milestone

Run the consolidated physical-device checklist in `docs/evidence/consolidated-device-validation.md`. Record only the project lead's explicit results and sanitized evidence. Do not begin Phase 3.
