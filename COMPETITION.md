# Competition strategy

## Source of truth and warning

NimReturn is being built for **Nimiq Mini Apps Competition — Cycle II**. Competition pages have exposed stale Cycle I rubric/timeline fragments in the past. Do not copy a cached 105-point scorecard or older Cycle II dates. Recheck the live Rules, Scoring, Starter Kit, Submit page, and latest official community announcement before making a deadline or eligibility decision.

Sources reviewed on 2026-09-14:

- https://miniappscompetition.com/rules
- https://miniappscompetition.com/scoring
- https://miniappscompetition.com/starterkit
- https://miniappscompetition.com/submit
- https://www.skool.com/miniappscompetition (official pinned Cycle II announcement/rubric)
- https://www.nimiq.dev/mini-apps
- https://www.nimiq.dev/mini-apps/api-reference/nimiq-provider

Current Cycle II dates: start August 24, 2026; submission cutoff **September 18, 2026 at 23:59 UTC**. The latest official announcement says the cutoff is not a code freeze: builders may continue improving and promoting afterward. The submitted/deployed product must nonetheless already be functional and judgeable by the cutoff.

Cycle II prize pool is $17,000 USDT: $10,000 / $5,000 / $2,000 for the top three, paid under current official terms. Winning is not guaranteed; target score is **92+/100**.

## Eligibility and submission requirements

- Participant age 18+; worldwide except restricted/sanctioned jurisdictions.
- Individual or team up to five with one representative; one submission per team per cycle.
- Public GitHub repository.
- All code open source under MIT.
- Built on and compliant with Nimiq Pay Mini Apps Framework.
- Meaningful NIM or USDT integration; NimReturn deliberately centers native NIM wallet/signature/payment behavior.
- Fully functional, usable on first try; no prototype/mockup.
- Original code/idea or properly attributed dependencies; no substantially copied competitor.
- No hardcoded private keys, API secrets, or credentials.
- Nimiq wallet address for payout and team/GitHub details.
- Current rules say written description max 250 words and demo/walkthrough optional but encouraged; portal schema must be rechecked while signed in.
- Deceptive/scammy UX, undisclosed data practices, or rule manipulation can disqualify.

## Current 100-point rubric

### 45 — Functionality, reliability, and usefulness

Evidence target:

- full purchase→passport→claim→decision→refund lifecycle works without dead ends;
- wallet/RPC cancellation, pending, failure, retry, and reload states are deliberate;
- API/DB invariants reject substitution/replay/races;
- audience/problem are obvious immediately;
- Purchase Passport and Promise Ledger provide repeat value;
- honest, complete product rather than a broad prototype.

Target: **42/45**. The three-point allowance recognizes live-network/merchant variability; do not trade integrity for a nominal perfect flow.

### 25 — Nimiq Pay and Nimiq integration

Evidence target:

- `init()`/`listAccounts()` make wallet the passwordless identity;
- merchant signs policy, buyer signs claim, merchant signs resolution;
- direct purchase/refund use `sendBasicTransactionWithData()` and compact order/claim tags;
- backend independently validates chain evidence rather than trusting returned hashes;
- native dialog, cancellation/failure, mobile WebView resume, and actual-device behavior demonstrated;
- NIM is essential to proof and lifecycle, not an arbitrary button.

Target: **24/25**.

### 15 — Real usage

Latest official Cycle II announcement thresholds:

- 25+ unique Nimiq wallets opening the Mini App: 15 points.
- 11–24: 10 points.
- 4–10: 6 points.
- 0–3: 0 points.

Bot-like traffic is excluded and manipulation can disqualify. Target: **15/15** through a genuine merchant pilot, not an opening campaign alone.

### 10 — Design and UX

Evidence target: clean, consistent, trustworthy mobile UI; unbriefed first-time user reaches/understands the main point within 60 seconds; lifecycle and evidence hierarchy; accessible distinct states; minimal blockchain jargon.

Target: **9/10**.

### 5 — Builder promotion

Current checklist: at least one Skool/community post (2) and one public social post about app/competition (3), with direct links submitted.

Target: **5/5**.

Total target: **95/100 planning target**, with **92+ success target**. This is a prioritization tool, not a claim about judge scoring.

## Competitive position

### NimBooks

The strongest known adjacent product is NimBooks: broad wallet/accounting utility including NIM balances/history, fiat accounting, staking, invoices, signed proof-of-payment receipts, public verification, exports, and wider wallet tooling.

Do not imitate its breadth.

- **NimBooks:** accounting layer for Nimiq Pay—what happened to NIM.
- **NimReturn:** trust/consumer-protection layer—what merchant promised when NIM was spent and what happened afterward.

NimReturn wins its category through a smaller interface, memorable consumer story, deep Nimiq dependence, rigorous proof, factual behavior ledger, and a complete one-minute lifecycle. It loses if it becomes an inferior wallet dashboard or generic merchant marketplace.

### Originality check

Before submission, search current Cycle I/II entries and ecosystem projects again. Record overlap and refine copy/behavior, but do not add random features merely to appear different. The unique bundle is policy-at-purchase signature + original-wallet claim + independently verified direct refund + derived Promise Ledger.

## Pilot plan

### Objective

Produce truthful evidence stronger than 25 opens:

- 25–35+ genuine unique wallets;
- 25+ low-value verified NIM purchases;
- one genuine merchant-like campaign/store;
- several authentic RETURN/WARRANTY claims;
- multiple approved refunds verified on-chain;
- a legitimate rejection only if facts naturally warrant it.

### Recruitment

1. Secure one merchant/campaign before Phase 5 ends and agree on inexpensive, genuinely deliverable items/services.
2. Recruit through existing community, Sip & Ship, local/campus/creator audience, and personal outreach; clearly state real NIM and test/pilot conditions.
3. Schedule two small cohorts before deadline to leave recovery time.
4. Provide a Nimiq Pay deep link/QR only after the core route is stable; no scripted wallet farms, incentives contingent on repeated opens, or synthetic claims.
5. Offer support without operating wallets for users.

### Instrumentation/evidence

Count unique wallet addresses opening/authorizing according to current competition measurement guidance, verified purchases, claim types/eligibility, decisions, verified refunds, completion latency, and failures. Minimize access; publish only aggregates. Reconcile every commerce metric to immutable signature/chain evidence. Do not equate device ID with user or hash small address sets as “anonymous.”

## Judge demo

Use a pre-prepared low-risk merchant/product and current deployed release:

1. Wireless Mouse — 5 NIM; 7-day return; 90-day warranty.
2. Merchant reviews/signs terms in Nimiq Pay; show policy verified.
3. Buyer pays merchant directly; show sent→verifying→passport only after chain check.
4. Passport shows payment, signed policy, deadlines, and expandable evidence.
5. Buyer signs RETURN; checklist shows original buyer, verified purchase, active window, verified policy → POLICY ELIGIBLE.
6. Merchant signs approval and sends 5 NIM to original buyer.
7. Show approval distinct from refund pending, then refund verified.
8. End on factual Promise Ledger and one-sentence limitation.

Have a verified historical passport ready if live network latency exceeds the minute, but label it as prior real evidence and never simulate the live payment as successful.

## Schedule from 2026-09-14

The deadline is close. Critical path is Phase 0 device proof immediately, then the narrow lifecycle, deploy/pilot, and submission assets in parallel only where it does not risk engineering truth. If the full secure lifecycle cannot be made judgeable, reduce presentation scope—not verification checks—and make status honest. Submit a real working slice rather than a mocked complete product.
