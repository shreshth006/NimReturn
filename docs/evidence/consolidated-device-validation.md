# Consolidated Nimiq Pay device validation

Status: **PARTIAL — T-001 and T-002 passed by explicit project-lead reports on 2026-09-16. Every other item remains pending until personally performed and explicitly reported.**

This single TestAlbatross session covers the deferred Phase 0/1 gates and the Phase 2–5 physical/manual boundaries. Automated tests, CI, desktop browsers, deterministic keys, and implementation completeness do not satisfy it.

## Prepare once

1. Open the current staging origin, `https://nimreturn-staging-cycle2.onrender.com`, inside Nimiq Pay. HTTPS, migrations, the restricted runtime database login, and TestAlbatross RPC preflight passed on 2026-09-16. Record the deployed commit SHA shown in Render, UTC time, phone OS, Nimiq Pay version, SDK version, and core version. Wait through one free-tier cold start if necessary.
2. Use low-risk TestAlbatross accounts: one policy signer, one signed merchant settlement address (they may intentionally differ), and one funded buyer. Set a tiny exact price such as **1,000 Luna (0.01 NIM)**.
3. Keep raw addresses, public keys, signatures, canonical messages, transaction hashes, nonces, tags, JSON, and wallet screenshots outside Git. Repository evidence may contain only outcomes, versions, UTC time, redacted screenshots, and non-identifying checksums.

## Shortest exact run

### A. T-001 — provider unavailable and recovery

Status: **PASS — project lead, Android, 2026-09-16.**

1. Open the merchant page in the phone's ordinary browser and reach the wallet action.
2. Trigger it and wait for provider initialization to fail/timeout.
3. Confirm the UI says to open in Nimiq Pay, shows no success, and offers retry.
4. Open the same URL inside Nimiq Pay and retry. Confirm provider initialization succeeds without reloading fake state.

### B. T-002 — account permission cancellation and recovery

Status: **PASS — project lead, Android, 2026-09-16.** The completed run used a fresh isolated HTTPS origin so an earlier permission grant could not suppress the native first-access prompt.

1. Create the tiny product and request its canonical v1 policy challenge.
2. Tap **Sign with Nimiq Pay & publish**, cancel the native account-permission dialog, and confirm no policy is published/consumed.
3. Retry, approve account permission, and continue with the same still-valid challenge (or the newly issued challenge if it expired).

### C–E. Phase 1 physical signing, publishing, and immutable v2

1. Review v1's product, 1,000-Luna price, settlement address, return/warranty terms, version, timestamp, and payload hash; approve `sign()`.
2. Confirm publication succeeds only after local and server verification. On the public page confirm **Policy verified**, NR1, v1, proof-derived signer, separately signed settlement address, exact terms/timestamps/hash, and exact signed-message evidence.
3. Change one term, request v2, review the changed canonical bytes/hash, and approve `sign()` with the established policy signer.
4. Confirm v2 is active and v1 remains readable with its original terms/hash/signature. Confirm v1 was not overwritten.

### F. T-020 — native payment cancellation and safe retry

1. Open the public v2 buyer link and tap **Pay 0.01 NIM with Nimiq Pay**.
2. In the native dialog verify the exact merchant settlement recipient, **1,000 Luna / 0.01 NIM**, and exact `NR1:P:<22-character-order-id>` data; confirm no sender field was invented by NimReturn.
3. Cancel the native payment. Confirm the order says cancelled, no Passport exists, and retry is offered for that same order.
4. Retry once and approve the tiny payment. Do not initiate another payment after approval.

### G–H. Real chain verification and Purchase Passport

1. Confirm the UI progresses through submitted → chain verification → finality; pending/included must not appear verified.
2. After the following Albatross macro block, confirm exactly one Passport appears.
3. Independently look up the returned hash using a separate TestAlbatross explorer/node and compare: network, chain sender, signed settlement recipient, exact 1,000-Luna value, exact NR1 order tag, successful `executionResult`, inclusion block/timestamp, finalizing macro, and head at/after that macro.
4. On the Passport confirm the independently observed sender is the buyer, and confirm recipient/value/data/hash/timestamp/execution/finality all match the independent lookup.
5. Confirm the Passport shows the exact purchase-bound policy version/hash/signer/terms/deadlines and says later merchant policies cannot rewrite it. Confirm exactly one order, purchase record, and Passport exist after refresh/recheck.

### I. Reload/recovery and first-minute/mobile check

1. While the approved transaction is still pending or pre-macro, close/background Nimiq Pay, reopen the same public product URL, and refresh once.
2. Confirm the same public order/hash is recovered, no second native payment dialog opens, and **Check transaction again/Recheck finality** resumes verification.
3. If a test interruption occurs after the native request began but before a hash returns, confirm the UI blocks another payment and explains the unknown outcome; reconcile from Nimiq Pay history instead of paying again.
4. At 320–430 CSS pixels and 200% text zoom, confirm the primary action, policy evidence, progress, and Passport evidence remain readable without horizontal clipping. Check keyboard/focus and screen-reader status announcements where the device supports them.
5. With an unbriefed observer and a 60-second timer, confirm they can explain “merchant-signed terms + direct payment + independently verified Passport” and reach the payment action or completed Passport without instruction.

### J. Phase 3 self-authorized claim

1. From the verified Passport, create an available RETURN or WARRANTY claim and review its type, reason, claim time, purchase-bound policy version, and payload hash.
2. Sign the exact canonical claim with the same account that independently sent the purchase. Confirm the proof-derived claim signer exactly matches the chain-derived buyer, no second authorization is requested, and deterministic eligibility is displayed without promising a remedy.
3. Reload the Passport URL. Confirm the same public claim is recovered without another signature and the eligibility evidence remains identical.

### K. Phase 3 distinct-signer authorization

1. On a separate eligible fixture, sign the claim with an account different from the chain-derived buyer. Confirm it remains authorization pending and is absent from the merchant queue.
2. Review the exact second authorization: claim ID/hash, derived claim signer, required chain purchaser, nonce, and expiry. Sign it with the original purchase-sender account.
3. Confirm an unrelated account is rejected, while the exact purchase-sender proof authorizes only this claim and makes it eligible/ineligible once. If the wallet cannot select the necessary account, report FAIL; do not bypass the check.

### L. Phase 3 merchant resolution

1. In the protected merchant queue, confirm the authorized claim shows its true policy eligibility, signer/authorization mode, reason, and note. Confirm no pending unsigned decision is visible from the public claim URL.
2. Prepare an approval and confirm the canonical result uses the full original purchase value. Cancel once; reload and confirm the exact pending decision can be resumed only in the merchant session.
3. Sign with the original policy signer. Confirm a settlement-address signer or other account is rejected. Publish once and confirm the buyer sees the immutable signer, decision, reason/note, amount, timestamp, and hash.
4. For an approval, confirm the UI says **refund not yet paid**. On a second fixture, publish a signed rejection and confirm no refund is implied.
5. At 320–430 CSS pixels and 200% zoom, confirm claim, authorization, eligibility, queue, canonical evidence, and decision controls remain readable without horizontal clipping.

### M. Phase 4 direct refund and cancellation

1. On an approved low-value claim, open the protected merchant refund action and verify the displayed expectation: sender is the purchase-bound signed settlement address, recipient is the independently observed original buyer, value is the full approved purchase value, and data is exact `NR1:R:<claim-id>`.
2. Start the refund once and cancel the native payment dialog. Confirm the attempt says cancelled, the buyer still sees approved/not paid, no refund transaction exists, and a deliberate retry creates a fresh attempt.
3. Retry from the settlement account and approve exactly one payment. Nimiq Pay exposes no caller-selected sender: if the required settlement account cannot be used or the resulting chain sender differs, report FAIL and do not bypass verification or send another blind payment.
4. Confirm submitted/included/pre-macro states remain pending. After the following macro, independently retrieve the hash and compare network, settlement sender, original-buyer recipient, exact value, refund tag, `executionResult=true`, inclusion block/timestamp, finalizing macro, and head.
5. Confirm exactly one immutable refund record exists, the signed resolution still says approved, the Passport now separately says refunded, and the buyer view shows the exact verified chain evidence.

### N. Phase 4 recovery, replay, and mobile behavior

1. On a separate tiny approved fixture, background/reload after the native request begins. If no hash was returned, confirm another payment is blocked and the UI asks for recovery from wallet history; attach only the recovered 64-hex hash.
2. If a hash is returned before reload, confirm the same public attempt/hash resumes verification without another native dialog. Exercise recheck during an RPC outage and confirm it stays inconclusive/pending rather than paid or failed.
3. Confirm a wrong-sender or otherwise mismatched test hash is rejected and does not mark the Passport refunded. Confirm reusing any purchase/refund hash is rejected globally and double-submit/concurrent rechecks do not create a second refund.
4. At 320–430 CSS pixels and 200% zoom, confirm the merchant expectation, cancellation/recovery actions, pending/failure states, and buyer refund proof remain readable without horizontal clipping.

### O. Phase 5 Promise Ledger reconciliation

1. Open the public merchant Promise Ledger from the completed lifecycle. Confirm it is read-only and shows a visible `as_of` time, a definition and sample size for every metric, and no rating, review, trust score, AI assessment, or metric-edit control.
2. Reconcile every displayed count against the records created in this run: verified purchases; claims filed; eligible/ineligible; approved/rejected; refund pending; verified refunds; unresolved; and the resolution-time sample. Do not count a pending, invalid, unverified, or merely wallet-returned transaction.
3. Confirm an approved claim remains refund pending until the exact refund has successful execution and following-macro finality. After verification, refresh and confirm pending decreases and verified refunds increases exactly once.
4. Confirm the page distinguishes policy signer, signed settlement address, purchase sender, claim signer, and refund sender. Confirm it says signatures are attestations and chain transactions are monetary evidence.
5. If an append-only reconciliation exception fixture is available, confirm the ledger makes it visible instead of silently changing or hiding the accepted record. Do not induce a real-chain anomaly merely to pass this check.

### P. Phase 5 judge, accessibility, and responsive surface

1. Starting from the public merchant page, ask an unbriefed observer to follow policy → payment → Passport → claim → merchant decision → refund → Promise Ledger and explain the product within 60 seconds. Repeat with five unbriefed people for formal Phase 5 exit.
2. At 320, 375, and 430 CSS pixels and 200% text zoom, inspect the merchant studio, product, Passport, claim, decision, refund, and ledger. Confirm no evidence or action is clipped and no horizontal scrolling is required.
3. Navigate the lifecycle with a keyboard or supported switch control. Confirm visible focus, logical order, working retry controls, correct pressed/current semantics, 44-pixel action targets, and no keyboard trap.
4. With a screen reader, confirm loading, failure, verification, pending finality, resolution, refund, and ledger state changes are announced once and that shortened hashes/addresses have understandable full labels.
5. Enable reduced motion, simulate slow API/RPC responses and one recoverable failure, and confirm the UI preserves context, prevents unsafe double actions, and offers a clear retry without claiming success.

## Explicit result format

Send results using these exact independent lines; report `FAIL` with the observed problem for anything that does not pass:

```text
T-001 PASS|FAIL
T-002 PASS|FAIL
T-020 PASS|FAIL
Phase 1 physical signing/publication PASS|FAIL
Phase 1 v1→v2 physical validation PASS|FAIL
Phase 2 real buyer payment PASS|FAIL
Phase 2 independent chain verification PASS|FAIL
Phase 2 Purchase Passport creation PASS|FAIL
Phase 2 reload/recovery PASS|FAIL
Phase 2 mobile/accessibility PASS|FAIL
Phase 2 first-minute test PASS|FAIL
Phase 3 self-authorized claim PASS|FAIL
Phase 3 distinct-signer authorization PASS|FAIL
Phase 3 merchant resolution PASS|FAIL
Phase 3 claim/resolution reload PASS|FAIL
Phase 3 mobile/accessibility PASS|FAIL
Phase 4 native refund cancellation PASS|FAIL
Phase 4 settlement-sender routing PASS|FAIL
Phase 4 independent refund verification PASS|FAIL
Phase 4 refund reload/recovery PASS|FAIL
Phase 4 mobile/accessibility PASS|FAIL
Phase 5 Promise Ledger reconciliation PASS|FAIL
Phase 5 first-minute judge journey PASS|FAIL
Phase 5 mobile/accessibility PASS|FAIL
```

Only the project lead's explicit lines are authoritative. A partial report changes only the named items; every omitted item remains open.
