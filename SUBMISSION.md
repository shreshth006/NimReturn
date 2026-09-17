# Cycle II submission checklist

This checklist is operational, not permanent truth. Recheck live pages and the authenticated portal immediately before submission: https://miniappscompetition.com/submit, https://miniappscompetition.com/rules, and https://miniappscompetition.com/scoring.

## Eligibility and repository

- [ ] Team members are 18+, eligible by geography, maximum five, with one representative.
- [ ] This is the team's one Cycle II submission and is not a copied/substantially similar existing project.
- [ ] Public GitHub repository exists and URL is final.
- [x] MIT `LICENSE` exists; all project code is compatible with MIT distribution.
- [ ] Dependency notices/attribution and license audit complete.
- [ ] Default branch contains reproducible build and current docs.
- [ ] Git history/repository contains no seed phrase, private key, credential, personal `.env`, production database, or sensitive pilot export.
- [ ] Secret scan and dependency vulnerability review complete.
- [ ] Repository issue/contact route available for judges.

## Working product

- [ ] HTTPS deployment URL is public, fast, and stable.
- [ ] Mini App opens inside current Nimiq Pay on the documented Cycle II target: Android is validated; iOS remains explicitly untested/deferred under D-016.
- [ ] `init`, accounts, signing, direct NIM purchase/refund, cancellation, and independent chain verification tested on device.
- [ ] Complete purchase→passport→claim→resolution→refund flow judgeable.
- [ ] No mock/prototype/fake success path in production.
- [ ] Main point reachable within 60 seconds without instructions.
- [ ] Pending/failure/RPC unavailable/reload states work.
- [ ] Privacy notice, limitations, and no-custody wording visible.
- [ ] Final smoke, accessibility, performance, security, backup/restore, RPC failover, and reconciliation pass.
- [ ] Deployment and historical evidence remain available if a live transaction is delayed.

## Portal fields (verify current schema)

- [ ] App name: **NimReturn**.
- [ ] Tagline: **The payment is your receipt. The merchant's signature is your policy.**
- [ ] Category/audience selected accurately.
- [ ] Description is current and ≤250 words if the current rule remains.
- [ ] Explain what it does, who it serves, and how Nimiq Pay/NIM are central.
- [ ] Public repository URL.
- [ ] Production deployment URL.
- [ ] Team representative name/pseudonym and GitHub profile.
- [ ] Correct Nimiq wallet for USDT payout, independently rechecked; never commit its private key.
- [ ] Any data/privacy/security confirmations answered accurately.
- [ ] Submit before **2026-09-18 23:59 UTC** and retain confirmation/PR link.

## Assets and story

- [ ] App icon at required current dimensions and safe-area treatment.
- [ ] Thumbnail/cover at current required dimensions.
- [ ] Screenshots: product/policy, Passport/lifecycle, eligible claim, verified refund, Promise Ledger; real data sanitized/consented.
- [ ] Short demo video/walkthrough with captions and no exposed sensitive notification/address data.
- [ ] Builder story: problem observed, no-custody trust model, why Nimiq is indispensable, disciplined Phase 0 proof, real pilot lessons.
- [ ] README screenshots/links match deployed app.
- [ ] ≤60-second judge run rehearsed with a fresh wallet/account state.
- [ ] Backup narration/historical evidence plan is honest if network confirmation is slow.

## Promotion and usage

- [ ] Skool/community post published at least once; direct URL saved for 2-point field.
- [ ] Public social post naming NimReturn and the competition; direct URL saved for 3-point field.
- [ ] Posts use accurate claims, deployment link, and Nimiq Pay open link.
- [ ] 25+ genuine unique-wallet target pursued without bots, wallet farms, coercion, or metric gaming.
- [ ] Pilot aggregate evidence reconciled and privacy-reviewed.
- [ ] Feedback/failures triaged before final deploy.

## Candidate ≤250-word description

Use the current 238-word candidate in [`docs/submission-drafts.md`](./docs/submission-drafts.md). It reflects the deployed D-035/D-036 purchase-key claim and refund flow. Recheck its word count and the authenticated portal schema immediately before submission; do not revive older settlement-sender/original-buyer copy.

## Final ten-minute audit

- [ ] Open deployed URL from a new Nimiq Pay session.
- [ ] Check repo/deploy/video/social/Skool links in their submitted forms.
- [ ] Confirm network and payout address with a second person/device.
- [ ] Check UTC time remaining and submit; do not confuse local IST with UTC.
- [ ] Save submission confirmation and public PR/entry URL.
- [ ] Keep monitoring after cutoff; cutoff is not a freeze, but do not break the judgeable release.
