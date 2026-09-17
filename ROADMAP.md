# NimReturn — competition roadmap

North star: the simplest way to prove what a merchant promised, what the buyer paid for, what happened after purchase, and whether the merchant kept that promise.

The payment is your receipt. The merchant's signature is your policy. Chain proves monetary events; signatures prove attestations.

## Rules that hold throughout

- Record physical PASS/FAIL results only when the project lead explicitly reports them. Nothing is inferred from code, CI, or earlier runs.
- Phase 6 (real-user pilot) starts only after the project lead's explicit go-ahead.
- The repository never contains wallet addresses, transaction hashes, public IDs used as evidence or configuration, raw signatures or public keys, or raw device evidence. Public product/Passport links may appear in the submission and posts.
- Push a focused commit after each meaningful change.
- Deploy only when no phone test is in progress. When the schema changes, migrate first, then deploy.
- No fake success states, no feature creep without an observed correctness problem, and never weaken verification to ease a demo.

## Priorities

| # | Item | Owner | Done when |
|---|------|-------|-----------|
| P0 | Submit first | Project lead | A valid submission exists with the correct app URL, repo URL, and description. It is a checkpoint, not a code freeze. |
| P1 | Safe judge path | Agent; lead verifies on phone | The wallet head is compared with the verifier network before every signature or payment; wrong or unconfirmed networks are blocked with a switch instruction; the network requirement is visible before the first tap; product pages, Passports, proof, and the completed example stay readable on any network; the example is a real staging Passport that freshly re-verifies, configured via `FEATURED_PASSPORT_ID`, and is hidden when verification fails. |
| P2 | 60-second story | Agent; lead judges | Consumer copy reads every promise (windows, price, status, version) from the verified signed policy; proof details are collapsed by default and one tap away from every consumer screen; verification is unchanged; lint, typecheck, database tests, and build pass. |
| P3 | Reliability gaps | Agent fixes; lead reports | Claim/resolution reload and mobile, refund cancellation, reload/recovery (including the known unknown-outcome refund once its validity window is provably closed), refund mobile, Promise Ledger reconciliation, accessibility, wrong-network handling, RPC failure/recovery, and fresh-session/cold-start checks are each PASS (reported), FIX DEPLOYED (awaiting retest), or OPEN. |
| P4 | Unbriefed users | Project lead | Five first-minute tests are run without explanation; repeated confusion (3 of 5) is fixed; a new user can say "it saves proof of the return/warranty terms from when I bought something and verifies what happens afterward." |
| P5 | Promise Ledger payoff | Agent | Existing verified counts are presented clearly, no new metric is added, and "No reviews. No star ratings. No manually editable trust score." is visible. |
| P6 | Real-user pilot | Project lead | Organizers have confirmed on Skool how usage is counted (testnet wallets, opening vs. transacting, unique-wallet measurement); the lead has said "go"; 35–40 genuine users are targeted without manufactured activity. Not a blocker for P0. |
| P7 | Boring deployment | Agent checks; lead decides spending | Explicit decisions on always-on hosting and RPC fallback; database backup checked; `/health` monitored or consciously skipped; restart, fresh-session, and RPC failure/recovery tested; a plan exists for the managed database expiring on 2026-10-16. No cost is incurred without the lead's decision. |
| P8 | Demo and promotion | Lead records and posts; agent drafts | A 60–90 second demo exists; the Skool post and public social post are live, their links are collected, and nothing overclaims unverified results. |

## Positioning

Not "another refund app": verifiable post-purchase consumer protection for NIM commerce. Crypto proves the payment; NimReturn preserves the promise attached to it. The strongest artifact is the Purchase Passport; the strongest consequence is the Promise Ledger.

## Do not build

AI, NFTs, escrow, tokens, multi-chain, arbitration, reviews, star ratings, subjective trust scores, merchant-editable reputation, unnecessary dashboards, new ledger metrics for show, or new protocol surfaces without an observed correctness need.

Path to the top: submit → make the judge path safe → simplify → verify → test with humans → confirm usage rules → run the pilot → stay online → tell the story well.
