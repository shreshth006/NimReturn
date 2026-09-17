# Submission and promotion drafts

Drafts only. Recheck the live rules and portal fields before submitting, and do not post results that have not been verified.

- App: https://nimreturn-staging-cycle2.onrender.com/
- Repository: https://github.com/shreshth006/NimReturn

## Competition description (≤250 words)

**NimReturn — The payment is your receipt. The merchant's signature is your policy.**

Crypto proves that you paid. It does not prove what the merchant promised when you paid. NimReturn is a consumer-protection layer for Nimiq Pay that keeps that promise attached to the payment.

A merchant signs return and warranty terms with their Nimiq wallet. Before paying, the buyer sees those verified terms and signs a short purchase key. The buyer pays in NIM directly to the merchant, and NimReturn independently verifies the transaction through Albatross finality. The result is a Purchase Passport that permanently binds the purchase to the exact policy version that existed at checkout, even if the merchant later changes their terms.

If something goes wrong, the buyer files a signed return or warranty claim. NimReturn checks it deterministically against the original policy window. The merchant signs a decision, refunds NIM through Nimiq Pay, and NimReturn verifies the refund on chain. Every verified event feeds a public Promise Ledger: purchases, eligible claims, decisions, and refunds, calculated only from signatures and chain evidence. No reviews, no star ratings, no editable trust score.

NimReturn never holds funds or keys. Nimiq Pay handles every signature and payment; the chain proves money moved, and signatures prove what was promised and decided.

It currently runs on Nimiq Testnet (TestAlbatross). Judges can open a completed example without a wallet, or switch Nimiq Pay to Testnet to make a protected purchase.

## Skool post

**Can you tell what NimReturn does without me explaining it?**

I'm building NimReturn for Cycle II: merchant-signed return/warranty terms that stay attached to your NIM payment, with claims, signed decisions, and independently verified refunds.

I'd love honest first-impression testing:

1. Open https://nimreturn-staging-cycle2.onrender.com/ in Nimiq Pay.
2. Before reading anything else, write one sentence about what you think it does.
3. Tap **View a completed example** (no wallet needed) and tell me where you got confused.
4. Optional: switch Nimiq Pay to Testnet and try a protected purchase.

Every confusing moment helps. Repo: https://github.com/shreshth006/NimReturn

Question for the organizers: how is Cycle II real usage counted for a Mini App that runs on Testnet? Does opening it count, or is a signature/transaction needed?

## Public social post

Crypto proves you paid. It doesn't prove what you were promised.

NimReturn keeps the merchant's signed return and warranty terms attached to your NIM payment, then verifies every claim, decision, and refund on chain.

No reviews. No star ratings. Just signed promises and verified payments.

Try the completed example (no wallet needed): https://nimreturn-staging-cycle2.onrender.com/

Built for the Nimiq Mini Apps Competition #Nimiq

## Demo video script (60–90 seconds)

| Time | Show | Say |
|------|------|-----|
| 0–10s | Title card | "Crypto proves you paid. It doesn't prove what the merchant promised when you paid." |
| 10–25s | Merchant studio: signed policy card | "The merchant signs return and warranty terms with their Nimiq wallet." |
| 25–35s | Product page → sign purchase key → pay | "The buyer sees those verified terms and pays in NIM." |
| 35–45s | Purchase Passport | "The Passport locks this purchase to the exact terms at checkout." |
| 45–55s | New policy version, old Passport unchanged | "Even if the merchant changes the policy later, this purchase keeps its original promise." |
| 55–65s | Claim → "Policy eligible" → merchant approval | "A claim is checked against the original terms, and the merchant signs the decision." |
| 65–80s | Refund verified → Promise Ledger | "The refund is verified on chain, and the Promise Ledger updates from evidence only." |
| 80–90s | End card | "NimReturn. Promises, counted from proof." |
