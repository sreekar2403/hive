# Changelog

All notable changes to Hive are documented here. Format is [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), versioning follows SemVer after `1.0.0` (currently `0.x` pre-release).

## [Unreleased]

### Added

- Fan-out planner: one chat message → N sub-agents with isolated worktrees, sub-cards, and merge into current branch (`loop.fanout`, `fanout/planner.ts`).
- Attachments: drag/drop/paste images & files into Chat, per-harness translation, `GET /api/attachments/:id` (`attachments.ts`).
- Vision fallback: blind local models get image descriptions from a vision model (`visionBridge.ts`, `refusal.ts`), LM Studio `/api/v0/models` VLM detection.
- Windows shim (`winShim.ts`) to avoid `cmd.exe` newline truncation for `.cmd` shims; harness timeout enforcement (`HarnessOptions.timeout`, `loop.timeoutMs`).
- Input hardening: `helmet`, `express-rate-limit` (120 req/min global, 20/min on `/api/chat`), `zod` validation for `/api/chat` (max 20k chars), pagination on `GET /api/tasks` (`limit`/`offset`, max 100).
- OSS hygiene: `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, issue/PR templates, `ARCHITECTURE.md`, `docs/` now tracked.
- CI: `lint-typecheck` job (lint + `tsc --noEmit` + `prettier --check`), test matrix `ubuntu/windows` × `node 20/22`, coverage via `v8`.

### Fixed

- `LoopEngine` shared-instance race under concurrency/fan-out → per-task engine.
- Worktrees created but never used → `cwd` now resolves to isolated checkout.
- `branchNameFor` collision on `task_` prefix → dedup per batch.
- Kanban `500 NOT NULL iterations` on coordinator close → `finishKanbanCard` defaults + parent iteration sum.
- `opencode --file` variadic arg ordering, retry prompt unbounded growth, per-harness image capability.
- `HARNESS_IDS` single source of truth (`config.ts`), `branchNameFor` prefix dedup.

## [0.1.0] - 2026-08-28

Initial public MVP: 12 harnesses, router cascade (soul → llm → rules → semantic → default), loop engine with retries, runtime permission guard, worktree isolation, chat sessions in SQLite, office floor, Kanban, logs/traces, `hive` CLI + `hive doctor`.

[Unreleased]: https://github.com/sreekar2403/hive/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/sreekar2403/hive/releases/tag/v0.1.0
