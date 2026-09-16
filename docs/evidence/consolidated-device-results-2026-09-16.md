# Consolidated device results — 2026-09-16

This public record contains only sanitized outcomes explicitly reported by the project lead after personal testing. Raw screenshots, wallet identifiers, signatures, transaction identifiers, tags, device fingerprints, and proof JSON remain outside Git.

- **T-001 — PASS:** on Android, the staging diagnostics in an ordinary browser failed safely with instructions to open the page inside Nimiq Pay. Opening the same HTTPS staging page inside Nimiq Pay and retrying reported the injected provider as ready. The project lead explicitly reported `T-001 PASS` on 2026-09-16.
- **T-002 — PASS:** on Android, a fresh isolated HTTPS origin produced the native first-access account-permission request. Cancelling left the provider ready, exposed a non-success account state, returned no accepted accounts, and kept retry available. Retrying and approving returned the wallet account list and restored the account step to ready. The project lead explicitly reported `T-002 PASS` on 2026-09-16.

T-020, Phase 1 physical signing/publication, physical v1→v2 validation, and every later physical-device result remain open until separately reported.
