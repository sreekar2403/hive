# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Hive is a multi-agent orchestration framework: a chat UI dispatches a prompt to one of several CLI-based
AI "harnesses" (`opencode`, `claude` (Claude Code), `pi`), which run in a retry loop against the local
git working tree until they succeed or exhaust their iteration budget.

The project is an early, hand-rolled MVP. Treat everything below as a description of what actually runs
today, not of the intended end state (see "Planning docs vs. reality" below).

## Commands

```bash
pnpm install          # install workspace deps (pnpm workspaces: packages/*)
pnpm dev:server        # run the server with tsx, no build step (packages/server/src/index.ts)
pnpm dev:client        # run the Next.js client (packages/client)
pnpm lint              # eslint .
pnpm format            # prettier --write .
```

- **`pnpm build` (`tsc --build`) is currently broken** — the root `tsconfig.json` has no `references`
  array and no matching `src/`, so it has nothing to build. To compile a single package, `cd` into it
  and run `tsc` directly (each of `packages/server`, `packages/shared` has its own working tsconfig).
- **There is no test suite and no test script** anywhere in the repo.
- The server has no on-disk config loading: `hive.config.json` at the repo root is *not* read by
  `packages/server/src/index.ts` — it always calls `createDefaultConfig()` in `config.ts` instead. Edit
  `config.ts` (or wire up reading the JSON file) if you need to change defaults.
- Run a single harness manually to sanity check it's on PATH: `opencode --version`, `claude --version`,
  `pi --version`.

## Architecture

Pnpm workspace with four packages: `shared`, `server`, `client`, `ui` (the last is an empty scaffold —
`packages/ui/src` exists but is empty; `packages/client` is the actual, active UI).

### Request flow

`packages/client` (Next.js/React, `ChatInterface.tsx`) POSTs to a **hardcoded** `http://localhost:3001/api/chat`
→ `packages/server/src/server.ts` (Express, REST only — no WebSocket server exists despite
`@hive/shared/protocol.ts` defining a full WS-style client/server message envelope; that protocol is
currently unused/aspirational) → `Orchestrator.createTask` + `executeTask`
(`packages/server/src/orchestrator.ts`).

`Orchestrator` wires together, per task:
- **`Router`** (`router.ts`) — picks a harness via regex keyword matching against the prompt (e.g.
  `test|spec|assert` → opencode, `refactor|rename` → claude-code), falling back to the first available
  harness. No LLM-based routing despite what the wayfinder docs describe.
- **`LoopEngine`** (`loopEngine.ts`) — runs the chosen harness up to `config.loop.maxIterations` times.
  On failure it inspects `stderr` for a fixed list of retryable substrings (`timeout`, `not found`,
  `permission denied`, ...); if none match, it stops and surfaces the failure rather than retrying
  blindly.
- **`PermissionManager`** (`permissions.ts`) — before execution, checks if the task looks "destructive"
  (substring match against `config.permission.destructiveActions`, e.g. `rm`, `push --force`, `clean`).
  **Nothing in the codebase currently calls `approve()`/`deny()`** — there is no endpoint or UI wired to
  it — so any task classified as destructive will always time out (`config.permission.timeout`, default
  60s) and fail. Keep this in mind before assuming a "permission denied" failure is a routing/harness bug.
- **`ResourceManager`** (`resourceManager.ts`) — in-memory (not persisted) file locks and task contexts;
  cleared on process restart.
- **`SharedMemory`** (`sharedMemory.ts`) — per-session key/value store persisted as one JSON file per key
  under `storage.cacheDir` (`.hive-cache/<sessionId>/<key>.json`).

`Orchestrator.mergeToPR` shells out to `git push` + `gh pr create` directly via `execSync` — no
`simple-git` or branch-manager abstraction exists yet, unlike what `.hive/wayfinder/tickets/009-*`
describes.

### Harnesses (`packages/server/src/harnesses/`)

Each of `opencode.ts`, `claudeCode.ts`, `pi.ts` implements the `Harness` interface from
`packages/shared/src/harness.ts` (`isAvailable`, `execute`, `isCompatible`) by `spawn`-ing the
corresponding CLI as a subprocess with `shell: true` and parsing stdout. This is a synchronous
request/response model (a `Promise` of the full result) — **not** the streaming `AsyncGenerator` design
described in `.hive/wayfinder/tickets/002-cli-harness-abstraction.md`. Changed files are detected
post-hoc via `git diff --name-only HEAD` / `git status --porcelain` against `cwd`, so harness execution
must run inside a git working tree to get `filesChanged`.

### `packages/shared`

Pure type definitions consumed via the `@hive/shared` / `@hive/shared/harness` path aliases (see
`packages/server/tsconfig.json`'s `paths` + `references`). No runtime code. `protocol.ts`'s WS message
types and `index.ts`'s `Session`/`BranchInfo` types are ahead of what the server/client actually use.

### Known inconsistency

`packages/server/package.json` declares `"type": "module"` and `server.ts` uses ESM syntax
(`import.meta.url`), but `packages/server/tsconfig.json` compiles to `"module": "commonjs"`. This works
under `tsx` (used for `dev:server`) but would likely break a plain `tsc` + `node dist/index.js` run —
another reason `pnpm build`/`pnpm start` should not be assumed to work without checking first.

## Planning docs vs. reality

`.hive/wayfinder/map.md` + `.hive/wayfinder/tickets/*.md` and `docs/superpowers/specs/2026-08-19-hive-design.md`
describe a considerably more elaborate design than what's implemented: streaming harnesses, an 8-state
loop state machine with heuristic+LLM-judge verification, a WebSocket protocol, Zustand-based UI stores,
YAML config with Zod validation and env-var precedence, an LLM-tiebreaker router, and a context
compactor. Almost none of that exists in `packages/*` yet — the current code is a much smaller, direct
MVP. When a wayfinder ticket or the design spec is cited as justification for how something works, verify
against the actual source in `packages/` rather than trusting the doc.
