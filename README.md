# Hive - Multi-Agent Orchestration Framework

A CLI-based swarm orchestration framework coordinating AI agents across multiple harnesses (OpenCode, Claude Code, Pi) to autonomously solve complex tasks. Ships as both a standalone server + web UI and a packaged Electron desktop app.

## Status

**Phase 1 MVP shipped and working end-to-end** — server, web UI, and the Electron desktop shell all boot, build, and pass their test/lint/typecheck suites. Phase 2 roadmap at [wayfinder/map.md](.hive/wayfinder/map.md) describes further-out ambitions (swarm decomposition, VRAM-aware queuing).

See [CLAUDE.md](CLAUDE.md) for what's actually implemented vs. design aspirations in the wayfinder docs.

## Architecture

```
Electron desktop shell (packages/client/electron)
    ↓ loads
React UI (packages/client, Vite + React Router, HashRouter)
    ↓ HTTP + SSE
Express REST API (localhost:3001, CORS-enabled)
    ↓
Orchestrator (task dispatch, git branch mgmt)
    ├─ Router (keyword-based harness routing)
    ├─ LoopEngine (retry/recover logic)
    ├─ PermissionManager (destructive action gates, approve/deny API)
    └─ ResourceManager (file locks)
    ↓
Harnesses (CLI subprocesses, spawned via cross-spawn)
├─ OpenCode
├─ Claude Code
└─ Pi
```

The server also ships its own self-contained chat UI (`packages/server/src/public/index.html`) served
at `/`, independent of the Electron/React client — useful for a quick sanity check without building the
desktop app.

## Features

- **Multi-Harness Routing**: Task-aware dispatch to best-fit harness (shared by the API and the retry loop)
- **Autonomous Loop**: Self-correct iterations with heuristic retry rules
- **Permission System**: Prompts on destructive actions (`rm`, `push --force`, etc.), with a real approve/deny API (`/api/permissions`) that actually gates execution
- **Branch-Per-Task**: Auto-managed git branches and PR creation
- **Resource Locking**: Prevents concurrent file conflicts
- **Shared Memory**: Per-session key/value store (JSON file-backed)
- **Live Events**: Server-Sent Events stream (`/api/events`) broadcasting task and schedule lifecycle events
- **Scheduling**: Cron-backed schedules with CRUD endpoints, kept in sync with the running cron jobs as they're created/updated/deleted
- **Config Loading**: `hive.config.json` at the repo root is read and merged over defaults, with `PORT` env var override
- **Desktop App**: Electron shell around the same React UI, working in both dev (`localhost:3000`) and packaged (`file://`) modes
- **Build System**: Solution-style TypeScript build (`tsc --build` works cleanly across all packages)
- **Test Suite**: Vitest coverage for Router, LoopEngine, PermissionManager, Harness interface (31 tests)
- **Linting**: Flat ESLint config (typescript-eslint + react-hooks) across the whole repo, zero warnings

## Quick Start

### Prerequisites

- Node.js 24+, pnpm
- At least one harness on PATH: `opencode --version`, `claude --version`, or `pi --version`
- Git (for branch/PR commands)

### Setup & Run

```bash
pnpm install

# Development
pnpm dev:server          # Run server on :3001 (tsx, no build step)
pnpm dev:client          # Run the Vite dev server on :3000 (browser only)
pnpm dev:electron        # Run the Electron desktop app in dev mode

# Production
pnpm build               # tsc --build → packages/*/dist/
pnpm start                # Run compiled server
pnpm --filter @hive/client electron:build   # Package the desktop app (electron-builder)

# Testing
pnpm test                 # Run all tests (vitest)
pnpm test:ui               # Web UI for tests

# Linting
pnpm lint
pnpm format
```

`pnpm dev:electron` starts the Vite dev server and the Electron shell together, pointed at
`http://localhost:3000`. To try the desktop build the way it'll actually ship, run
`pnpm --filter @hive/client electron:build` and launch the installer/binary it produces under
`packages/client/release/`.

## Configuration

Configuration loads via `loadConfig()` in `packages/server/src/config.ts`: it starts from
`createDefaultConfig()`, then merges `hive.config.json` at the repo root over it if present, then applies
a `PORT` environment variable override if set. Edit `hive.config.json` to change defaults without touching
code — no wiring left to do.

Current defaults:

- Port: 3001 (override with `hive.config.json`'s `server.port` or the `PORT` env var)
- Loop max iterations: 10
- Permission timeout: 60s
- Default harness: opencode → fallback: claude-code

## Project Structure

```
hive/
├── .hive/wayfinder/          # Planning docs & roadmap
│   ├── map.md                # Phase 2 destination & frontiers
│   └── tickets/*.md          # Detailed decisions
├── packages/
│   ├── server/                # Express API + harness orchestration
│   │   ├── src/
│   │   │   ├── index.ts       # Main entry, config + harness setup
│   │   │   ├── server.ts      # Express app, routes, CORS, SSE wiring
│   │   │   ├── config.ts      # Default config + hive.config.json loader
│   │   │   ├── router.ts      # Heuristic task routing
│   │   │   ├── loopEngine.ts  # Retry loop state machine (uses Router)
│   │   │   ├── permissions.ts # Destructive action gating + approve/deny
│   │   │   ├── orchestrator.ts # Task orchestration
│   │   │   ├── gitUtils.ts    # Cross-platform changed-file detection
│   │   │   ├── textUtils.ts   # ANSI stripping for harness output
│   │   │   ├── db/            # SQLite (workflows, schedules)
│   │   │   ├── routes/        # workflows, schedules, permissions, events (SSE)
│   │   │   ├── scheduler/     # Cron job runner, synced with the schedules table
│   │   │   └── harnesses/
│   │   │       ├── claudeCode.ts
│   │   │       ├── opencode.ts
│   │   │       └── pi.ts
│   │   └── *.test.ts          # Vitest coverage
│   ├── client/                 # React UI (Vite) + Electron shell
│   │   ├── electron/            # main.ts, preload.ts — compiled to electron/dist/
│   │   ├── src/
│   │   │   ├── App.tsx          # HashRouter + routes
│   │   │   ├── main.tsx         # Vite/React entry point
│   │   │   ├── components/      # Sidebar, etc.
│   │   │   └── pages/           # Dashboard, Chat, Kanban, Office, Workflows, …
│   │   └── vite.config.mts
│   └── shared/                  # Type definitions (@hive/shared)
├── eslint.config.mjs        # Flat ESLint config for the whole repo
├── vitest.config.ts         # Test configuration
├── tsconfig.json            # Solution-style TypeScript config
├── hive.config.json         # Optional config overrides (read at server startup)
└── CLAUDE.md                # Ground truth: what's built vs. designed
```

## License

MIT
