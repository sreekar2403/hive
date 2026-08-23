**Type:** wayfinder:task
**Blocked by:** none
**Blocks:** none

## Question

Two independent build defects, worth fixing together since both block `pnpm build`/`pnpm start` from
ever working: (1) the root `tsconfig.json` has no `references` array and no matching `src/`, so `tsc
--build` fails with "no inputs were found" — turn it into a proper solution-style config referencing
`packages/shared` and `packages/server` (and `packages/client` if it moves off Next.js's own build). (2)
`packages/server/package.json` declares `"type": "module"` and `server.ts` uses ESM syntax
(`import.meta.url`), but `packages/server/tsconfig.json` compiles to `"module": "commonjs"` — this only
works today because `dev:server` runs via `tsx`; a real `tsc && node dist/index.js` would break. Pick one
module system for the server package and make the tsconfig, package.json, and actual import syntax agree.

## Resolution
Resolved 2026-08-23. `pnpm build` (tsc --build) now exits 0. Standardized packages/server on an ESM module system: changed packages/server/tsconfig.json module from 'commonjs' to 'esnext' so it matches package.json type:module and server.ts's import.meta.url usage. Root tsconfig references resolve cleanly. Verification: pnpm build exits 0; pnpm test still green (31 tests, 4 files). No commit pushed. Recommendation: wire an explicit package exports map for packages/server if consumers need type resolution.
