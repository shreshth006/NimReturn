# Operational status

Last updated: 2026-09-16 (IST)

## Current phase

**Phase 5 — Promise Ledger + polish: experimental/code-complete at the manual and deployment boundary.** D-030 records the project lead's explicit Phase 5 instruction. Its verified-evidence projection, judge-facing lifecycle, reconciliation visibility, responsive/accessibility implementation, frontend splitting, and automated security controls are complete. Phases 0–4 remain open at their recorded physical boundaries. No physical, accessibility, first-minute, or deployment result is inferred from code, automation, or prior prompts. Phase 6 has not started.

## Completion by phase

- Phase 0 — Technical proof: **98%** (prior Android chain/signature proof complete; T-001/T-002/T-020 remain open).
- Phase 1 — Policy + Merchant: **92%** (implementation, automated integration, and responsive browser checks complete; physical policy and v1→v2 validation remain pending).
- Phase 2 — Purchase Passport: **90%** (implementation and automated gates complete; physical purchase/Passport, reload, mobile/accessibility, and first-minute validation pending).
- Phase 3 — Claims: **90% experimental/code-complete** (protocol, implementation, UI, and automated gates complete; signer-routing usability, actual-device claim/resolution, reload, and mobile validation pending).
- Phase 4 — Refund: **90% experimental/code-complete** (protocol, persistence, API, UI, and automated gates complete; required-sender routing, actual-device payment/finality, reload, and mobile validation pending).
- Phase 5 — Promise Ledger + polish: **90% experimental/code-complete** (derived ledger, judge surface, polish, and automated gates complete; manual accessibility/device/first-minute testing and production operations pending).
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

## Phase 3 implementation

- D-025 closes the claimant-authority design gate without assuming wallet account selection: a proof-derived signer matching the chain-derived buyer self-authorizes; a different signer requires a second exact-claim authorization signed by the chain-derived buyer.
- Production claim routes issue immutable RETURN/WARRANTY challenges, verify exact proofs and authority, evaluate the purchase-bound policy at an inclusive deadline, and expose a reload-safe public claim projection. Unrelated, altered, expired, replayed, duplicate, and invalid proofs fail closed.
- The protected merchant queue includes only authorized/evaluated claims. Resolution challenges bind decision, reason, note, full approved purchase value, claim, timestamp, nonce, and original policy signer. Only that signer can publish one final approve/reject result.
- Pending merchant decisions remain private and recover only through the authenticated merchant endpoint; buyers read only verified resolutions. Approval is visibly distinguished from a paid refund.
- The buyer journey supports claim creation, exact Nimiq Pay signing, distinct-signer authorization, eligibility evidence, reload recovery, and verified decision display. The merchant journey supports queue review, exact decision signing, pending recovery, and a judge-visible signer/hash receipt.

## Phase 4 implementation

- A verified approved resolution creates an immutable, server-derived refund expectation for the purchase-bound settlement sender, original chain-derived buyer, full approved integer-Luna value, TestAlbatross network, and exact `NR1:R:<claim-id>` tag. The merchant session allocates workflow state but is never payment authority.
- The merchant refund journey distinguishes requested, native-wallet started, cancelled, hashless unknown, verifying, pre-finality pending, failed, and independently verified states. Cancellation permits a fresh attempt; an unknown native result blocks blind repayment and accepts only a recovered transaction hash.
- Refund verification independently fetches the chain transaction and requires the exact network, sender, recipient, value, data, successful execution, and following-macro finality. Wrong fields fail closed, global network/hash uniqueness prevents replay, and concurrent exact verification is idempotent.
- Only finalized matching evidence creates the immutable refund transaction and moves the Purchase Passport from active to refunded. The signed claim resolution remains approved; buyer copy separately reports refund pending, failed, or verified.
- Post-finality rechecks append confirmed, inconclusive, or exception evidence without rewriting the accepted refund. The public buyer view shows the exact expectation and finalized proof while protected mutation routes remain bound to the owning merchant session.

## Phase 5 implementation

- Security-barrier PostgreSQL views derive the Promise Ledger from verified purchases, accepted and evaluated claims, verified policy-signer resolutions, verified refunds, and the latest append-only reconciliation outcomes. No table accepts merchant-edited counts.
- The public `GET /api/v1/merchants/:merchantPublicId/promise-ledger` route strictly parses public IDs, enforces reconciliation invariants and safe-integer counts, exposes definitions/sample sizes/`as_of`, is rate-limited, and has a short public cache policy. There is no metric mutation route.
- The restricted runtime role has `SELECT` only on ledger views. Mixed PostgreSQL fixtures prove all categories, odd/empty timing samples, immutable source reconciliation, exception appearance/recovery, and failed `INSERT`/`UPDATE`/`DELETE` attempts.
- The public merchant proof surface tells the one-minute policy → payment → Passport → claim → decision → refund → ledger story. It explicitly distinguishes cryptographic attestations from monetary chain evidence and policy signer, settlement address, purchase sender, claim signer, and refund sender.
- Ratings, reviews, subjective reputation, AI assessments, trust scores, manually editable metrics, and unsigned wallet-open telemetry are absent by design. Privacy and immutable-version explanations accompany the evidence.
- Loading, failure, retry, and empty states were strengthened across policy, claim, refund, and ledger surfaces. Progress semantics, focus states, 44-pixel action targets, pressed/current-state announcements, reduced-motion behavior, and 320-pixel responsive rules are implemented, but manual WCAG/device evidence remains open.
- Route-level lazy loading reduced the initial production JavaScript to 215.62 kB raw/67.68 kB gzip; the Promise Ledger route is 13.47 kB raw/4.15 kB gzip. The 1.11 MB WASM payload remains isolated to routes that need Nimiq cryptography.

## Build and test status

Local Node 24.13.1/npm 11.8.0 gates pass on 2026-09-16: `npm run lint`, `npm run typecheck`, all PostgreSQL-backed tests, and `npm run build`. The configured suite has 170 hermetic plus 26 PostgreSQL tests (196 total with `TEST_DATABASE_URL`). GitHub Actions runs `35037171956` and `35037762748` passed the Render adapter and managed-PostgreSQL portability fix. The production-only audit reports zero known vulnerabilities.

Phase 5 coverage includes strict ledger API/client parsing, mixed-evidence reconciliation, runtime-role immutability, timing samples, exception visibility/recovery, and health/cache/rate-limit coverage. Production configuration now also fails closed without RPC, and the staging package has validated API/web image builds, Caddy configuration, headers/cache policy, Compose interpolation, and a local containerized API smoke test.

## Manual verification

- In the local in-app browser, the real API/PostgreSQL path created a merchant/product and issued an exact v1 canonical challenge. A normal browser correctly stopped at “Open this page inside Nimiq Pay” and did not fabricate publication.
- A deterministic test-only proof produced public v1 and v2 records. The frontend independently read them through the fail-closed API and visibly showed v2 active plus v1 preserved, with distinct hashes and terms.
- Desktop and 375 CSS-pixel mobile layouts were inspected; the mobile document had no horizontal overflow and the tested page emitted no console warning/error. This is not a substitute for Nimiq Pay or full accessibility evidence.
- No current personal PASS confirmation exists for T-001, T-002, T-020, Phase 1 physical signing/publication, or physical v1→v2 validation. Automated, CI, browser, code-completeness, simulated, and earlier cryptographic results are not substitutes.
- No Phase 2 physical payment, real-chain Passport, WebView reload/recovery, mobile accessibility, or first-minute result is claimed. These remain in the consolidated project-lead checklist.
- No Phase 3 physical claim signing, distinct-account authorization, merchant resolution signing, WebView reload/recovery, or mobile/accessibility result is claimed. These remain in the expanded consolidated checklist.
- No Phase 4 physical refund, required settlement-sender routing, real-chain finality, recovery/reload, or mobile/accessibility result is claimed. These remain in the expanded consolidated checklist.
- The temporary Render staging origin loads and hydrates in a normal browser with no captured console warning/error; its HTTPS/API/database/RPC/security-header preflight passes. This is deployment readiness evidence only. No Phase 5 physical/mobile/accessibility, Promise Ledger lifecycle reconciliation, or unbriefed first-minute result is claimed.

## Deployment and RPC

Temporary staging is live at `https://nimreturn-staging-cycle2.onrender.com` on one free Render Docker service in Singapore, backed by a free managed PostgreSQL instance that expires on 2026-10-16. Render supplies HTTPS and a generated session secret. Migrations ran with the database owner; the app uses a separate `nimreturn_app` login that inherits only `nimreturn_runtime`, cannot create in `public`, has no admin attributes or owned relations, and cannot mutate either Promise Ledger view. Public checks pass for the app, `/health`, the OG image, a database-backed 404, CSP/HSTS and related headers, and the RPC diagnostic. `server/deploy/preflight.ts` returned `ready-for-device-test` against TestAlbatross head 11,552,625. The configured public development RPC has no SLA and is not an operated production primary/failover verifier; the free service may cold-start after inactivity.

## Current blockers

- **Phase 0 exit:** T-001, T-002, and T-020 require explicit project-lead results after personal physical Nimiq Pay testing.
- **Phase 1 exit:** physical signing/publication and physical v1→v2 validation require explicit project-lead results after personal testing.
- **Phase 2 exit:** a real low-value buyer payment, independent chain verification, Passport creation, reload/recovery, and first-minute/mobile checks require explicit project-lead results.
- **Phase 3 exit:** actual-device self/distinct-signer claims, merchant resolution signing, reload/recovery, and mobile checks require explicit project-lead results.
- **Phase 4 exit:** an actual low-value refund from the purchase-bound settlement account, independent chain/finality verification, recovery/reload, and mobile checks require explicit project-lead results. If Nimiq Pay cannot route the required sender, that is a FAIL and must not be bypassed.
- **Phase 5 exit:** the manual WCAG/device matrix, Promise Ledger reconciliation against the real lifecycle, five unbriefed first-minute tests, and production operations criteria remain open.
- **Deployment:** temporary HTTPS staging, managed database credentials, generated session secret, and a working public TestAlbatross development RPC are provisioned. Remaining release blockers are an operated primary/failover RPC, backup/restore proof, alerts, an incident runbook, and actual Nimiq Pay CSP/WebView validation. The free database expires on 2026-10-16 and the free web service cold-starts after inactivity. The current rate limiter is process-local, so staging must remain single-instance and any later multi-instance release needs a shared store.

## Next milestone

Open `https://nimreturn-staging-cycle2.onrender.com` inside Nimiq Pay and run the consolidated physical Phase 0–5 checklist. Fix only observed failures, repeat affected cases, then replace the development RPC and complete backup/alert/runbook proof for the public judge build. Do not begin the Phase 6 real-user pilot without a new explicit instruction.
