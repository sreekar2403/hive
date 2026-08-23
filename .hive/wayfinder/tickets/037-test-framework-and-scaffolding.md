**Type:** wayfinder:task
**Blocked by:** none
**Blocks:** none

## Question

There is no test suite anywhere in this repo. Pick a framework (vitest is the natural fit for a
TypeScript/ESM-leaning pnpm workspace) and add initial coverage for the modules with the clearest,
already-known-defective behavior worth locking down: `Router.heuristicRoute`, `LoopEngine`'s retry
logic (`shouldRetry`/`buildRetryPrompt`), `PermissionManager` (including the currently-broken
never-approved timeout path, so fixing it in 025 has a regression test), and the harness `execute`/
`isAvailable` contract (mockable via injecting a fake `spawn`). Wire `pnpm test` at the root once a
per-package or workspace-wide runner config is in place.

## Resolution
Resolved 2026-08-23. vitest is wired (root `test` script = `vitest`; vitest.config.ts present). Added hermetic unit tests: 4 test files, 31 tests all passing — packages/server/src/router.test.ts (heuristicRoute keyword scoring), loopEngine.test.ts (retry logic), permissions.test.ts (including the `approve()`/never-approved timeout regression path), and harnesses/harness.test.ts (execute/isAvailable with injected fake spawn). Verification: pnpm test exits 0; pnpm build still exits 0. Commit not pushed.
