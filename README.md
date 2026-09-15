# NimReturn

> **The consumer-protection layer for Nimiq Pay.**

**The payment is your receipt. The merchant's signature is your policy.**

Crypto payments are final. Your rights should not be. NimReturn turns a direct NIM merchant payment into a verifiable post-purchase relationship without taking custody of money or keys.

## Why it exists

A blockchain can prove that value moved, but a payment alone does not record the commercial promise around it. Return windows can be edited, warranty terms can disappear, and a later refund can be difficult to connect to the original purchase. NimReturn joins three kinds of evidence into one **Purchase Passport**:

- merchant-signed policy terms fixed at purchase time;
- the independently verified NIM purchase and, when applicable, refund transactions;
- buyer- and merchant-signed claim and resolution events.

NimReturn makes promises and behavior inspectable. It does **not** force a merchant to refund, reverse a transaction, arbitrate disputes, prove delivery, or provide legal advice.

## The core journey

1. A merchant creates a product and signs a versioned policy whose settlement address is explicit. The proof-derived policy signer and settlement address may differ.
2. A buyer opens the product in Nimiq Pay and pays that signed settlement address directly in NIM.
3. The backend independently checks network, sender, recipient, integer Luna amount, transaction data, state, and hash uniqueness.
4. NimReturn creates a Purchase Passport showing the payment, exact policy version, deadlines, and proofs.
5. A RETURN or WARRANTY claim is accepted only when its proof-derived signer equals the verified purchase sender or that sender signs an exact, one-claim delegation. Wallet account selection is never authority.
6. NimReturn deterministically reports whether the claim meets the merchant-signed policy. Eligibility is not a guaranteed remedy.
7. The policy signer signs a decision. An approved refund goes directly from the purchase-bound settlement address to the original buyer and is independently verified.
8. The Promise Ledger derives factual merchant activity from these verified events; it is not a review score.

## Why Nimiq is essential

Nimiq Pay is the identity, signing, and payment surface—not an ornamental payment button. NimReturn uses the Nimiq Pay Mini App provider for account permission, signed attestations, consensus awareness, and direct transactions with compact order data. Nimiq blockchain evidence is the source of truth for purchases and refunds. Proof public keys determine signers; signed policy bytes determine settlement; chain evidence determines transaction senders. Private keys never enter NimReturn.

## Trust model

- **Nimiq blockchain:** payment/refund truth.
- **Wallet signatures:** attestation truth.
- **NimReturn API/database:** workflow, indexing, caching, and queries; never authority to invent a transaction or signature.
- **Merchant discretion:** physical facts and the ultimate commercial decision remain outside the protocol.

There is no NimReturn treasury, escrow, server wallet, seed phrase, or app-controlled private key.

## Architecture

The deliberately small architecture is a React/TypeScript mobile-first frontend, a Fastify/TypeScript API, and PostgreSQL through Drizzle ORM. Wallet actions use `@nimiq/mini-app-sdk`; local signature/address checks use official `@nimiq/core` primitives. The API will independently read Nimiq chain data through a configured production-grade RPC/node integration. See [ARCHITECTURE.md](./ARCHITECTURE.md), [PROTOCOL.md](./PROTOCOL.md), and [DATA_MODEL.md](./DATA_MODEL.md).

## Current status

Phases 1–5 are code-complete at their recorded external-validation boundaries. Phase 5 adds a read-only Promise Ledger derived only from verified protocol records, with definitions, sample sizes, `as_of`, identity-role separation, and visible reconciliation exceptions; it contains no ratings, reviews, AI assessments, trust scores, or editable metrics. Phase 0 remains 98%, Phase 1 92%, and Phases 2–5 90% experimental/code-complete. Every physical policy, payment, Passport, claim, resolution, refund, reload, and mobile check remains open pending the project lead's explicit personal results. D-030 records the explicit Phase 5 instruction without waiving any earlier test. Phase 6 has not started. See the [consolidated device checklist](./docs/evidence/consolidated-device-validation.md), [STATUS.md](./STATUS.md), and [MEMORY.md](./MEMORY.md).

## Local development

Requirements: Node.js 24+, npm 11+, and Nimiq Pay for real-device checks.

```bash
cp .env.example .env
npm install
npm run dev
```

The Vite frontend listens on the local network so a phone on the same Wi-Fi can open `http://<computer-ip>:5173` from Nimiq Pay's Custom URL field. Start the API separately with `npm run dev:api`. Use Nimiq Pay's testnet mode and a dedicated test wallet for transaction diagnostics.

No RPC URL is committed. Configure `NIMIQ_RPC_URL` for server-side transaction lookup and `VITE_API_BASE_URL` if the frontend and API are on different origins. Policy writers also require `DATABASE_URL` and `SESSION_SECRET`; production additionally requires an exact `CORS_ORIGIN`. Public community RPCs have no availability guarantee and are not acceptable as the sole production verifier.

## Quality checks

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

`npm run check` runs the complete local gate. Real-device cases are tracked separately in [TESTING.md](./TESTING.md); an automated browser pass is not evidence that Nimiq Pay approval dialogs or network interoperability work.

GitHub Actions runs the same locked-install, lint, typecheck, test, PostgreSQL 16 integration, and production-build gate on every push to `main` and every pull request.

## Deployment

The intended topology is a static frontend plus one Node API and managed PostgreSQL in one region. HTTPS, same-origin API routing, database migrations, production RPC credentials, health checks, and structured logs are required before deployment. No deployment exists yet.

## Competition

NimReturn is being built for **Nimiq Mini Apps Competition — Cycle II** (August 24–September 18, 2026; submission cutoff September 18 at 23:59 UTC). It targets a focused, reliable, mobile-first experience rather than maximum feature count. See [COMPETITION.md](./COMPETITION.md) and [SUBMISSION.md](./SUBMISSION.md). Competition facts must be rechecked against the live official pages before submission.

## Documentation map

- [PRD.md](./PRD.md): testable product requirements and scope.
- [DESIGN.md](./DESIGN.md): UX, screens, states, and copy.
- [SECURITY.md](./SECURITY.md): threat model and launch checklist.
- [TESTING.md](./TESTING.md): automated and actual-device test strategy.
- [docs/evidence/phase0-device-verification-2026-09-14.md](./docs/evidence/phase0-device-verification-2026-09-14.md): sanitized, checksum-bound Android Phase 0 proof summary.
- [docs/evidence/phase0-phase1-device-closeout-2026-09-15.md](./docs/evidence/phase0-phase1-device-closeout-2026-09-15.md): correction restoring unconfirmed device scenarios to open/pending.
- [PHASES.md](./PHASES.md): phased execution and exit criteria.
- [RULES.md](./RULES.md): non-negotiable project constitution.
- [DECISIONS.md](./DECISIONS.md): append-only decisions.

## License

MIT. See [LICENSE](./LICENSE).
