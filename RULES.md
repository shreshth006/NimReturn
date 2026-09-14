# NimReturn project constitution

These rules override convenience, novelty, and schedule pressure. A change that conflicts with them requires an explicit, documented decision and—where it changes custody, trust, cryptography, or scope—human approval.

## Product truth

1. **No custody.** Purchase and refund funds move directly between buyer and merchant wallets.
2. **No private keys.** NimReturn never asks for, receives, derives, logs, or stores a seed phrase or private key.
3. **No fake blockchain state.** Test fixtures and diagnostic labels must be unmistakable; production UI never presents a mocked success as verified.
4. **No frontend-authoritative payment success.** A wallet-returned hash starts verification; only independent blockchain evidence can complete it.
5. **No historical policy mutation.** A signed policy version is append-only. Corrections create a new version.
6. **No overstated protection.** “Policy eligible” is an objective protocol result, not a guaranteed refund, legal conclusion, or proof of merchant misconduct.
7. **No opaque trust score.** Promise Ledger figures are reproducible counts or durations from verified events with published definitions.
8. **Wallet identity, minimal PII.** Do not require email, phone, password, or legal name. Collect nothing not needed for the protocol.
9. **Keep evidence roles distinct.** A proof-derived signer, a signed settlement address, and a chain-observed transaction sender are separate facts. Equality is allowed only when observed, never assumed from wallet account discovery or client selection.

## Security and engineering

1. All monetary values are integer Luna. `1 NIM = 100,000 Luna`; floating-point money is forbidden.
2. Official, established Nimiq primitives are used for signatures, hashes, address parsing, and public-key/address derivation. No custom cryptography.
3. Signature verification checks the exact canonical bytes, signature, public key, and address binding.
4. Every externally supplied ID, address, amount, timestamp, enum, payload, and hash is validated at the boundary.
5. Payment and refund verification checks network, state, sender, recipient, value, data tag, linked ID, and globally unique transaction hash.
6. Critical commands are idempotent and database-enforced. Retries, reloads, duplicate requests, and concurrent workers cannot create duplicate purchases, claims, resolutions, or refunds.
7. Critical transitions use transactions and compare-and-set semantics. There is one legal state machine, shared by API validation and tests.
8. Secrets stay server-side, outside Git, with least privilege and documented rotation. `.env` is ignored; `.env.example` contains names only.
9. Logs exclude signatures where unnecessary, full sensitive request bodies, secrets, and raw wallet approval payloads. Addresses are personal data for privacy review even when public on-chain.
10. Production dependencies are pinned by the lockfile and audited before launch. High-impact updates require tests and a decision entry when they alter protocol behavior.

## Delivery discipline

1. Respect the current phase in `STATUS.md`; do not begin later product phases before the current phase exit criteria are met.
2. Mobile operation inside Nimiq Pay is first-class. A desktop-only success is incomplete.
3. Awaiting, cancelled, pending, verifying, verified, inconclusive, and invalid states must be distinct. Never announce success before evidence exists.
4. Behavior changes include tests. Protocol or architecture changes also update their source documents and append `DECISIONS.md`.
5. A phase is complete only after its exit criteria and relevant lint, typecheck, tests, build, failure-path, mobile, and documentation checks pass.
6. Prefer one well-tested lifecycle over surface area. Reliability and a clear 60-second story win ties.
7. Keep the system to one frontend, one API/data layer, and one database unless evidence proves another component necessary.

## Scope rejection

The following are intentionally excluded, even when they are fashionable or easy to demo:

- AI/LLM features, recommendations, automated dispute judgments;
- NFTs, tokens, a custom currency, multi-chain expansion;
- escrow, chargebacks, app treasury, smart contracts, dispute courts, DAO governance;
- arbitrary reviews, merchant marketplace, coupons, loyalty, referrals, CRM;
- shipping/logistics, fiat processors, KYC, unnecessary admin analytics;
- product or customer photo uploads for the MVP;
- replacement fulfillment and transferable warranty until the core lifecycle is proven.

“Architect for later” does not authorize building later. A rejected feature can return only with a concrete user need, security analysis, phase placement, and evidence that it will not jeopardize the submission-critical flow.

## Production prohibitions

- No hardcoded seed phrase, private key, API key, production address, transaction hash, or fake verification response.
- No hidden bypass for signatures or chain verification.
- No manual editing of derived Promise Ledger metrics.
- No destructive schema rewrite that can alter signed historical records.
- No deployment that silently falls back from an unavailable verifier to trusting the client.
