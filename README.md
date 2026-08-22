# Hive - Multi-Agent Orchestration Framework

A CLI-based swarm orchestration framework coordinating AI agents across multiple harnesses (OpenCode, Claude Code, Pi) to autonomously solve complex tasks. Built as an MVP with essential features wired—no unused abstractions.

## Status

**Phase 1 MVP shipped** (simplified, hand-rolled). Phase 2 roadmap at [wayfinder/map.md](.hive/wayfinder/map.md) describes the next destination: a local-first Electron app with swarm decomposition, SQLite persistence, and VRAM-aware queuing.

See [CLAUDE.md](CLAUDE.md) for what's actually implemented vs. design aspirations.

## Architecture

```
React Chat UI (Next.js)
    ↓
Express REST API (localhost:3001)
    ↓
Orchestrator (task dispatch, git branch mgmt)
    ├─ Router (keyword-based harness routing)
    ├─ LoopEngine (retry/recover logic)
    ├─ PermissionManager (destructive action gates)
    └─ ResourceManager (file locks)
    ↓
Harnesses (CLI subprocesses)
├─ OpenCode
├─ Claude Code
└─ Pi
```

## Features

- **Multi-Harness Routing**: Task-aware dispatch to best-fit harness
- **Autonomous Loop**: Self-correct iterations with heuristic retry rules
- **Permission System**: Prompt on destructive actions (`rm`, `push --force`, etc.)
- **Branch-Per-Task**: Auto-managed git branches and PR creation
- **Resource Locking**: Prevents concurrent file conflicts
- **Shared Memory**: Per-session key/value store (JSON file-backed)
- **Build System**: Solution-style TypeScript build (tsc --build works)
- **Test Suite**: Vitest coverage for Router, LoopEngine, PermissionManager, Harness interface

## Quick Start

### Prerequisites

- Node.js 24+, pnpm
- At least one harness on PATH: `opencode --version`, `claude --version`, or `pi --version`
- Git (for branch/PR commands)

### Setup & Run

```bash
pnpm install

# Development
pnpm dev:server        # Run server on :3001 (tsx, no build step)
pnpm dev:client        # Run Next.js client on :3000

# Production
pnpm build             # tsc --build → packages/*/dist/
pnpm start             # Run compiled server

# Testing
pnpm test              # Run all tests (vitest)
pnpm test:ui           # Web UI for tests

# Linting
pnpm lint
pnpm format
```

## Configuration

Configuration is loaded from `packages/server/src/config.ts` (function `createDefaultConfig()`). To change defaults, edit that file directly or wire up reading from a JSON file (the roadmap's ticket 020-config-loading-fix covers this).

Current defaults:
- Port: 3001
- Loop max iterations: 10
- Permission timeout: 60s
- Default harness: opencode → fallback: claude-code

## Project Structure

```
hive/
├── .hive/wayfinder/        # Planning docs & roadmap
│   ├── map.md              # Phase 2 destination & frontiers
│   └── tickets/*.md        # Detailed decisions
├── packages/
│   ├── server/             # Express API + harness orchestration
│   │   ├── src/
│   │   │   ├── index.ts    # Main entry, harness setup
│   │   │   ├── server.ts   # Express + endpoints
│   │   │   ├── router.ts   # Heuristic task routing
│   │   │   ├── loopEngine.ts  # Retry loop state machine
│   │   │   ├── permissions.ts  # Destructive action gating
│   │   │   ├── orchestrator.ts # Task orchestration
│   │   │   └── harnesses/
│   │   │       ├── claudeCode.ts
│   │   │       ├── opencode.ts
│   │   │       └── pi.ts
│   │   └── *.test.ts       # Vitest coverage
│   ├── client/             # Next.js React UI
│   │   └── src/ChatInterface.tsx
│   └── shared/             # Type definitions (@hive/shared)
├── vitest.config.ts        # Test configuration
├── tsconfig.json           # Solution-style TypeScript config
└── CLAUDE.md               # Ground truth: what's built vs. designed
```

## Known Gaps (Phase 1)

- **No git repo yet**: ticket 015 initializes the repo (tickets depend on it)
- **Config file not read**: ticket 020 wires up hive.config.json loading
- **No permission UI**: ticket 025 wires the approval endpoint and UI
- **No tests for some modules**: ticket 037 adds initial vitest coverage (done)
- **Build system was broken**: ticket 038 fixes root tsconfig references (done)

Phase 2 roadmap adds: SQLite persistence, Electron shell, VRAM-aware task queuing, swarm decomposition.

## License

MIT
