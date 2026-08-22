# Hive — Wayfinder Map

**Label:** `wayfinder:map`
**Created:** 2026-08-19
**Destination revised:** 2026-08-21 (Phase 2 — see below)

---

## Destination

Hive becomes a **production-ready, local-first Electron desktop app for a single user**, running a swarm
of CLI-based coding agents — **opencode, claude-code, pi, and hermes (Nous Research's agentic harness)**
— across both cloud and local models/providers. A sidecar Node/Express backend (SQLite-backed, config
actually loaded, permissions wired to a real UI, task state surviving restarts) takes a request,
**automatically decomposes it into subtasks (configurable cap)**, and runs them as a real swarm: multiple
harnesses/models in parallel, coordinated by a persisted lock manager, **VRAM-aware so local-model
subtasks are sequenced** while cloud subtasks run freely alongside. The Electron UI gives you: a
**Dashboard** overview of all agents/sessions, **Chat**, a **visual office-floor view (Munder-Difflin
style) showing agents at work**, a **Kanban** task board, **live streaming output** per task, a
**read-only Git/diff view**, a **Settings** page to map task categories (frontend/backend/testing/
architecture/...) to specific models+providers, keyword-searchable **Memory**, a **Permissions**
queue+history, and a global **Logs** feed.

This **supersedes** Phase 1 below rather than resuming it — Phase 1's unbuilt ambitions (WS state
machine, Zustand, YAML+Zod config, LLM-tiebreaker router, context compactor) are not being resurrected;
Phase 2 designs fresh from what actually shipped.

### Phase 1 destination (superseded, kept for history)

A working Hive swarm agent framework: a single React web chat interface that dispatches queries to swarm
agents running on CLI harnesses (opencode, claude code, pi), with autonomous loop engineering, shared
memory, git branch coordination, and permission gating. Personal tool, local-first, single-process
monolith. **Status: MVP shipped, but simpler than this destination described** — see `CLAUDE.md` at repo
root for what actually exists today vs. what these Phase 1 tickets decided.

---

## Notes

- **Spec (Phase 1, historical):** `docs/superpowers/specs/2026-08-19-hive-design.md`
- **Phase 2 ground truth:** `CLAUDE.md` at repo root — describes what's actually implemented today,
  including known defects (permission approve/deny never wired, config file never read, broken root
  build, ESM/CJS mismatch). Read it before trusting Phase 1 tickets below.
- **This effort carries execution into the map** (overriding the skill's plan-don't-do default):
  resolving a ticket here should land working code, not just a decision doc — the destination is a
  shipped app, not a handoff spec. Still record the decision itself in the resolution comment.
- **Reference UI:** github.com/chaitanyagiri/munder-difflin — Electron + Pixi.js office-floor + xterm.js
  terminals + Monaco git IDE + SQLite + kanban + memory search. Hive is adopting its functional surface
  *and* its office-floor aesthetic, not its git-mailbox coordination protocol.
- **Harnesses:** opencode, claude-code, pi, hermes — all CLI-based, invoked via child_process (streaming
  approach TBD per-harness, see ticket 027).
- **Local LLMs:** Ollama + LM Studio, VRAM-aware queuing so only one local-model task runs at a time
  (ticket 024).
- **Platform:** Windows (win32), PowerShell, Node v24.
- **No git repository exists yet in this workspace** — ticket 015 fixes that; a large fraction of Hive's
  own design (branch-per-task, `git diff` change detection, `mergeToPR`) is inert until it does.

---

## Decisions so far

<!-- the index: one line per closed ticket, enough to judge relevance, then zoom the link for the detail the ticket holds -->

### Phase 1 (superseded destination, kept for history — see Notes)

- [001-project-scaffold](tickets/001-project-scaffold.md): npm workspaces with packages/server, packages/ui, packages/shared. tsx for dev, concurrently for parallel dev servers, vite for UI build.
- [002-cli-harness-abstraction](tickets/002-cli-harness-abstraction.md): Capability-based Harness interface with AsyncGenerator streaming. CapabilitySet declares streaming, toolUse, modelSelection, sessionResume.
- [003-loop-engine-core](tickets/003-loop-engine-core.md): State machine with 8 states (idle/act/observe/verify/revise/paused/done/failed). Two-phase verify: heuristic then LLM-judge. Permission interruption during observe.
- [004-shared-memory-design](tickets/004-shared-memory-design.md): Per-query in-memory store with save-on-completion. EventEmitter for cross-agent messaging. Snapshot every 30s for crash recovery.
- [005-orchestrator-wiring](tickets/005-orchestrator-wiring.md): Event-driven coordinator. handleQuery → route → resource acquire → loop → compact → PR → save. Multi-session via Map. Cancellation kills child process.
- [006-router-implementation](tickets/006-router-implementation.md): Keyword scoring with LLM tiebreaker. @override parsing for model/harness. Fixed routing table, no learning.
- [007-websocket-protocol](tickets/007-websocket-protocol.md): Envelope pattern with typed message unions. Server→UI and UI→Server message types. Reconnection replay. Permission flow via request/respond.
- [008-react-app-setup](tickets/008-react-app-setup.md): Zustand stores (sessions, messages, ui). TailwindCSS with hive color palette. Component hierarchy: Layout → Sidebar + Main → Chat + AgentPanel + SettingsModal.
- [009-branch-manager-design](tickets/009-branch-manager-design.md): Git-agnostic with simple-git. Sequential merge into temp branch. Parallel file ownership tracking. PR optional via gh CLI.
- [010-permission-system-design](tickets/010-permission-system-design.md): Dual-phase detection: prompt scan (pre-execution) + output scan (during streaming). Configurable whitelist/blacklist/session allowances. 30s timeout.
- [011-resource-manager-design](tickets/011-resource-manager-design.md): Boolean lock + FIFO queue for local models. Cloud tasks bypass entirely. Queue timeout configurable. Force-release on cancellation.
- [012-context-compactor-design](tickets/012-context-compactor-design.md): LLM summarizer via haiku with tiktoken counting. Truncate fallback. Budget: 10K tokens per agent. Compacts after every iteration.
- [013-config-system](tickets/013-config-system.md): YAML config with env var overrides. Three-tier precedence: env > user config > project config. Zod validation. Settings UI writes to ~/.config/hive/config.yaml.
- [014-end-to-end-wiring](tickets/014-end-to-end-wiring.md): Walking skeleton. Full flow with real implementations. Build order: shared → server → ui → root scripts. Definition of done: npm run dev → query → loop → stream → done.

- [Architecture approved](docs/superpowers/specs/2026-08-19-hive-design.md): Single-process monolith with React UI, WebSocket, shared memory, CLI harnesses
- [Loop engineering defined](docs/superpowers/specs/2026-08-19-hive-design.md): act → observe → verify → revise cycle with safety rails
- [Routing approach](docs/superpowers/specs/2026-08-19-hive-design.md): Pattern-based with smart defaults, user override via @syntax
- [Resource management](docs/superpowers/specs/2026-08-19-hive-design.md): Local LLM lock, VRAM threshold, task queue with cloud fallback
- [Context compaction](docs/superpowers/specs/2026-08-19-hive-design.md): Token budget per agent, cheap model compactor, preserve key decisions
- [Branch strategy](docs/superpowers/specs/2026-08-19-hive-design.md): Sequential = separate branches → single PR; Parallel = shared branch with file locking
- [Permission system](docs/superpowers/specs/2026-08-19-hive-design.md): Pattern detection, ask/allow-session/always-allow levels, deny triggers REVISE
- [Multi-session UI](docs/superpowers/specs/2026-08-19-hive-design.md): Sidebar with session list, status icons, search, collapsible

### Phase 2 (current destination)

<!-- Empty so far — no Phase 2 tickets closed yet. -->

---

## Tickets

Tracker convention: local markdown, no native blocking, so each ticket states its own `**Blocked by:**` /
`**Blocks:**` lines. A ticket is unblocked when everything in its `Blocked by:` line is closed.

### Frontier (unblocked, ready to work)

- [015-git-repository-bootstrap](tickets/015-git-repository-bootstrap.md) — task, AFK
- [016-hermes-harness-research](tickets/016-hermes-harness-research.md) — research, AFK (subagent fired)
- [017-harness-provider-model-research](tickets/017-harness-provider-model-research.md) — research, AFK (subagent fired)
- [018-sqlite-schema-design](tickets/018-sqlite-schema-design.md) — grilling
- [023-swarm-decomposition-design](tickets/023-swarm-decomposition-design.md) — grilling
- [026-electron-shell-and-transport-design](tickets/026-electron-shell-and-transport-design.md) — grilling
- [037-test-framework-and-scaffolding](tickets/037-test-framework-and-scaffolding.md) — task
- [038-build-and-module-system-fix](tickets/038-build-and-module-system-fix.md) — task

### Blocked (waiting on frontier)

- [019-persistent-state-migration](tickets/019-persistent-state-migration.md) — blocked by 018
- [020-config-loading-fix](tickets/020-config-loading-fix.md) — blocked by 021
- [021-category-routing-settings-design](tickets/021-category-routing-settings-design.md) — blocked by 017, 018
- [022-router-category-integration](tickets/022-router-category-integration.md) — blocked by 021
- [024-vram-aware-queue-design](tickets/024-vram-aware-queue-design.md) — blocked by 017, 023
- [025-permission-ui-wiring](tickets/025-permission-ui-wiring.md) — blocked by 018
- [027-per-harness-streaming-adapter](tickets/027-per-harness-streaming-adapter.md) — blocked by 016, 017, 026
- [028-dashboard-overview](tickets/028-dashboard-overview.md) — blocked by 026
- [029-office-floor-visualization](tickets/029-office-floor-visualization.md) — blocked by 023, 026
- [030-kanban-board](tickets/030-kanban-board.md) — blocked by 018, 026
- [031-settings-page-model-provider](tickets/031-settings-page-model-provider.md) — blocked by 021, 026
- [032-permissions-panel](tickets/032-permissions-panel.md) — blocked by 025, 026
- [033-logs-panel](tickets/033-logs-panel.md) — blocked by 018, 026
- [034-memory-search-panel](tickets/034-memory-search-panel.md) — blocked by 018, 026
- [035-git-diff-panel](tickets/035-git-diff-panel.md) — blocked by 026
- [036-chat-panel-rework](tickets/036-chat-panel-rework.md) — blocked by 026, 027

---

## Not yet specified

<!-- Phase 1 fog fully resolved. Phase 2 fog below: in scope, not yet sharp enough to ticket. -->

- Office-floor art/asset pipeline specifics (sprite set, animation states, how many concurrent agents
  fit on screen once swarm decomposition can spawn several at once) — depends on what 029 and 023
  settle first.
- Exact decomposition failure/retry/merge semantics beyond the initial design in 023 — will graduate
  once 023's first pass is resolved and tested against a real multi-subtask run.
- Multi-window / multi-monitor support — never raised during grilling; revisit if it turns out to matter
  once the Electron shell (026) exists.
- Whether the swarm decomposer itself needs its own model/category assignment (a "planner model" choice
  in Settings) — depends on how 023 and 021 land.

---

## Out of scope

- **Networked / multi-tenant / remote access** — Hive stays single-user, local-first; a shared server or
  team deployment is a different effort, not a redraw of this one.
- **Git-mailbox agent-coordination protocol** (à la the munder-difflin reference) — Hive keeps its
  existing in-app lock manager (persisted via 018/019) instead of coordinating agents through git itself.
- **Semantic/embedding-based memory search** — keyword/FTS5 (018) is the destination for this map; may
  return as its own future effort if FTS proves insufficient.
- **UI-driven git actions** (stage/commit/push/PR buttons in the app) — the git panel (035) is read-only;
  `Orchestrator.mergeToPR` remains the only path that touches git for real.
- **Installer/packaging** (electron-builder distribution) — this map's destination is a source-run
  Electron app; packaging is a separate, later, mechanical effort.
