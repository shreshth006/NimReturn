# Testing strategy

## Testing doctrine

Tests prove claims at the layer where they can be proven. Pure tests prove canonicalization, signatures, state machines, money parsing, eligibility, and transaction matching. Integration tests prove API/database atomicity and RPC adaptation. End-to-end tests prove screens/reload/error recovery. Only an actual Nimiq Pay device proves provider injection, native approvals, host preprocessing, WebView lifecycle, and real NIM transaction interoperability.

No phase is complete because the happy path compiled. Every critical negative case must fail closed with a stable error/state and no partial success record.

## Test layers

### Unit

- protocol token/tag encode/decode and byte length;
- RFC 8785 canonical serialization and domain prefix fixtures;
- hex/address normalization and official-core signature verification;
- NIM decimal-string ↔ integer Luna parsing without floating point;
- payment/refund evidence matcher;
- eligibility boundary arithmetic;
- legal state transition reducer;
- SDK thrown-error and returned-`ErrorResponse` normalization;
- Promise Ledger pure definitions/aggregation where practical.

Unit tests contain deterministic local key fixtures created only inside test files. They are not funded, not production values, and never imported by production modules.

### Integration

Run API against disposable PostgreSQL and a controllable fake RPC transport (not a fake production success route). Test migrations/constraints, challenge consumption, transaction hash registry, idempotency replay, concurrent requests, rollback, derived ledger queries, and verifier retry state. A separate optional network suite can query TestAlbatross and is never required for hermetic CI.

### End-to-end

Phase 1 exercises the production HTTP adapters through real PostgreSQL for draft → challenge → valid proof → publish → verified public read → changed terms → v2, including wrong-resource rejection, stale-bootstrap rejection, session authorization, and preserved v1 evidence. Browser checks cover the real draft/challenge API, reload-safe public challenge state, provider-unavailable honesty, public proof/history rendering, desktop/mobile layout, and runtime errors. A deterministic test key supplies API integration proof only; it does not claim wallet interoperability. Production bundles contain no mock provider switch.

Phase 2 integration exercises immutable active-policy capture, wallet cancellation/ambiguity transitions, hash reservation, absent/RPC-inconclusive/pre-final/invalid/final evidence, chain-derived buyer identity, concurrent and repeated verification, one immutable Passport, public policy/chain reprojection, and append-only reconciliation exception/recovery. Unit coverage proves strict sender-free API bodies and public-only reload storage. None is physical Nimiq Pay evidence.

### Actual-device Nimiq Pay

Test current supported iOS and Android versions on TestAlbatross over HTTPS (local-network HTTP only for documented development where supported). Capture app/OS/SDK version, UTC time, account address, message hash, public key, signature, transaction hash, network, result, and sanitized screenshot/log. Never record a seed phrase/private key.

## Required scenarios

### Provider/account

- **T-001 Wallet provider unavailable — PASS (project lead, Android, 2026-09-16):** the ordinary browser failed safely with “Open this page inside Nimiq Pay and retry”; the same HTTPS staging page reported the injected provider ready inside Nimiq Pay.
- **T-002 Account permission rejected — PASS (project lead, Android, 2026-09-16):** cancelling the native first-access request on a fresh isolated HTTPS origin left a safe non-success account state with retry available; approving the retry returned the account list and restored readiness. No wallet identifiers are retained in Git.
- **T-003 No accounts/returned SDK error value:** actionable state, no unsafe array assumption.
- **T-004 Multiple accounts:** an expected account can be selected for diagnostics, but cryptographic signer identity comes from the returned public key; listed-membership and expectation-match are reported separately.
- **T-005 Wallet head without consensus:** provider/head remain visibly reachable, consensus is false, retry is offered, and the native payment request stays locked.

### Policy signing

- **Phase 1 physical signing/publication — PASS (project lead, Android, 2026-09-16).**
- **Phase 1 physical v1→v2 validation — PASS (project lead, Android, 2026-09-16):** later versions published with distinct terms and hashes while v1 stayed a preserved verified policy.
- **Merchant session recovery (D-033):** after a lost `HttpOnly` merchant session, **Reconnect policy signer** restored access only through a one-time challenge signed by the established policy signer; automated tests cover wrong signer, altered bytes/hash, expiry, replay, malformed proof, and cross-merchant nonce rejection.
- **Bootstrap-expiry recovery — addressed:** the first Phase 1 Android attempt remained on the terms screen past the unpublished draft's 15-minute authorization lifetime. The server correctly returned `MERCHANT_AUTH_REQUIRED` and issued no signing bytes. The client now hides the unusable form, explicitly discards only the stale local workspace pointer, prefills non-secret product fields for a fresh protected draft, and displays the first-publication deadline. This observed recovery path remains part of the pending Phase 1 physical signing/publication result.
- **T-010 Policy signature cancelled:** policy remains pending/draft and retry issues or safely reuses challenge per expiry rules.
- **Version-editor navigation — addressed:** after the first verified v1 phone publication, the v2 action revealed the terms form above the long public-proof card without moving the mobile viewport. The action now focuses and scrolls to the newly mounted **Set the promise** heading. This UX regression does not alter version state and remains covered by the pending physical v1→v2 result.
- **T-011 Signature invalid:** rejected; policy cannot become active.
- **T-012 Policy altered after signing:** byte/hash mismatch rejected; stored verified row update denied.
- **T-013 Policy signer binding:** first valid proof derives and atomically establishes the merchant policy signer; a later valid proof from another key is rejected. A different signed settlement address is allowed and never treated as signer authority.
- **T-014 Known-good core vector:** exact message verifies and derives correct address.
- **T-015 Tampered message/signature/public key:** each independently fails.
- **T-016 Canonicalization:** key order/input formatting yields same challenge; Unicode normalization and forbidden controls follow spec.
- **T-017 Nimiq Pay interoperability:** device `sign()` artifact verifies with exact Nimiq signed-message framing (`\x16Nimiq Signed Message:\n`, decimal UTF-8 byte length, SHA-256) and address binding; no raw-message fallback.
- **T-018 Hub non-equivalence guard:** any Hub fixture tagged as another scheme is not accepted as Mini App NR1 without explicit support.

### Payment and transaction verification

- **T-020 Payment cancelled — PASS (project lead, Android, 2026-09-16):** the first attempt exposed a bridge-normalization bug and conservatively persisted `submission_outcome_unknown`. After regression coverage and the focused fix for documented callback code `4001`, `USER_REJECTED`, permission-denied, and cancel string/object shapes, the physical retest showed `CANCELLED`, stated that nothing was approved, and kept a deliberate retry available. The approved retry returned one hash and the server RPC verified exact fields, successful execution, and macro finality; that observation supports Phase 0 but does not independently close any named Phase 2 result.
- **T-021 Payment pending/mempool:** visible `pending-inclusion`; the completed lookup leaves “Check again” enabled; no passport.
- **T-022 Payment failed/evicted/invalid:** visible failure or exceptional recovery; no passport.
- **T-023 RPC unavailable/timeout/malformed:** inconclusive and retryable; no client fallback; only an actively running HTTP request disables the retry control.
- **T-024 Wrong network:** rejected.
- **T-025 Sender authority:** no sender is invented in the wallet/API expectation; malformed observed sender evidence is rejected and original buyer identity comes from the verified chain sender.
- **T-026 Wrong recipient:** rejected.
- **T-027 Wrong amount:** off by one Luna and overpayment both rejected for NR1.
- **T-028 Wrong transaction data:** wrong version/type/token, suffix, whitespace, invalid UTF-8 rejected.
- **T-029 Duplicate purchase hash:** same order exact retry returns stored result; different order conflicts.
- **T-030 Hash used as refund then purchase (and inverse):** shared registry rejects.
- **T-031 Reload while verifying:** strict session-storage parsing restores the same public transaction context and resumes RPC verification without another wallet request; no private/recovery material is stored, and unresolved/ambiguous records require explicit confirmed clearing.
- **T-032 Concurrent verifier success:** one purchase transaction/passport/event.
- **T-033 Execution/finality/reorg:** `executionResult: false` is invalid; confirmations never substitute for the following Albatross macro block; pre-macro inclusion is `pending-finality` with “Recheck finality” enabled; reached macro finality passes; reorg reconciliation enters safe exceptional state.
- **T-034 Data size:** purchase/refund tags are exactly expected and <64 bytes.
- **T-035 Actual-device transaction:** native dialog shows correct recipient/value/data; returned hash is found and independently matches.

### Claims and eligibility

- **T-040 Claim authorization:** self-authorization requires observed equality between the proof-derived claim signer and chain-derived purchase sender; a distinct signer requires an exact-claim authorization proof derived to the purchase sender. Cover both accepted paths plus missing/unrelated/altered/replayed/expired authorization rejection. No test may treat a client-selected account as proof.
- **T-041 Claim signature invalid/altered:** rejected and nonce handling follows retry policy.
- **T-042 Claim outside policy window:** ineligible with exact rule reason.
- **T-043 Boundary-time claim:** exact deadline eligible; deadline +1 ms ineligible.
- **T-044 Claim before purchase timestamp:** rejected/ineligible as invalid chronology.
- **T-045 Zero policy window:** claim type unavailable.
- **T-046 Duplicate/replayed claim:** same idempotency request stable; nonce/resource replay rejected.
- **T-047 RETURN vs WARRANTY:** correct signed duration selected.
- **T-048 Historical policy:** claim uses purchase-bound version after product policy changes.
- **T-049 RPC/database outage during submit:** no half-consumed challenge/partial claim.

### Merchant resolution

- **T-050 Resolution signature invalid or wrong policy signer:** rejected even if the proof signer equals the settlement address.
- **T-051 Resolution payload altered:** rejected.
- **T-052 Duplicate exact resolution:** idempotent; no duplicate event.
- **T-053 Conflicting second resolution:** conflict; first remains unchanged.
- **T-054 Approved refund amount wrong/partial:** challenge or submission rejected in NR1.
- **T-055 Rejection:** visible historically, no refund falsely expected.

### Refund

- **T-060 Refund cancelled:** remains approved/refund pending; not refunded.
- **T-061 Refund pending:** visible, retry verification without new payment prompt.
- **T-062 Wrong sender:** any sender other than the purchase-bound signed settlement address is rejected.
- **T-063 Wrong recipient:** any address except original chain buyer rejected.
- **T-064 Wrong amount:** one-Luna difference, partial, or over-refund rejected.
- **T-065 Wrong data/claim tag:** rejected.
- **T-066 Duplicate refund hash:** exact retry idempotent; another claim/purpose conflicts.
- **T-067 Refund RPC failure:** inconclusive; approval preserved; no refund success.
- **T-068 Reload during refund:** same hash/state recovered and no second refund requested.
- **T-069 Verified refund:** one row, lifecycle complete, ledger paid count increments once.

### Immutability and Promise Ledger

- **T-070 Historical policy remains immutable:** API and direct runtime-role SQL update/delete fail; old passport unchanged after new policy.
- **T-071 Ledger cannot be manually forged:** no write route/grant; attempts fail.
- **T-072 Definitions:** eligible/ineligible, approved/rejected, paid/pending, unresolved counts are mutually accurate on mixed fixture set.
- **T-073 Median resolution:** odd/even/empty sets and UTC intervals correct.
- **T-074 Reconciliation:** injected mismatch is detected and alerted, not hidden by editing metric.

### UX, accessibility, reliability

- **T-080 Critical states:** all required labels render distinctly and screen-reader status announces transitions once.
- **T-081 Slow/retry/double tap:** primary action locks appropriately; idempotent recovery works.
- **T-082 Mobile widths/safe areas/text zoom:** no clipped action, overflow, or evidence loss at 320–430px and 200% zoom.
- **T-083 Keyboard/focus/reduced motion/contrast:** WCAG checks plus manual inspection.
- **T-084 First-minute test:** new user accurately explains promise and reaches main point within 60 seconds without instructions.

## Phase 0 automated acceptance

- Provider adapter typechecks against the installed 0.1.0 SDK and treats error unions safely.
- Official-core framed known-good signature verifies; wrong message, single-byte mutation, wrong key/address, malformed key/signature, and raw-message signature fail; Unicode uses UTF-8 byte length and the NR1 BLAKE2b payload hash stays stable.
- Canonical message and transaction tags have stable fixtures.
- Diagnostic screen can test provider ready, accounts, sign, local verification/address binding, consensus/head, direct payment-with-data, and server transaction lookup.
- Diagnostic screen exports `nimreturn.phase0.evidence.v2` with provider availability, wallet-listed accounts, account-independent network snapshot/timestamp, expected versus cryptographically derived signer facts, exact signing message/UTF-8 hex, public proof/digests, sender-free transaction expectation, observed chain sender/membership/fields/execution/finality, outcome, and device versions. No secret key material is collected.
- Server lookup accepts only validated hashes and reports unavailable configuration/failure without fabrication.
- Lint, typecheck, unit tests, and production build pass.

The private checksum-bound Android 16/Nimiq Pay 2.19.1 artifact recorded on 2026-09-14 closes actual-device T-017 and T-035 without placing identifiers in Git. D-016 accepts Android-only Cycle II target-device validation and explicitly leaves iOS untested. T-001, T-002, and T-020 passed by explicit project-lead reports on 2026-09-16. Together with the preserved signing and independent chain/finality artifact, these results close Phase 0.

D-022 corrects an earlier interpretation of pass-like prompt wording: T-001, T-002, T-020, Phase 1 physical signing/publication, and physical v1→v2 validation were restored to open/pending until individually performed and reported. T-001, T-002, and T-020 have since been explicitly reported PASS; both Phase 1 physical cases were later explicitly reported PASS on 2026-09-16 (D-034). Automated tests, CI, browser checks, code completeness, simulated proofs, and the earlier Android cryptographic evidence did not close those Phase 1 gates.

D-023 permits Phase 2 implementation and batches the open Phase 0/1 checks with the later Phase 2 physical purchase/Passport suite. This scheduling deferral does not change any scenario outcome; only the project lead's explicit result after personally performing each device test may do so.

Phase 3 self-authorized claim — **RETEST REQUIRED:** the first Android attempt created the exact claim challenge and the wallet signed it, but the client added a display-only `signerAddress` to the strict four-field proof envelope, so local validation failed before submission and nothing reached the server. The envelope builder is now separate and regression-tested against the real submit call and server verifier. The unsigned challenge then expired and blocked a new claim of the same type through `claims_one_active_type_per_passport`; migration 0013 lets only an unsigned claim past its expiry move to `expired`, excludes it from that index, and the buyer UI offers **Start a new claim**.

Phase 3 delegated claim — **RETEST REQUIRED:** on a second Android purchase, the active Nimiq Pay account was the merchant's policy-signing account, so the claim was correctly accepted only as delegated and required purchase-wallet authorization. The authorization attempt was again signed by the merchant account and correctly rejected. The client now names the signing and required accounts before submitting, the signing card tells the buyer which account gives direct acceptance, and a lapsed 10-minute authorization can be renewed (a new challenge for the same verified claim) instead of leaving the claim stuck in `authorization_pending`.

Phase 3 wallet account routing — **observed, design changed (D-035):** the Android diagnostics listed two wallet accounts; payments came from one and every signature (policy, claim, authorization, diagnostic) from the other, with no account selection. Claims now use a purchase claim key signed before payment. A new Phase 2 purchase and Phase 3 claim must be retested physically.

Phase 4 refund routing — **observed, design changed (D-036):** the first physical refund request returned no hash and nothing reached the chain. Chain history showed Nimiq Pay pays from a hashed-timelock contract owned by the signing account, so a refund can never come from the signed settlement address. Claim-key purchases are now refunded to the claim key with the sender recorded as evidence, and an unknown refund outcome can be recovered from chain history or ruled out after the validity window. PostgreSQL tests cover wrong recipient, amount, and tag, reused hashes, forged recipients, early or evidence-backed rule-outs, incomplete history, RPC failure, and recovery. A physical refund retest is required.

Phase 2 physical results so far: **reload/recovery — PASS** and **mobile/accessibility — PASS** (project lead, Android, 2026-09-16). Real buyer payment, independent chain verification, and Purchase Passport creation await explicit results; the first-minute test is deferred until an unbriefed observer is available.

The Phase 2 automated suite passes T-021 through T-029 and the implementation portions of T-031 through T-033, including a simulated finalized-evidence regression. T-020 is complete; all named Phase 2 actual-device results remain open. The exact consolidated procedure is `docs/evidence/consolidated-device-validation.md`.

The Phase 3 automated suite passes the implementation portions of T-040 through T-055: both claimant-authority paths, strict proof failures, inclusive eligibility boundaries, purchase-bound historical policy, atomic outage behavior, protected merchant review, policy-signer-only decisions, idempotent/concurrent finality, and approved-versus-paid copy. Pending resolution drafts are not public. Actual-device equal/distinct-account signing, resolution signing, reload, and mobile behavior remain open under D-029's corrected boundary record.

The Phase 4 automated suite covers immutable server-derived refund expectations; strict merchant ownership; cancellation, unknown-outcome, recovered-hash, pending, failure, and finalized states; exact sender/recipient/value/data/network/execution/finality checks; global hash replay rejection; idempotent and concurrent verification; the atomic Passport-refunded transition; immutable transaction evidence; append-only reconciliation; and strict frontend/session response parsing. Actual-device settlement-account routing, native cancellation, real-chain finality, WebView recovery, and mobile behavior remain open.

The Phase 5 automated suite passes T-071 and T-072 and the automated portions of T-073/T-074. A mixed PostgreSQL fixture reconciles 3 verified purchases; 4 filed claims split into 3 eligible/1 ineligible; 2 approved/1 rejected/1 unresolved; 1 refund pending/1 verified refund; and a three-resolution timing sample. Runtime-role `INSERT`/`UPDATE`/`DELETE` fail, no mutation route exists, and a latest reconciliation exception appears then clears after a newer confirmed recheck without rewriting history. Strict route/client schemas, reconciliation invariants, empty/error/retry states, cache/rate limits, and production bundle splitting are also covered or inspected. T-080 through T-084 retain manual/device portions; automated UI code and bundle output do not close them.

The staging package is separately checked by building both pinned container targets, validating the Caddy configuration, inspecting static cache/security headers, parsing Compose with non-secret placeholders, starting the production API image against local PostgreSQL, and requiring production configuration to include an RPC. `server/deploy/preflight.ts` additionally fails unless the public origin and RPC use HTTPS, the API reports Phase 5, the database login is a non-privileged `nimreturn_runtime` member with no ledger write privilege or public-schema creation, the OG card is available, and the RPC reports TestAlbatross plus a safe head height. On 2026-09-16 the live Render origin `https://nimreturn-staging-cycle2.onrender.com` returned `ready-for-device-test` with all of those checks true; separate public smoke checks proved the hydrated merchant screen, database-backed 404 behavior, RPC diagnostic, OG image, CSP, HSTS, permissions, referrer, and content-type headers. These checks prove staging readiness only, not Nimiq Pay interoperability.

## Test data rules

- Keys are generated at test runtime or labeled deterministic fixtures with no funds/use outside tests.
- Never copy a real user's note, address relationship, or authenticated RPC response into the repository without sanitization and consent.
- Keep authoritative device evidence and checksum files outside the repository. Public summaries may record non-identifying outcomes and the SHA-256 digest, but never full addresses, hashes, public keys, signatures, nonces, tags, user agents, or raw JSON.
- Network tests use TestAlbatross and a dedicated low-risk wallet.
- Fixtures name source, protocol/SDK/core version, and whether they are synthetic or actual-device.
- Production code has no environment flag that returns fixtures as verified evidence.

## Smoke test

On each deploy: `/health`; frontend load; provider-unavailable fallback in normal browser; Nimiq Pay provider init; account cancellation; one read-only consensus/head check; API/RPC readiness; open a known historical Passport and re-verify evidence; create no mainnet transaction merely for automated smoke. Testnet release candidate includes one low-value purchase and refund.

## Pre-submission checklist

- [ ] Clean install reproduces lint/typecheck/test/build.
- [ ] Dependency/license/secret scans pass.
- [ ] All required scenario IDs are passing or explicitly evidenced manually.
- [ ] Actual Nimiq Pay Android purchase→claim→refund run captured on the current release; iOS remains a separate pre-mainnet requirement under D-016.
- [ ] Cancellation, background/resume, reload, network loss, RPC loss tested on device.
- [ ] Mainnet pilot uses intentionally low amounts and correct network/addresses.
- [ ] No mock/test provider in production build.
- [ ] Mobile accessibility/performance and first-minute usability tested with people outside team.
- [ ] Promise Ledger counts reconciled with pilot source events.
- [ ] Privacy/security launch checklists signed off.
- [ ] Submission build/URL re-tested immediately before portal submission.
