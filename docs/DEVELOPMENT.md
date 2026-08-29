# Development

How to work on Hive: what runs where, the recipes for the changes you're most likely to make, and
the sharp edges that have already cost someone an afternoon.

## Getting set up

```bash
pnpm install
pnpm dev:server     # terminal 1 — API on :3001, via tsx (no build step)
pnpm dev:client     # terminal 2 — Vite on :3000
```

Or `hive` for everything at once, including the Electron window. Prefer the two-terminal form while
working on the server: `tsx` picks up changes on restart without a build, and you can read the
server's log without an Electron window in the way.

Run everything from the repo root. The server resolves `hive.config.json` against `process.cwd()`,
so a server started from `packages/server` silently loads different configuration.

### Scripts

| Script              | What it does                                                       |
| ------------------- | ------------------------------------------------------------------ |
| `pnpm dev:server`   | `tsx packages/server/src/index.ts`                                 |
| `pnpm dev:client`   | Vite dev server for `packages/client`                              |
| `pnpm dev:electron` | UI + Electron window                                               |
| `pnpm build`        | `tsc --build` (shared+server) + `pnpm --filter @hive/client build` |
| `pnpm build:server` | `tsc --build` only                                                 |
| `pnpm build:client` | `pnpm --filter @hive/client build`                                 |
| `pnpm typecheck`    | `tsc --noEmit` over the whole repo                                 |
| `pnpm test`         | `vitest run` (server; see `vitest.config.mts`)                     |
| `pnpm lint`         | eslint, flat config, zero-warning policy                           |
| `pnpm format`       | `prettier --write .`                                               |
| `pnpm format:check` | `prettier --check .` (CI gate)                                     |

`pnpm build` now builds everything: `shared` + `server` via `tsc --build` and the client via Vite.
The root `tsconfig.json` has `references` to `shared` and `server` and excludes `packages/client`
(the UI is bundled, not `tsc`-compiled).

Typecheck without emitting: `pnpm typecheck` from the root or `pnpm --filter @hive/server exec tsc --noEmit` per package.

## The packages

```
packages/shared    Types only, no runtime code. Imported as @hive/shared
                   and @hive/shared/harness via tsconfig `paths` + `references`.

packages/server    Express API, the Orchestrator and its collaborators, harness
                   adapters, model discovery, SQLite, fan-out planner, vision
                   bridge, attachments. The only package that spawns processes
                   or touches disk.

packages/client    The UI. React 19 + React Router (HashRouter, so it works from
                   file:// in Electron) + Tailwind v4. `electron/` is the desktop
                   shell around the same build.
```

### Where things live in the client

```
src/components/ui.tsx     The design system. Every screen composes these.
src/components/           App shell: Sidebar, TopBar, ProjectSwitcher.
src/state/                Context providers mounted above the router, so their
                          state survives navigation: projects, chat, logs.
src/pages/<Name>Page.tsx  One file per screen; anything over ~350 lines gets a
                          sibling folder (pages/kanban/, pages/office/) for its
                          constants, types and sub-components.
src/lib/api.ts            The only place that talks to the server. One shared
                          EventSource for the whole app.
src/index.css             Design tokens. Colours are CSS variables, exposed to
                          Tailwind through @theme inline.
```

Two rules earn their keep here:

- **Compose `ui.tsx`, don't hand-roll Tailwind.** If a screen needs a primitive that doesn't exist,
  add it to `ui.tsx` rather than styling in place — that's how the app keeps reading as one product.
- **Long-lived state goes in `src/state/`, above the router.** A chat run has to keep going when you
  navigate away. State inside a page component is destroyed on navigation, which is right for data
  and wrong for work in progress.

## Recipes

### Add a settings field

A setting has to be added in four places, in this order:

1. **`packages/server/src/config.ts`** — add it to the `Config` interface _and_ to
   `createDefaultConfig()`. Every existing install merges the file over the defaults, so a field
   missing from the defaults is `undefined` for everyone who already has a config on disk.
2. **`packages/server/src/routes/settings.ts`** — if it needs checking, add a case to
   `validatePartialConfig`, and add it to `toView()` so the client sees it. There are no secrets in
   settings: harness CLIs hold their own credentials, so nothing here needs masking.
3. **`packages/client/src/pages/settings/types.ts`** — mirror it in `SettingsConfig`. This is a
   hand-written mirror on purpose: `@hive/shared` carries runtime-agnostic types, not the server's
   on-disk config shape.
4. **The relevant section component** — `HarnessesSection`, `ModelsSection`, `RoutingSection`, or
   one of `SystemSections`.

`loadConfig()` returns a cached singleton and `PUT /api/settings` mutates _that object_ in place, so
a saved setting takes effect immediately — no restart. The flip side: editing `hive.config.json` by
hand while the server is running does nothing until it restarts.

### Add a harness

1. Implement the `Harness` interface from `packages/shared/src/harness.ts` in
   `packages/server/src/harnesses/<name>.ts`: `isAvailable`, `execute`, `isCompatible`. Keep it
   thin — `runner.ts` does the spawning.
2. Add a parser to `eventStream.ts` that normalises the CLI's output into the shared `HarnessEvent`
   vocabulary (`text | thinking | tool | tool-result | usage | status | error`). Document the real
   shapes you observed in a comment, and pin them in `eventStream.test.ts` — that test is what
   turns "the chat window went empty" into a failing test when a CLI changes its format.
3. Register it in `harnesses/index.ts`, add its id to `HarnessId` in `config.ts` and to
   `createDefaultConfig().harnesses`, and add it to `HARNESS_IDS` in both
   `routes/settings.ts` and `pages/settings/types.ts`.
4. Give it a colour: `--hive-agent-<name>` in `src/index.css`, then add it to `HARNESSES` in
   `pages/kanban/constants.ts` and `AGENT_VAR` in `OfficeFloorPage.tsx`.
5. Teach `models/catalog.ts` how to ask it what it can run, if it has a way to answer.

**`result.output` must be the readable answer, never a raw envelope.** Claude Code's
`--output-format json` was once dumped into the chat verbatim; the parser now takes the `result`
field. Whatever your CLI emits, unwrap it.

### Add a board column

`TaskStatus` is declared twice and both must agree, or the first drag onto the new column 400s:

1. `packages/server/src/routes/tasks.ts` — the `TaskStatus` union and the `STATUSES` array, plus
   `PRE_START` / `TERMINAL` if the column changes what `started_at` and `completed_at` mean.
2. `packages/client/src/pages/kanban/types.ts` — the same union.
3. `packages/client/src/pages/kanban/constants.ts` — a `ColumnDef` in `COLUMNS`. Position in that
   array is the column's position on the board; `minorByDefault` starts it collapsed.

The board does no migration, so existing rows keep whatever status they had. Renaming a status
string orphans rows that hold the old one.

### Add an endpoint

Route modules live in `packages/server/src/routes/` and are mounted in `server.ts`. Conventions
worth matching:

- `PUT` is a partial update (patch), not a replace. `/api/projects/:id`, `/api/tasks/:id` and
  `/api/schedules/:id` all work this way, which is why the client has one `API.put` helper.
- Response fields stay `snake_case` when they come straight from SQLite. Don't half-convert.
- Anything that changes state should `broadcast(...)` from `routes/events.ts` so the UI updates
  without polling.
- Never interpolate a client-supplied path into a shell command. Use `gitArgs()` (no shell) and
  `isPathWithinRepo()` from `gitUtils.ts`.

## Fan-out, attachments, vision

- **Fan-out** (`packages/server/src/fanout/planner.ts:1`): one chat message → N sub-agents. Planner declines by default (`asksForFanout`, `planFanout`); short prompts (<80 chars) never fan out. Each subtask gets a branch+worktree (`branches.ts` `createWorktree`), a Kanban sub-card with `parent_id` (`kanban.ts`), runs under `ConcurrencyGate`, then `mergeAll` into the _current_ branch (`loop.fanout.merge`). Parent is a coordinator — no harness, no concurrency slot (avoids deadlock at `maxConcurrentAgents:1`), and not shown as a peer agent. See `orchestrator.ts` `planFanoutFor` / `runFanout`.
- **Attachments** (`attachments.ts`, `harnesses/attachments.ts`, `routes/attachments.ts`): stored under OS temp, absolute paths (sub-agents have different worktrees), `Content-Disposition: attachment`. Harness translation: `opencode --file` (variadic — prompt first), `codex --image`, others prompt-named, `ollamaDirect`/`lmstudioDirect` inline.
- **Vision** (`visionBridge.ts`, `refusal.ts`, `catalog.ts`): Ollama capabilities + LM Studio `/api/v0/models` (`vlm` vs `llm`), fallback to family-name guess; `null` → assume can see. Refusals detected and not forwarded as image facts. Config `vision.model` / `vision.always` in `config.ts`.

## Testing

`pnpm test` runs `vitest run` (server). Suites: `router`, `loopEngine`, `permissions`, `harness`, `eventStream`, plus `fanout/*`, `visionBridge`, `attachments`, `winShim`, `kanban`. Client has initial `routingRules.test.ts` + `office/*` logic tests; gate them via `vitest.config.mts` projects.

`eventStream.test.ts` is the one to extend most often: it pins each CLI's real event shapes, taken
from captured runs. When a CLI changes format, that test fails — which is the whole point, because
the alternative is the chat window silently going blank in production.

Client changes should pass `pnpm --filter @hive/client exec tsc --noEmit`, `pnpm lint`, and `pnpm exec vitest run`.

## Ports & API base

API defaults to `3001`, UI to `3000`. `bin/hive.js` sets `VITE_API_BASE=http://localhost:<apiPort>` for Vite and `HIVE_API_BASE`/`HIVE_UI_URL` for Electron. If you start pieces manually, export `VITE_API_BASE` yourself. `hive doctor` distinguishes “Hive listening on <port>” vs “port in use by something else”.

## Sharp edges

**The server's module system is inconsistent.** `packages/server/package.json` declares
`"type": "module"` and `server.ts` uses `import.meta.url`, but its `tsconfig.json` compiles to
CommonJS. This works under `tsx` (which is what `dev:server` uses) and is the reason to be
suspicious of `pnpm start` — verify a compiled run rather than assuming it works.

**Config is a singleton, mutated in place.** See "Add a settings field" above. This is deliberate —
it's how a saved setting reaches the Router and LoopEngine without a restart — but it means
`loadConfig()` ignores the file after the first call. `resetConfigCache()` exists for tests.

**`ResourceManager` and the Orchestrator's task map are in-memory.** File locks and task history are
lost on restart. The Kanban board is _not_ the Orchestrator's task list — it's a separate SQLite
table (`kanban_tasks`) with its own CRUD. Don't assume moving a card runs anything.

**opencode needs `--dir`.** It runs a server of its own and resolves the workspace independently of
the spawn cwd, so without `--dir` a task silently runs in the wrong directory. `options.model` also
maps to a different flag per CLI (`-m`, `--model`).

**Changed files are detected post-hoc**, with `git diff --name-only HEAD` and `git status
--porcelain` against the cwd. A harness running outside a git working tree reports no files changed
— which is why the General workspace `git init`s itself on creation.

**pixi's `resizeTo` only watches the window.** The Office floor uses a `ResizeObserver` on its
container instead, because the pane can change width without the window doing so.

**A `<label>` will not forward clicks to a `Switch`.** It renders a `<button role="switch">`, and a
label's implicit activation doesn't apply. Put the caption in a `<span>` beside it and pass the real
text as the switch's `label` prop for screen readers.

## Planning docs vs. reality

`.hive/wayfinder/` and `docs/superpowers/specs/` describe a considerably more elaborate system than
what runs: an 8-state loop machine with an LLM judge, a WebSocket protocol, Zustand stores, YAML
config with Zod validation, an LLM-tiebreaker router, a context compactor. `protocol.ts` in
`packages/shared` defines that WebSocket envelope and nothing uses it.

Treat those documents as intent, not description. When one is cited as justification for how
something works, check `packages/` first.
