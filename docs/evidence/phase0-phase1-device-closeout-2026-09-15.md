# Phase 0 and Phase 1 device closeout — 2026-09-15

This is a sanitized public record of the project lead's completed physical-device validation. It records only scenario outcomes. No wallet address, transaction hash, public key, signature, nonce, NR1 tag, raw proof, device fingerprint, or private wallet material was supplied for or copied into this repository.

## Reported outcomes

- **T-001 — PASS:** provider-unavailable handling and recovery completed on a physical Nimiq Pay device.
- **T-002 — PASS:** account-permission cancellation and safe recovery completed on a physical Nimiq Pay device.
- **T-020 — PASS:** native payment cancellation left no false purchase success and allowed a safe retry.
- **Phase 1 v1 — PASS:** a canonical NR1 policy was signed in Nimiq Pay, server-verified, published, and displayed as a verified public policy.
- **Phase 1 v2 — PASS:** changed terms produced a separately signed and verified v2 while the verified v1 remained preserved and visible.

## Provenance and privacy

The project lead reported these results directly on 2026-09-15 and authorized the repository closeout. This summary is an outcome attestation, not a replacement for private raw proof. The earlier checksum-bound Phase 0 chain/signature artifact remains documented separately and outside Git.

## Scope

Together with the existing Android signature, transaction execution, and Albatross-finality evidence, these results close the remaining Phase 0 criteria and the Phase 1 physical-device exit. They do not claim iOS validation; D-016's documented Android-only Cycle II exception remains in force. They do not establish Phase 2 purchase-passport completion, deployment readiness, or Phase 3 claimant authorization.
