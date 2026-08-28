# Architecture

> See `README.md` “How Hive solves it” for the pitch. This doc traces how a request becomes a running agent, and where each new subsystem (fan-out, attachments, vision) plugs in.

## Request flow

```
Vite / Electron (packages/client/src/pages/ChatPage.tsx)
   │ POST /api/chat {message, sessionId, projectId, harness, model, agent, attachmentIds}
   │ (Base via `VITE_API_BASE`, token via `Authorization: Bearer` or `?token=` on EventSource)
   ▼
Express API (packages/server/src/server.ts) — loopback 127.0.0.1 by default, `assertBindingIsSafe`
   │ corsOptions (allowlist), authMiddleware, json, static
   ├─ Orchestrator.createTask (orchestrator.ts)
   └─ Orchestrator.executeTask
        ├─ fanout/planner.ts   planFanout (may split into N sub-tasks)
        ├─ Router.route        soul → llm (small model, scratch dir) → rules → semantic → default
        │                └─ SecondBrain routing hints (augment, minSamples/minMargin)
        ├─ LoopEngine.run      per-task engine (no shared state), retries on retryable stderr
        │   └─ harnesses/runner.ts  runHarness (cross-spawn, winShim .cmd, timeout, SSE)
        │       └─ eventStream.ts parsers (opencode, claude, codex, gemini, pi, cursor, textCli)
        ├─ RuntimeGuard        watches tool stream, aborts on destructive shell
        └─ kanban.ts / telemetry spans / SecondBrain.recordFeedback
   │
   ▼ harnesses (cwd = worktree if fan-out, else project’s working tree)
     opencode / claude / codex / gemini / cursor-agent / pi / qwen / aider / amp / goose / crush / copilot
     + local models via ollamaDirect / lmstudioDirect
```

- **Sessions persist** in SQLite `storage/cache/hive.db` + `chatSessions.ts`; spans carry `sessionId` so logs group per conversation.
- **SSE** `routes/events.ts` `broadcast` → client single shared `EventSource` (`lib/api.ts:175` `openStream`).
- **Concurrency** `orchestrator.ts:196` `ConcurrencyGate` (`loop.maxConcurrentAgents:0` → auto via `capacity.ts`). Parent fan-out task holds no slot (no deadlock).

## Key subsystems

### Routing (`router.ts`, `harnesses/profiles.ts`, `secondBrain/`)

`soul.md` pin > `llmRoute` (harness+model+agent, fenced task, validated, cached) > `heuristicRoute` (regex rules) > `semanticRoute` (term overlap) > `default`/`fallback`. Learned hints (`applyHints`) can re-rank but never override soul pins. Routing scratch dir is `os.tmpdir()/hive-router` so agents don’t edit the repo.

### Fan-out (`fanout/planner.ts`, `fanout/summary.ts`, `branches.ts`, `orchestrator.ts:387`)

Planner heuristics: `asksForFanout`, single-subtask refusal, ceiling `maxSubtasks`, explicit “use subagents/in parallel” lowers bar. Never recurses (`parentTaskId` guard). Each child: `createParallelBranches` (deduped `branchNameFor` → `createWorktree`), `createKanbanCard(parent_id)`, `Promise.allSettled(executeTask)`, `collectParallelBranches` → `mergeAll` into `currentBranch(repo)` (not hardcoded `main`), `removeWorktree` for merged. Coordinator output = `composeFanoutAnswer`.

### Attachments (`attachments.ts`, `harnesses/attachments.ts`, `routes/attachments.ts`, `visionBridge.ts`)

Stored under `os.tmpdir()/hive-attachments`, absolute paths (sub-agents have different worktrees). Per-harness flag translation (`opencode --file` variadic → prompt first). `GET /api/attachments/:id` → `Content-Disposition: attachment` + `nosniff`. Sub-agents inherit `parent.attachments`.

### Vision (`visionBridge.ts`, `refusal.ts`, `models/catalog.ts`, `harnesses/ollamaDirect.ts`, `lmstudioDirect.ts`)

- Capabilities: Ollama capabilities (authoritative) + LM Studio `/api/v0/models` (`type: vlm`) + fallback family-name; joined with `opencode models` catalog (so `opencode/ollama/ornith-1.5:35b` inherits Ollama vision). `null` → assume can see (don’t degrade).
- Flow: `describeImagesFor(attachments, {harnesses, harness, model, preferred: vision.model})` → describing model → `preamble` + `described` list; described attachments dropped from `HarnessOptions.attachments`. `refusal.ts` tight check (“model can’t see”) near start of short reply; `vision.always` forces pass.

### Permissions (`permissions.ts`, `runtimeGuard.ts`, `harnesses/runner.ts`)

`gateOn: "commands"` default watches `tool` events live, aborts via `AbortSignal` → `proc.kill(SIGTERM→SIGKILL)`, `MAX_GUARD_ATTEMPTS=3`, approved commands remembered via `Set`.

### Storage (`db/database.ts`, `kanban.ts`, `sharedMemory.ts`)

SQLite WAL at `storage/cache/hive.db`, WAL/NORMAL outside `:memory:` (tests use `:memory:`). `kanban_tasks` has `parent_id` for sub-agents; `iterations` NOT NULL → defaults in `finishKanbanCard`. `storage/` gitignored.

## Build & run

- Root `tsconfig.json` references `shared` + `server`; client is Vite-bundled, excluded. `pnpm build` = `tsc --build` + `vite build`. `pnpm typecheck` = `tsc --noEmit`. `tsx` for `dev:server`.
- `bin/hive.js` is the single entrypoint; resolves `hive.config.json` via `process.cwd()` (repo root), probes ports (`hiveIsListening`), streams child logs.

## Sharp edges (from `DEVELOPMENT.md`)

- `winShim.ts`: npm `.cmd` shims truncate multi-line prompts via `cmd.exe`; resolved to `node <script>`.
- `HarnessOptions.timeout` now enforced per iteration (`runner.ts:98`).
- LoopEngine per task (no shared `iteration` state under concurrency / fan-out).
- Config singleton mutated in place; `resetConfigCache` for tests.
