# Operational status

Last updated: 2026-09-17 (IST)

## Current phase

**Phase 5 — Promise Ledger + polish: experimental/code-complete at the manual and deployment boundary.** D-030 records the project lead's explicit Phase 5 instruction. Its verified-evidence projection, judge-facing lifecycle, reconciliation visibility, responsive/accessibility implementation, frontend splitting, and automated security controls are complete. Phases 0 and 1 are complete. A full purchase → claim → approval → refund run passed on Android on 2026-09-17 after D-035/D-036; Phases 2–4 keep only their recorded remaining physical checks. No later physical, accessibility, first-minute, or deployment result is inferred from code, automation, or prior prompts. Phase 6 has not started.

## Completion by phase

- Phase 0 — Technical proof: **100% complete** (prior Android signing and independent chain/finality proof plus explicit project-lead PASS reports for T-001, T-002, and T-020).
- Phase 1 — Policy + Merchant: **100% complete** (explicit project-lead PASS reports for physical signing/publication and v1→v2 validation on 2026-09-16; D-034).
- Phase 2 — Purchase Passport: **95%** (all physical results PASS by explicit project-lead reports on 2026-09-16/17 except the deferred first-minute test).
- Phase 3 — Claims: **95%** (self-authorized claim, distinct-signer authorization via the D-035 purchase claim key, and merchant resolution PASS on Android 2026-09-17; claim/resolution reload and mobile/accessibility pending).
- Phase 4 — Refund: **93%** (independent refund verification PASS on Android 2026-09-17 under D-036; native cancellation, reload/recovery, and mobile/accessibility pending; settlement-sender routing superseded).
- Phase 5 — Promise Ledger + polish: **90% experimental/code-complete** (derived ledger, judge surface, polish, and automated gates complete; manual accessibility/device/first-minute testing and production operations pending).
- Phase 6 — Real pilot: **0%**.
- Phase 7 — Competition submission: **5%** (strategy/checklist drafted; no assets or submission).

The public Promise Ledger explanation and current protocol/submission documentation now match D-035/D-036: current purchases use the pre-payment claim key for claims and refunds and record the observed refund sender, while legacy purchases retain their settlement-sender/chain-buyer rule. These documentation corrections change no verification behavior or phase percentage.

Percentages are planning estimates, not earned rubric points.

## Phase 1 implementation

- The default React app is a responsive merchant studio: create product → set integer-Luna policy terms → review exact canonical challenge → grant wallet account access → sign through Nimiq Pay → locally verify framed bytes/signer/list membership → submit proof → re-read verified public policy.
- Production-configured Fastify routes create drafts, issue resource-bound challenges, publish only verified proofs, and expose a fail-closed public product projection with every verified historical policy version.
- The first signer is established only by a valid proof under a one-time 256-bit bootstrap stored as an `HttpOnly` cookie and a database hash. Successful publication consumes it and rotates to an eight-hour HMAC-authenticated merchant cookie. That cookie authorizes later challenge allocation only; every publication still requires the established wallet signer.
- Production requires `DATABASE_URL`, exact `CORS_ORIGIN`, and a server-only `SESSION_SECRET`. Writer routes have strict schemas, a 16 KiB body ceiling, exact production Origin checks, `SameSite=Strict`/`Secure` cookies, safe errors, redacted cookie logs, and per-IP rate limits.
- The public result makes protocol/version, cryptographic signer, separately signed settlement address, policy/server timestamps, terms, payload hash, public key, exact canonical message, and immutable version history visible.

## Phase 2 implementation

- The public product route now presents a buyer-focused verified-policy checkout. The API creates an expiring order whose merchant/product/policy version/hash, NR1 protocol, settlement recipient, integer-Luna price, and `NR1:P:<order>` tag are server-derived and immutable.
- Before payment, the buyer signs a D-035 purchase claim key over that exact unpaid order. The key is proof-derived, immutable, and required before the order may enter `wallet_request_started`; wallet account listings never create claim authority.
- The client calls the documented Nimiq Pay payment surface with recipient, integer value, data, and validity height only. It never submits or persists a sender claim; the independently observed chain sender becomes the order buyer.
- Hash attachment reserves one global network/hash binding. Absent, mempool, included/pre-macro, RPC-inconclusive, invalid, and finalized evidence stay distinct. Only matching network/recipient/value/data, `executionResult=true`, and following-macro finality create one purchase transaction and one Passport atomically.
- Session storage contains only public product/order IDs and an optional returned hash. A saved hash resumes attachment/recheck without another wallet request. Explicit cancellation creates no Passport and can retry; a hashless ambiguous native outcome blocks another payment.
- The public Passport re-verifies its purchase-bound historical policy and stored normalized chain evidence before display. It shows chain buyer, recipient, exact Luna/data/hash, purchase timestamp, execution, macro/head finality, policy signer/version/hash/terms/deadlines, and explains that later policies cannot rewrite the purchase.
- Rechecks append immutable reconciliation records. A prior finalized record that regresses or changes produces a public `verification_exception`; RPC absence/outage is separately inconclusive and never rewrites the original evidence.

## Phase 3 implementation

- D-025/D-035 close the claimant-authority design gate without assuming wallet account selection: the chain sender can self-authorize, the pre-payment purchase claim key can authorize, and the older exact-claim delegation remains available where the chain sender can sign.
- Production claim routes issue immutable RETURN/WARRANTY challenges, verify exact proofs and authority, evaluate the purchase-bound policy at an inclusive deadline, and expose a reload-safe public claim projection. Unrelated, altered, expired, replayed, duplicate, and invalid proofs fail closed.
- The protected merchant queue includes only authorized/evaluated claims. Resolution challenges bind decision, reason, note, full approved purchase value, claim, timestamp, nonce, and original policy signer. Only that signer can publish one final approve/reject result.
- Pending merchant decisions remain private and recover only through the authenticated merchant endpoint; buyers read only verified resolutions. Approval is visibly distinguished from a paid refund.
- The buyer journey supports claim creation, exact Nimiq Pay signing, distinct-signer authorization, eligibility evidence, reload recovery, and verified decision display. The merchant journey supports queue review, exact decision signing, pending recovery, and a judge-visible signer/hash receipt.

## Phase 4 implementation

- A verified approved resolution creates an immutable, server-derived refund expectation. D-035 purchases refund the pre-payment claim key and record the observed sender; legacy purchases retain the settlement-sender/original-buyer rule. Both bind the full approved integer-Luna value, configured network, and exact `NR1:R:<claim-id>` tag. The merchant session allocates workflow state but is never payment authority.
- The merchant refund journey distinguishes requested, native-wallet started, cancelled, hashless unknown, verifying, pre-finality pending, failed, and independently verified states. Cancellation permits a fresh attempt; an unknown native result is recovered only from exact recipient/tag chain history or ruled out after the validity window plus margin.
- Refund verification independently fetches the chain transaction and requires the applicable D-036 sender/recipient rule plus exact network, value, data, successful execution, and following-macro finality. Wrong fields fail closed, global network/hash uniqueness prevents replay, and concurrent exact verification is idempotent.
- Only finalized matching evidence creates the immutable refund transaction and moves the Purchase Passport from active to refunded. The signed claim resolution remains approved; buyer copy separately reports refund pending, failed, or verified.
- Post-finality rechecks append confirmed, inconclusive, or exception evidence without rewriting the accepted refund. The public buyer view shows the exact expectation and finalized proof while protected mutation routes remain bound to the owning merchant session.

## Phase 5 implementation

- Security-barrier PostgreSQL views derive the Promise Ledger from verified purchases, accepted and evaluated claims, verified policy-signer resolutions, verified refunds, and the latest append-only reconciliation outcomes. No table accepts merchant-edited counts.
- The public `GET /api/v1/merchants/:merchantPublicId/promise-ledger` route strictly parses public IDs, enforces reconciliation invariants and safe-integer counts, exposes definitions/sample sizes/`as_of`, is rate-limited, and has a short public cache policy. There is no metric mutation route.
- The restricted runtime role has `SELECT` only on ledger views. Mixed PostgreSQL fixtures prove all categories, odd/empty timing samples, immutable source reconciliation, exception appearance/recovery, and failed `INSERT`/`UPDATE`/`DELETE` attempts.
- The public merchant proof surface tells the one-minute policy → payment → Passport → claim → decision → refund → ledger story. It explicitly distinguishes cryptographic attestations from monetary chain evidence and policy signer, settlement address, purchase sender, claim signer, and refund sender.
- Ratings, reviews, subjective reputation, AI assessments, trust scores, manually editable metrics, and unsigned wallet-open telemetry are absent by design. Privacy and immutable-version explanations accompany the evidence.
- Loading, failure, retry, and empty states were strengthened across policy, claim, refund, and ledger surfaces. Progress semantics, focus states, 44-pixel action targets, pressed/current-state announcements, reduced-motion behavior, and 320-pixel responsive rules are implemented, but manual WCAG/device evidence remains open.
- A minimal public Passport lifecycle joins verified claims, signed decisions, and independently verified refunds without enumerating free-text claim notes. An optional completed-example link is emitted only for a configured refunded Passport that passes a fresh fail-closed server read.
- Every wallet signature/payment action checks consensus and compares the Nimiq Pay head to the configured verifier-network head before opening a native prompt. This is a fail-closed wrong-network heuristic necessitated by the SDK's non-discriminating network label; final authority remains the server's exact-network chain verification.
- Route-level lazy loading keeps the initial production JavaScript at 216.69 kB raw/68.12 kB gzip; the Promise Ledger route is 13.44 kB raw/4.13 kB gzip. The 1.11 MB WASM payload remains isolated to routes that need Nimiq cryptography.

## Build and test status

Local Node 24.13.1/npm 11.8.0 gates pass on 2026-09-17: `npm run lint`, `npm run typecheck`, 215 hermetic tests, all 32 PostgreSQL-backed tests (247 total), and `npm run build`. The production dependency audit reports zero known vulnerabilities. GitHub Actions run `35167099687` passed the same lint/typecheck/test/build gate for `ed3c6fc`.

Phase 5 coverage includes strict ledger API/client parsing, mixed-evidence reconciliation, runtime-role immutability, timing samples, exception visibility/recovery, and health/cache/rate-limit coverage. Production configuration now also fails closed without RPC, and the staging package has validated API/web image builds, Caddy configuration, headers/cache policy, Compose interpolation, and a local containerized API smoke test.

## Manual verification

- In the local in-app browser, the real API/PostgreSQL path created a merchant/product and issued an exact v1 canonical challenge. A normal browser correctly stopped at “Open this page inside Nimiq Pay” and did not fabricate publication.
- A deterministic test-only proof produced public v1 and v2 records. The frontend independently read them through the fail-closed API and visibly showed v2 active plus v1 preserved, with distinct hashes and terms.
- Desktop and 375 CSS-pixel mobile layouts were inspected; the mobile document had no horizontal overflow and the tested page emitted no console warning/error. This is not a substitute for Nimiq Pay or full accessibility evidence.
- The project lead explicitly reported **T-001 PASS** after an ordinary-browser provider failure recovered on the same staging page inside Nimiq Pay, **T-002 PASS** after cancelling and safely recovering the native first-access account-permission request on a fresh HTTPS origin, and **T-020 PASS** after the patched staging build surfaced native payment rejection as cancelled with no approval and kept a deliberate retry available. Automated, CI, browser, code-completeness, simulated, and earlier cryptographic results are not substitutes for those later gates.
- The project lead explicitly reported **Phase 1 physical signing/publication PASS** and **Phase 1 v1→v2 physical validation PASS** on 2026-09-16, after the D-033 signer-bound session recovery was deployed.
- The first Phase 1 phone attempt left the unpublished draft open beyond its 15-minute bootstrap lifetime. The server correctly refused to issue signing bytes, and the focused recovery patch added an explicit local-draft discard/start-over action. The later Phase 1 physical signing/publication PASS includes the recovered path.
- The first verified v1 phone publication exposed a mobile navigation issue: **Change terms · create v2** revealed the editable terms above the long public-proof card but left the viewport at the button, making the action appear inert. The focused patch moves keyboard focus and the viewport to the newly revealed **Set the promise** heading; no policy state or versioning rule changes.
- After verified v1, the Android WebView kept the public workspace but lost the protected merchant session, so v2 failed with `MERCHANT_AUTH_REQUIRED`. D-033 stops clearing the consumed bootstrap cookie during rotation and adds **Reconnect policy signer**: a five-minute, one-time, origin-bound challenge that must be signed by the established policy signer. After deployment and migration 0012, the physical run restored access and published later versions while v1 stayed preserved.
- The project lead explicitly reported **Phase 2 buyer payment, independent chain verification, Passport creation, reload/recovery, and mobile/accessibility PASS** on Android across 2026-09-16/17. Only the unbriefed first-minute test remains deferred.
- The project lead explicitly reported **Phase 3 self-authorized claim, distinct-signer authorization through the D-035 purchase claim key, and merchant resolution PASS** on Android 2026-09-17. Claim/resolution reload and mobile/accessibility remain open.
- The project lead explicitly reported **Phase 4 independent refund verification PASS** on Android 2026-09-17 under D-036. Settlement-sender routing was superseded, not passed; native cancellation, reload/recovery, and mobile/accessibility remain open.
- The temporary Render staging origin loads and hydrates in a normal browser with no captured console warning/error; its HTTPS/API/database/RPC/security-header preflight passes. This is deployment readiness evidence only. No Phase 5 physical/mobile/accessibility, Promise Ledger lifecycle reconciliation, or unbriefed first-minute result is claimed.

## Dual-network commerce (2026-09-18 to 2026-09-24)

Chain reads now route through a per-network registry: every read names the network of the
record it verifies, a network without a configured node fails closed, and a node reporting a
different chain than it is configured for is not trusted for that chain (D-039). Migration
0016 gives every product its own network, so a purchase is always recorded and verified on
the product's chain and a wallet on another chain is refused before anything is signed.
`/api/v1/network` reports every verified chain, and the client identifies which one a wallet
is on by matching its head, because Nimiq Pay reports only the constant name `nimiq`.

Mainnet verification is configured against the public community node `rpc.nimiqwatch.com`.
That node is trusted infrastructure, not proof; the boundary and the intended second-source
cross-check are recorded in D-039.

D-040 lets an established merchant session add further products, because a merchant is one
wallet and a product could previously only be created by creating a merchant. The merchant
identity stays chain-agnostic. On 2026-09-24 the project lead used it to publish
**Neutron Collider v1 on MainAlbatross** (1,000 Luna, 16-day returns, 365-day warranty) from
the same wallet that owns the TestAlbatross `Cap` product; both are live and the testnet
completed example is untouched. No mainnet purchase exists yet: the lead holds no mainnet NIM
and every public faucet found was offline.

## Deployment and RPC

Temporary staging is live at `https://nimreturn-staging-cycle2.onrender.com` on commit `ed3c6fc`, backed by one free Render Docker service and managed PostgreSQL instance in Singapore. The database expires on 2026-10-16. Render supplies HTTPS and a generated session secret. Migrations ran with the database owner; the app uses a separate `nimreturn_app` login that inherits only `nimreturn_runtime`, cannot create in `public`, has no admin attributes or owned relations, and cannot mutate either Promise Ledger view. Public checks pass for the app, `/health`, the OG image, a database-backed 404, CSP/HSTS and related headers, and the RPC diagnostic. A server-only configured real refunded Passport passes fresh reprojection and powers the no-wallet completed-example journey; its identifier and raw evidence are not stored in Git. The Android lifecycle passed through this HTTPS/WebView/CSP deployment. The configured public development RPC has no SLA and is not an operated production primary/failover verifier; the free service may cold-start after inactivity.

## Current blockers

- **Phase 0 closed:** T-001, T-002, and T-020 passed by explicit project-lead reports on 2026-09-16. The first T-020 attempt exposed a non-`Error` rejection compatibility bug; after the focused normalizer fix, the physical retest showed the native rejection as cancelled with nothing approved and a safe retry available. The prior private Android artifact already proves exact signing bytes/address binding and one independently retrieved matching transaction with successful execution and following-macro finality. No private wallet or proof material is stored in Git.
- **Phase 1 closed:** physical signing/publication and v1→v2 validation passed by explicit project-lead reports on 2026-09-16 (D-034).
- **Phase 2 exit:** only the deferred first-minute test remains.
- **Phase 3 exit:** claim/resolution reload and mobile checks remain.
- **Phase 4 exit:** native refund cancellation, refund reload/recovery (including ruling out the earlier unknown-outcome attempt after its validity window), and mobile checks remain. Nimiq Pay does not send from the settlement address; D-036 records the claim-key refund rule that replaced that requirement.
- **Phase 5 exit:** the manual WCAG/device matrix, Promise Ledger reconciliation against the real lifecycle, five unbriefed first-minute tests, and production operations criteria remain open.
- **Deployment:** temporary HTTPS staging, managed database credentials, generated session secret, and a working public TestAlbatross development RPC are provisioned. Remaining release blockers are an operated primary/failover RPC, backup/restore proof, alerts, and an incident runbook. The free database expires on 2026-10-16 and the free web service cold-starts after inactivity. The current rate limiter is process-local, so staging must remain single-instance and any later multi-instance release needs a shared store.

## Competition state

The Cycle II submission was merged into the public showcase on 2026-09-18. Winners are
announced on 2026-10-02, and the live app is tested during that window, so work after the
deadline still counts. Availability is automated: UptimeRobot every five minutes and a
GitHub Actions ping every ten keep the free instance awake, after a cold visit was measured
at 23.4 seconds to first byte. Deploys are deliberate and one command (`npm run deploy`
equivalent: the `deploy.yml` workflow), which refuses to run when a schema change is not yet
migrated. `npm run audit:ux` walks every screen at phone size and `npm run audit:style`
guards the design vocabulary; both are clean.

## Next milestone

Highest priority is real usage before 2026-10-02: a third party completing a purchase on
either chain. The mainnet product exists for buyers who hold NIM; testnet remains free and
the product page now explains where NIM comes from on each chain. Then continue the
consolidated Phase 2–5 physical checklist on `https://nimreturn-staging-cycle2.onrender.com` inside Nimiq Pay, fixing only observed failures. Replace the development RPC and complete backup/alert/runbook proof before the public judge build. Do not begin the Phase 6 real-user pilot without a new explicit instruction.
