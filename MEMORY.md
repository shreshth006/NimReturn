# Project identity

NimReturn — “The consumer-protection layer for Nimiq Pay.” Tagline: “The payment is your receipt. The merchant's signature is your policy.” Built for Nimiq Mini Apps Competition Cycle II.

# Product thesis and boundaries

A Purchase Passport will join merchant-signed policy-at-purchase, independently verified direct NIM purchase/refund transactions, and wallet-signed claim/resolution history. NimReturn verifies promises and behavior; it does not enforce refunds, escrow, arbitrate, reverse transactions, or prove physical facts. No custody, private keys, fake chain success, fractional/unsafe Luna, mutable verified policy, or client-certified transaction is permitted.

# Current phase

Phases 0 and 1 are 100% complete. Phase 2 is 95%, Phase 3 is 95%, Phase 4 is 93%, and Phase 5 is 90% experimental/code-complete at its external-validation boundary. The project lead explicitly reported the complete Android purchase → claim → signed approval → independently verified refund lifecycle PASS on 2026-09-17 after D-035/D-036. Remaining named reload, refund-cancellation, mobile/accessibility, Promise Ledger, first-minute, and operations results stay open until separately performed and reported. Phase 6 is not started or authorized.

On 2026-09-17, stale judge-facing Promise Ledger copy from the pre-D-035/D-036 refund model was corrected. It now explains that current purchases refund the purchase-bound claim key and record the observed sender, while legacy purchases retain their purchaser/settlement authorization path. No protocol behavior, physical result, or phase percentage changed.

# What is complete

Phase 0 diagnostics cover provider/account/network state, exact framed message verification, public-key/address derivation, guarded transaction-with-data, independent RPC verification, reload-safe uncertainty, and sanitized private evidence. The prior Android artifact proves exact framed signing plus one real 1000-Luna TestAlbatross transaction with matching chain-derived sender/recipient/value/data, `executionResult=true`, and macro finality.

Phase 1 includes canonical NR1 policy schemas; PostgreSQL migrations and restricted runtime role; 256-bit hashed first-policy bootstrap; immutable merchant/product/policy identity; exact challenge/proof binding; atomic first-signer establishment and publication; verified-only activation; bounded expiry; append-only events; injectable Fastify API; protected writer authorization and rate limits; fail-closed public reprojection of active and historical proofs; validated frontend API/workspace recovery; and the responsive merchant studio. The UI makes protocol, active version, signer, settlement address, terms, policy/server timestamps, BLAKE2b payload hash, public key, exact signed message, and immutable v1/v2 history judge-visible.

Phase 2 includes immutable server-issued orders bound to one exact active verified policy; a pre-payment purchase claim key; strict wallet-state transitions; documented sender-free Nimiq payment calls; reload-safe public order/hash storage; global transaction replay protection; independent network/sender/recipient/integer-Luna/data/execution/Albatross-finality verification; one atomic immutable Passport; fail-closed public policy/chain reprojection; and append-only reconciliation whose latest regression becomes a visible verification exception.

Phase 3 includes canonical claim and exact-claim authorization messages; proof-derived chain-sender, purchase-key, or delegated claimant authority; immutable challenge/proof/evaluation evidence; inclusive purchase-bound RETURN/WARRANTY eligibility; a protected merchant queue; full-value approve or zero-value reject resolutions signed only by the historical policy signer; private pending drafts; verified-only public decisions; and buyer/merchant UI with public-only reload recovery. Approval is never displayed as paid.

Phase 4 includes immutable server-derived refund attempts bound to the approved claim and the D-036 claim-key/legacy recipient rule, full value, network, and compact refund tag; protected wallet-state/hash attachment; independent exact-field/execution/Albatross-finality verification; global hash uniqueness; one atomic Passport-refunded transition; append-only reconciliation; and merchant/buyer UI for cancellation, unknown outcomes, chain-history recovery/rule-out, pending finality, failure, and verified evidence. The API cannot select or certify the wallet sender.

Phase 5 includes PostgreSQL security-barrier views and a strict public API that derive verified purchases; filed/eligible/ineligible claims; approved/rejected/unresolved decisions; refund-pending and verified-refund counts; median resolution time with its sample; and latest reconciliation exceptions. Runtime access is read-only, mixed fixtures reconcile to immutable source evidence, and direct mutation fails. The public surface now includes a minimal verified Passport lifecycle plus an optional server-reverified refunded example, without enumerating free-text claim notes. Wallet prompts fail closed unless consensus and the configured verifier-network head can be matched within a bounded tolerance; exact server-side network verification remains authoritative. Temporary HTTPS staging is live; manual accessibility/device/usability and production-operations work remain open.

# Verification status

Local lint, typecheck, 215 hermetic tests, all 32 PostgreSQL tests (247 total), production builds, and the production dependency audit pass on 2026-09-17. GitHub Actions run `35167099687` is green. Render staging is live on `ed3c6fc`; health/network/example smoke checks pass, and the server-reverified completed example renders a real policy → Passport → claim → signed decision → verified refund lifecycle with no raw identifier committed. Automation does not infer any remaining device, accessibility, reload, cancellation, ledger, operations, or first-minute result.

# Important implementation details

`sign()` accepts the exact NR1 string and no signer argument. Nimiq signing verifies `\x16Nimiq Signed Message:\n` + decimal UTF-8 byte length + raw bytes, SHA-256, then Ed25519; NR1 separately stores BLAKE2b-256 of the unframed canonical message. The actual signer is derived from the public key and must be wallet-listed in the merchant UI. The signed `settlementAddress` may differ. First valid proof establishes the immutable policy signer. Later challenge allocation requires the protected merchant session, but later publication still requires that signer. Verified versions never update/delete; public reads re-verify every returned proof.

The browser stores only public merchant workspace/challenge facts and, for a purchase, public product/order IDs plus an optional returned transaction hash. First bootstrap and established session values stay in `HttpOnly` cookies. Production startup requires database URL, exact browser origin, and a server-only session secret. `sendBasicTransactionWithData()` has no sender argument; the purchase writer derives the buyer only from independently verified chain evidence and requires `executionResult=true` plus following-macro finality.

A claim signer is derived from its public key. Exact equality with the independently observed purchase sender self-authorizes; a D-035 key proven over the exact unpaid order before payment also authorizes; otherwise only a second `CLAIM_AUTHORIZATION` proof derived to the purchase sender can authorize that immutable claim/signer/hash tuple. Resolutions require the purchase-bound policy signer, not the settlement address. Unsigned resolution drafts are merchant-session-private; public reads return verified decisions only.

# Known blockers

Physical Android Nimiq Pay has passed T-001 provider failure/recovery, T-002 account-permission cancellation/recovery, and T-020 native payment cancellation/recovery by explicit project-lead reports. Phase 1 signing/publication and immutable v1→v2 also passed. Nimiq Pay pays from a hashed-timelock contract and signs with its owner account, so D-035 binds a purchase claim key before payment and D-036 refunds that key while recording the actual sender. With those deployed, the project lead reported PASS for Phase 2 payment/chain/Passport, Phase 3 self and distinct-signer claims plus merchant resolution, and Phase 4 independent refund verification (2026-09-17). Remaining: Phase 2 first-minute (deferred), Phase 3 claim/resolution reload and mobile/accessibility, Phase 4 cancellation/reload/mobile/accessibility, and all Phase 5 manual checks. The distinct-signer and refund-routing architecture has passed once on Android under D-035/D-036; no unperformed case is inferred. iOS is explicitly deferred by D-016. Temporary HTTPS staging is live at `https://nimreturn-staging-cycle2.onrender.com` with a free managed PostgreSQL database (expires 2026-10-16), generated session secret, least-privilege runtime login, and passing Phase-5/TestAlbatross preflight. Managed backup/restore proof, alerting/runbooks, and an operated primary/failover RPC are absent. Multi-instance rate limiting is not supported. The public development RPC is not production-grade.

# Next actions

1. Continue only the remaining Phase 3–5 physical checklist on `https://nimreturn-staging-cycle2.onrender.com`, fixing observed failures.
2. Fix only concrete failures, then replace the development RPC with an operated primary/failover TestAlbatross source and validate backups, alerts, CSP, and the release smoke suite.
3. Record only explicit project-lead results in sanitized evidence; keep wallet/proof/transaction identifiers outside Git. Do not start Phase 6 until it is explicitly authorized.
