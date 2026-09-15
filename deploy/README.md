# TestAlbatross staging deployment

This package runs the existing Phase 5 build without changing its protocol: Caddy terminates HTTPS and serves the Vite assets, `/api/*` and `/health` proxy to one Node API, and PostgreSQL remains external and managed. It is a temporary device-validation environment, not Phase 6.

## Required infrastructure

- one Linux host with Docker Compose and inbound TCP 80/443;
- one DNS hostname pointed at that host;
- managed PostgreSQL with encrypted connections and a migration owner able to create/grant roles;
- one working HTTPS TestAlbatross RPC endpoint;
- two database URLs: privileged migration-only and least-privilege runtime.

## One-time database setup

1. Create the empty database and a migration owner through the provider control plane.
2. Copy `deploy/.env.staging.example` to an ignored `deploy/.env.staging` and replace every placeholder. Generate `SESSION_SECRET` from at least 32 unpredictable characters; it is not a wallet secret.
3. Apply the repository migrations:

   ```bash
   docker compose --env-file deploy/.env.staging -f compose.staging.yml --profile tools run --rm migrate
   ```

4. In the provider's protected SQL console, create a dedicated login with no ownership or direct grants, then make it a member of the migration-created group role:

   ```sql
   CREATE ROLE nimreturn_app LOGIN PASSWORD '<unique generated password>';
   GRANT nimreturn_runtime TO nimreturn_app;
   ```

5. Put that login—not the migration owner—in `DATABASE_URL`. Remove the migration URL from the host environment after migrations if the platform allows it.

## Start and prove staging readiness

```bash
docker compose --env-file deploy/.env.staging -f compose.staging.yml build --pull
docker compose --env-file deploy/.env.staging -f compose.staging.yml up -d api web
docker compose --env-file deploy/.env.staging -f compose.staging.yml exec api node dist-server/server/deploy/preflight.js
```

Caddy obtains and renews the public certificate after DNS and ports are correct. The preflight fails unless the public origin is HTTPS, the API reports Phase 5, the runtime database login inherits only the intended role, the social card is reachable, and the RPC reports TestAlbatross with a safe head height. It prints no database/RPC URL or secret.

Do not begin device testing unless preflight returns `ready-for-device-test`. Do not use a community RPC with no uptime commitment for the eventual pilot or production release.

## Shortest consolidated phone run

Use one merchant signer, one intentionally distinct settlement account, and one buyer on tiny TestAlbatross amounts. Keep identifiers and screenshots private.

1. Ordinary browser: prove T-001 provider timeout, then recover by opening the same URL in Nimiq Pay.
2. Merchant v1: cancel account access for T-002, retry, sign/publish v1, change one term, publish v2, and confirm v1 remains immutable.
3. Purchase: cancel once for T-020, retry once, verify exact recipient/value/tag, wait for macro finality, and confirm one independently verified Passport. Reload once before finality to prove safe recovery.
4. Claims: file one self-signed claim. On a second Passport, sign with a different claim key and then complete the exact authorization with the chain-derived buyer. Treat inability to route the buyer signer as FAIL.
5. Decision/refund: sign approval with the policy signer, cancel one refund, then pay from the policy-bound settlement account to the original buyer. Treat inability to route that sender or any mismatched observed sender as FAIL. Wait for independent macro finality.
6. Promise Ledger: reconcile every count to those records, confirm approved/pending becomes verified exactly once, and verify all signer/sender roles remain distinct.
7. Reload the key pages; inspect 320/375/430 px plus 200% text; use keyboard/screen reader/reduced motion; then run the 60-second story with five unbriefed observers.

Record results only with the exact lines in `docs/evidence/consolidated-device-validation.md`. A failed line remains valuable evidence and authorizes only a targeted fix—not a weaker verifier.

## Teardown and recovery

Export sanitized outcomes before teardown. Preserve the managed database until fixes and retests are complete. Stop the host with `docker compose --env-file deploy/.env.staging -f compose.staging.yml down`; do not add `--volumes`, because the Caddy certificate state is recoverable and harmless to retain. Revoke the staging runtime login and rotate the session secret when the environment is retired.
