# Consolidated device results — 2026-09-16

This public record contains only sanitized outcomes explicitly reported by the project lead after personal testing. Raw screenshots, wallet identifiers, signatures, transaction identifiers, tags, device fingerprints, and proof JSON remain outside Git.

- **T-001 — PASS:** on Android, the staging diagnostics in an ordinary browser failed safely with instructions to open the page inside Nimiq Pay. Opening the same HTTPS staging page inside Nimiq Pay and retrying reported the injected provider as ready. The project lead explicitly reported `T-001 PASS` on 2026-09-16.
- **T-002 — PASS:** on Android, a fresh isolated HTTPS origin produced the native first-access account-permission request. Cancelling left the provider ready, exposed a non-success account state, returned no accepted accounts, and kept retry available. Retrying and approving returned the wallet account list and restored the account step to ready. The project lead explicitly reported `T-002 PASS` on 2026-09-16.
- **T-020 — PASS:** on Android, the patched staging build opened the native review for the expected tiny TestAlbatross payment and tagged data. Rejecting it returned a visible cancelled state, stated that nothing was approved, produced no accepted transaction hash, and kept a deliberate retry available. The approved retry returned exactly one hash; NimReturn's server-side RPC then independently matched sender membership, recipient, integer-Luna value, tagged data, successful execution, inclusion, following macro block, and finality. The project lead explicitly reported `T-020 PASS` on 2026-09-16. No identifiers or raw proof material are retained here.

These explicit results, together with the separately preserved checksum-bound Android signing/address-binding and independent chain/finality artifact, satisfy the recorded Phase 0 exit criteria. Phase 0 is formally closed. Every later named physical-device result remains open until separately reported.

- **Phase 1 physical signing/publication — PASS:** on Android inside Nimiq Pay, the established merchant restored a lost protected session with **Reconnect policy signer** (D-033), then signed and published new policy versions that the server re-verified as NR1. The project lead explicitly reported `Phase 1 physical signing/publication PASS` on 2026-09-16.
- **Phase 1 v1→v2 physical validation — PASS:** the public proof showed the newest version active and v1 plus the intermediate version preserved as verified policies, each with distinct terms and payload hashes and the original v1 timestamp intact. The project lead explicitly reported `Phase 1 v1→v2 physical validation PASS` on 2026-09-16.

Phase 1 is formally closed (D-034).

- **Phase 2 reload/recovery — PASS:** on Android inside Nimiq Pay, after a real low-value TestAlbatross purchase produced a verified Purchase Passport bound to the active policy, refreshing the page restored the same public order and Passport without opening another native payment request. The project lead explicitly reported `Phase 2 reload/recovery PASS` on 2026-09-16.
- **Phase 2 mobile/accessibility — PASS:** with enlarged system text on the Android phone, the Passport's price, purchase-bound policy, deadlines, finality, and chain evidence stayed readable without horizontal clipping, and its actions remained usable. The project lead explicitly reported `Phase 2 mobile/accessibility PASS` on 2026-09-16.

Phase 2 real buyer payment, independent chain verification, Purchase Passport creation, and the first-minute test remain open until explicitly reported; the project lead deferred the first-minute test because no unbriefed observer was available. Phase 3–5 physical results remain open.
