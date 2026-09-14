# Security and trust model

**NimReturn is not an escrow or arbitration system.** It cannot move user funds, reverse NIM transactions, compel merchant behavior, prove delivery or product condition, or determine legal rights. It verifies and records a limited set of cryptographic and blockchain facts.

## Security objectives

1. Never expose or control a merchant/customer private key.
2. Never create a successful purchase/refund from client or database assertion alone.
3. Prevent one signature, nonce, transaction, order, or resolution from being replayed in another context.
4. Preserve the exact signed historical policy and its relationship to a purchase.
5. Attribute claims to the original buyer and resolutions/refunds to the correct merchant.
6. Fail visibly and recoverably when wallet, network, API, RPC, or database state is uncertain.
7. Minimize user data and avoid turning public blockchain data into unnecessary profiles.

## Assets

- User funds in merchant and buyer wallets (NimReturn has no custody but can induce approval requests).
- Wallet consent and user understanding of what is being signed/sent.
- Exact signed policy, claim, and resolution messages and proofs.
- Transaction-to-order/claim bindings.
- Purchase Passport integrity and availability.
- Promise Ledger accuracy and definitions.
- Database/API/RPC credentials and deployment integrity.
- User privacy: wallet addresses, purchase/claim relationships, notes, IP/log metadata.
- Competition/repository credibility.

## Adversaries and failures

- Malicious buyer forging/replaying claims, substituting transactions, or racing requests.
- Malicious merchant mutating policy history, falsifying refund state, or signing with another address.
- Opportunistic third party guessing IDs, scraping private relationships, or abusing APIs.
- Compromised frontend/dependency inducing misleading wallet approvals.
- Compromised API/operator/database fabricating workflow or derived metrics.
- Faulty, stale, compromised, or unavailable RPC endpoint.
- Accidental concurrency, retries, reorgs, clock errors, data migrations, and programming mistakes.
- User confusion causing approval of the wrong network, recipient, amount, or message.

## Trust boundaries

### Nimiq Pay/native wallet

Trusted to protect keys and show/execute native approvals. NimReturn must supply clear parameters and cannot assume a returned value matches its request without parsing. Account access, signing, and payments may be cancelled or time out normally.

### Frontend/WebView

Untrusted for identity, amounts, recipients, timestamps, state, eligibility, and verification. It is also an important consent surface: the screen immediately before native approval repeats the exact human-readable action.

### API

Trusted computing boundary for domain decisions but not a source of blockchain truth. It validates, verifies, persists, and derives. API compromise remains high impact; append-only evidence and reconciliation make fabrication detectable, not impossible.

### Database

Durable index/workflow/cache, not chain authority. Least-privilege roles, constraints, append-only evidence, backups, audit events, and reconciliation reduce operator/software manipulation risk.

### RPC/node

Untrusted external observation. Validate response schema/network and prefer independent/failover verification for production. An error becomes inconclusive, never client-trusted success.

### Physical/legal world

Explicitly outside the system. No cryptographic result proves delivery, defect, identity of a legal business, or enforceability.

## Wallet model

- No seed phrase/private key input exists anywhere in UI/API/schema.
- All sensitive wallet actions use Nimiq Pay native confirmation.
- A Nimiq address is pseudonymous account identity, not verified civil identity.
- Account is re-bound to every signature via returned public key and derived address.
- Historical merchant address remains bound to the signed policy. Wallet migration is not improvised in MVP.
- Server has no signing key capable of moving user money; ordinary TLS/session keys do not become wallet keys.

## Threats and controls

### Signature forgery or preprocessing mismatch

Threat: accept a signature over different bytes, try multiple message variants, mishandle hex, or conflate Mini App and Hub schemes.

Controls: exact stored canonical challenge; domain prefix; UTF-8 byte equality; strict key/signature lengths; official core verification; one permitted transformation only; known-good/tampered tests; actual Nimiq Pay fixture before activation; verifier version stored. No prefix fallback.

### Public-key/address mismatch

Threat: valid attacker signature submitted while claiming merchant/buyer address.

Controls: derive address from parsed public key using `PublicKey.toAddress()` and byte-compare to parsed claimed address. Check the role address comes from server-bound order/policy, not request substitution.

### Signature replay

Threat: reuse a policy/claim/resolution signature for another resource or later action.

Controls: protocol/type/resource/signer/domain fields; 128-bit one-time nonce; expiry; nonce unique constraint; atomic challenge consumption; no generic “sign in” message reused as commerce evidence.

### Policy tampering

Threat: modify price/window/product after signature or point a passport at a newer policy.

Controls: stored canonical bytes/hash/proof; signed snapshot fields; append-only verified rows; unique monotonic version; order binds policy ID before wallet payment; passport immutable relation; periodic hash/signature reconciliation; restricted DB updates.

### Order/transaction substitution

Threat: attach an unrelated valid transaction, another customer's payment, or duplicate hash.

Controls: 128-bit order tag; check network, sender, merchant recipient, exact Luna, exact data, state, type; shared transaction-hash registry; one transaction/order/passport constraints; idempotent compare-and-set transition.

### Wrong recipient or amount

Threat: compromised UI requests payment/refund to attacker or wrong value; server later accepts it.

Controls: API returns expected wallet request from immutable order/resolution; pre-approval UI repeats it; server independently compares parsed addresses and safe-integer Luna. Never infer acceptance from approximate decimal display.

### Forged/non-buyer claim

Threat: another wallet files against a known passport.

Controls: private/unpredictable IDs reduce discovery but do not authorize; server challenge binds original chain sender; signature and address binding; access controls; one-time nonce; claim history constraints.

### Forged/duplicate merchant resolution

Threat: buyer or attacker records approval; merchant changes decision after outcome.

Controls: resolution challenge binds policy merchant; signature/address verification; unique `claim_id`; exact duplicate idempotency; conflicting second resolution is `409` and append-only audit event.

### Refund fraud

Threat: merchant claims a refund, pays another wallet/wrong amount, reuses purchase/refund hash, or attaches a different claim tag.

Controls: approval separate from payment; independent chain check; merchant sender; original buyer recipient; exact full Luna amount; refund claim tag; final state/confirmation; global unique hash; no partial-credit aggregation in NR1.

### Database/operator manipulation

Threat: privileged actor flips states or metrics.

Controls: immutable evidence tables/permissions; constrained transitions; append-only events; ledger-only views; raw proof/chain references; verifier version; periodic re-verification/reconciliation; database audit logs; separate migration/runtime roles; backup/PITR. Public verification page is stretch but retained evidence enables it.

### API abuse and enumeration

Threat: oversized payloads, ID scraping, brute force, spam challenges/claims, denial of service.

Controls: strict schemas/size limits/content types; high-entropy IDs; per-IP and per-wallet/action rate limits; bounded pagination; generic not-found where privacy matters; challenge quotas/expiry; timeouts/body limits; CSP/CORS/origin controls; structured abuse metrics. Do not use Nimiq Pay device ID without explicit consent/privacy decision.

### Race conditions and double processing

Threat: double taps, parallel verifier workers, retry after timeout, concurrent refunds.

Controls: idempotency keys bound to request hash; row locks/compare-and-set; unique nonces, resource relations, and chain hashes; transactional state + evidence writes; workers use `SKIP LOCKED`; deterministic retry responses.

### Chain reorganization/finality

Threat: treat an unstable inclusion as final and create downstream state.

Controls: distinguish mempool/included/finalized; require `executionResult: true`; derive finality from the inclusion block and its following Albatross macro block, never from an ordinary confirmation count; retain inclusion/finalizing/head heights; reconcile recent transactions; explicit reorg recovery protocol before mainnet. Never erase an observed event; append correction and move to a safe exceptional state.

### RPC compromise/unavailability

Threat: false record, stale network, timeout, selective response.

Controls: verify reported network and complete fields; configurable primary and independent/failover source; timeout/backoff/circuit metrics; inconclusive status; periodic recheck. Do not expose authenticated RPC URL to client or logs.

### Frontend/supply-chain compromise

Threat: modified bundle changes recipient/message or phishes secrets.

Controls: HTTPS, restrictive CSP, no inline remote scripts, locked dependencies, audit/SBOM, protected deployment, review, minimal dependencies, reproducible CI. Native wallet display remains a final user check; product copy teaches recipient/value/message review without implying it cures compromise.

### XSS/content injection

Threat: merchant/product/note text executes or deceives.

Controls: React escaped rendering, no arbitrary HTML, scheme-restricted links, NFC/control/length validation, security headers, no `dangerouslySetInnerHTML`, safe evidence viewers, anti-clickjacking appropriate for required Nimiq Pay WebView embedding policy.

### Time manipulation

Threat: client backdates claim or server clock error changes eligibility.

Controls: chain block timestamp anchors purchase; server-issued challenge time anchors claim; NTP/clock monitoring; inclusive UTC arithmetic; evaluator inputs/version stored; client time display is non-authoritative.

## Secret management

- `.env` ignored and examples contain no real values.
- RPC/database/observability credentials reside in platform secret manager, injected server-side only.
- Separate least-privilege production/staging credentials; rotation and revocation documented before launch.
- CI uses short-lived credentials where available. Fork PRs receive no production secrets.
- Logs and error responses redact URLs containing credentials, database strings, authorization headers, and signatures/notes where unnecessary.
- Secret scanning runs before public repository/submission.

## Privacy

Wallet addresses and transaction relationships are public-chain data but remain personal/pseudonymous context when indexed with products and claims. Collect no names, emails, phone numbers, passwords, KYC, photos, or delivery evidence in MVP. Notes are optional, bounded, and warn users not to include sensitive information. Public Passport visibility and raw notes default private-to-parties unless an explicit share action is later designed. Publish a privacy notice covering purpose, retention, public-chain permanence, processors, and rights before pilot.

Pilot unique-wallet instrumentation must be truthful and minimal. Hashing an address does not anonymize a small address set by itself. Use aggregate queries with access control; do not create public user profiles or cross-app/device correlation.

## Denial and failure handling

Availability loss must not become integrity loss. If API/database cannot durably create an order, do not begin payment. If a wallet returns a hash while the API is temporarily unavailable, UI preserves and retries the exact attachment without requesting a second payment. If RPC is unavailable, status is inconclusive and retryable. Rate limits never block a user from viewing existing evidence or attaching a just-returned hash without a recovery path.

## Dependency risk

Pin lockfile; use official Nimiq packages; review new install scripts, licenses, advisories, and transitive changes; avoid unused wallet/crypto libraries. Upgrading Mini App SDK or core requires declaration/source review, crypto vectors, device signing, transaction data, cancellation, and build tests. Never swap cryptographic libraries solely to reduce bundle size without equivalence evidence.

## Pre-launch security checklist

- [ ] No custody path, server wallet, private-key/seed input, or treasury address.
- [ ] Mini App SDK/core versions pinned and current behavior re-reviewed.
- [ ] Actual-device sign fixture validates exact NR1 bytes and address binding on target Nimiq Pay versions.
- [ ] Known-good/tampered/wrong-address signature tests pass.
- [ ] Purchase/refund wrong network/sender/recipient/value/data/state/hash tests pass.
- [ ] Global hash/nonces and one-to-one constraints verified under concurrency.
- [ ] Historical policy update/delete denied at database level.
- [ ] RPC failure/reorg/timeout is inconclusive, never success.
- [ ] Authz prevents buyer/merchant cross-resource actions and ID enumeration.
- [ ] Rate/body limits, TLS, CORS, CSP, security headers, and error redaction reviewed.
- [ ] Database roles, encryption, backups, restore test, and PITR configured.
- [ ] Secrets scan, dependency audit, SBOM/license review, and production build pass.
- [ ] Privacy notice, retention, public visibility, and optional-note copy reviewed.
- [ ] Promise Ledger reproduced from source records; no metric mutation endpoint.
- [ ] Nimiq Pay mobile cancellation/resume/double-tap/reload tested on actual devices.
- [ ] Incident contact, rollback, RPC failover, and verifier-disable runbook exists.
