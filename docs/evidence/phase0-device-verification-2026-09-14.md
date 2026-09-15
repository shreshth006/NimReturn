# Phase 0 Android device verification — 2026-09-14

This is a sanitized public summary of a privately retained Phase 0 evidence artifact. It contains no full wallet address, transaction hash, public key, signature, diagnostic nonce, NR1 token, user-agent/build identifier, or raw evidence JSON.

## Verified environment

- Evidence format: `nimreturn.phase0.evidence.v2`
- Device platform: Android 16
- Nimiq Pay: 2.19.1
- Mini App SDK: 0.1.0
- Nimiq core: 2.21.0
- Wallet-disclosed accounts: 2
- Wallet consensus at payment: established

## Verified signer evidence

- The exact Nimiq framed-message signature verified.
- Public-key/address binding verified.
- The cryptographically derived signer was present in the wallet-disclosed account list.
- The expected diagnostic account differed from the actual signer; the valid proof correctly remained valid with a warning.

## Verified transaction evidence

- One 1000-Luna TestAlbatross transaction was submitted with a strict 28-byte `NR1:P:<22-character-token>` tag.
- The independently observed recipient matched the requested recipient after canonical Nimiq-address normalization.
- The independently observed value and full NR1 data matched the submitted expectation.
- The observed sender was present in the wallet-disclosed account list.
- On-chain `executionResult` was `true`.
- The independently observed head reached the transaction's finalizing macro block.
- Finality was reached and the final server RPC outcome was `verified`.
- In this run, the message signer and transaction sender were different wallet-disclosed accounts. This is one device observation, not a universal Nimiq Pay account-selection rule.

## Private artifact integrity

The authoritative JSON remains outside the Git repository. Its SHA-256 digest is:

`ebee147417167c939af5b7e9d5db0a93e07b4ef994a1a232381ffcf434414544`

The companion checksum was verified before this summary was committed. The private artifact, checksum file, and identifying proof values are intentionally not copied into this repository.

## Scope

This artifact closes the Android framed-signature and independently verified TestAlbatross transaction/finality proof. It does not by itself establish iOS host compatibility, provider-timeout recovery, or account-permission cancellation behavior.

The later [closeout wording was withdrawn](./phase0-phase1-device-closeout-2026-09-15.md) after the project lead clarified that it was not personal confirmation of the remaining device tests. This artifact's original scope remains unchanged.
