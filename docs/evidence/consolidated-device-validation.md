# Consolidated Nimiq Pay device validation

Status: **PENDING — no item in this document is a PASS until the project lead personally performs it and explicitly reports the result.**

This single TestAlbatross session covers the deferred Phase 0/1 gates and the Phase 2 purchase boundary. Automated tests, CI, desktop browsers, deterministic keys, and implementation completeness do not satisfy it.

## Prepare once

1. Deploy the current `main` commit over HTTPS with PostgreSQL migrations applied and a working TestAlbatross RPC. Record the commit SHA, UTC time, phone OS, Nimiq Pay version, SDK version, and core version.
2. Use low-risk TestAlbatross accounts: one policy signer, one signed merchant settlement address (they may intentionally differ), and one funded buyer. Set a tiny exact price such as **1,000 Luna (0.01 NIM)**.
3. Keep raw addresses, public keys, signatures, canonical messages, transaction hashes, nonces, tags, JSON, and wallet screenshots outside Git. Repository evidence may contain only outcomes, versions, UTC time, redacted screenshots, and non-identifying checksums.

## Shortest exact run

### A. T-001 — provider unavailable and recovery

1. Open the merchant page in the phone's ordinary browser and reach the wallet action.
2. Trigger it and wait for provider initialization to fail/timeout.
3. Confirm the UI says to open in Nimiq Pay, shows no success, and offers retry.
4. Open the same URL inside Nimiq Pay and retry. Confirm provider initialization succeeds without reloading fake state.

### B. T-002 — account permission cancellation and recovery

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
```

Only the project lead's explicit lines are authoritative. A partial report changes only the named items; every omitted item remains open.
