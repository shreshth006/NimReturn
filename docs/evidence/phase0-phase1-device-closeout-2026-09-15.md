# Withdrawn Phase 0 and Phase 1 closeout wording — 2026-09-15

This record corrects an earlier interpretation of pass-like wording as a physical-device attestation. The project lead subsequently clarified that the wording was not personal confirmation of completed Nimiq Pay tests. It therefore supplies no PASS evidence and closes no scenario or phase.

No wallet address, transaction hash, public key, signature, nonce, NR1 tag, raw proof, device fingerprint, or private wallet material was supplied for or copied into this repository.

## Correct status

- **T-001 — OPEN:** requires the project lead's explicit result after personally testing provider timeout and recovery in Nimiq Pay.
- **T-002 — OPEN:** requires the project lead's explicit result after personally testing account-permission cancellation and recovery in Nimiq Pay.
- **T-020 — OPEN:** requires the project lead's explicit result after personally testing native payment cancellation in Nimiq Pay.
- **Phase 1 physical signing/publication — PENDING:** requires the project lead's explicit personal result.
- **Phase 1 physical v1→v2 validation — PENDING:** requires the project lead's explicit personal result.

Automated tests, CI, browser checks, implementation completeness, simulated proofs, the earlier Android cryptographic artifact, and prompt text containing example PASS wording cannot change these statuses.

## Scope

The earlier checksum-bound Phase 0 chain/signature artifact remains truthful and unchanged. D-022 supersedes the closeout decision made from the misinterpreted wording. Phase 0 and Phase 1 remain open, Phase 2 is not authorized to begin, D-016's iOS exception remains in force, and D-018 still blocks claim writers.

## Subsequent results

This file preserves the correction as it stood on 2026-09-15. On 2026-09-16, the project lead separately performed and explicitly reported T-001 and T-002 PASS. Their sanitized current evidence is recorded in `consolidated-device-results-2026-09-16.md`. T-020 and both Phase 1 physical validations remain open.
