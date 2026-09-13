# Instructions for coding agents

Before editing, read `README.md`, `RULES.md`, `PRD.md`, `ARCHITECTURE.md`, `PROTOCOL.md`, `MEMORY.md`, and `STATUS.md`. Read `SECURITY.md`, `DATA_MODEL.md`, and `TESTING.md` for any work touching trust, persistence, or verification.

## Working agreement

- Respect the current phase and its exit criteria. Do not casually expand scope.
- Preserve the no-custody, no-private-key, independently verified transaction model.
- Do not weaken signature verification, public-key/address binding, canonicalization, replay protection, uniqueness, or state transition checks.
- Never add a fake or mock success path reachable in production. Fixtures must be test-only or visibly diagnostic.
- Treat all Luna amounts as safe integers; reject unsafe, negative, fractional, or contextually invalid values.
- Validate every API boundary with explicit schemas. Database constraints are part of correctness, not optional hardening.
- Add or change tests whenever behavior changes. Include failure, cancellation, retry, reload, and boundary cases where relevant.
- If architecture or protocol changes, update the corresponding document and append a decision to `DECISIONS.md`; do not rewrite old decision records.
- Prefer small, direct modules. Do not add abstraction layers, services, queues, or infrastructure without a present need.
- Preserve unrelated user changes. Never discard a dirty worktree or use destructive Git commands without explicit authorization.

## Completion gate

Run all relevant checks before declaring work complete:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Inspect mobile layout and test inside Nimiq Pay when the task affects wallet or mobile behavior. Automated tests cannot substitute for native approval-dialog and actual-network evidence.

Before handoff, update `MEMORY.md` and `STATUS.md` concisely with what is complete, what was actually manually verified, blockers, and the next highest-priority actions.

Ask for human input only when blocked by credentials, a physical-device action, a consequential product choice, or another external action that cannot be safely inferred. Otherwise make the smallest defensible engineering decision, append it to `DECISIONS.md` when material, and continue.
