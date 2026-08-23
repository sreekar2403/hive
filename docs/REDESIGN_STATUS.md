# Redesign status

Tracking the P0 redesign. Read `docs/DESIGN_SYSTEM.md` before picking anything up.

## Done

| # | Task | Notes |
|---|---|---|
| T1 | Design system + app shell + project context | "Ledger" tokens (light + dark), 15 primitives in `src/components/ui.tsx`, grouped sidebar, top bar, `ProjectSwitcher`, `ProjectContext`, `src/lib/api.ts`. |
| T2 | Office floor | pixi floor with 7 zones where **zone = pipeline phase**. Named characters (Ollie/Cass/Pia) drawn procedurally, A* pathfinding, walk cycle, theme-aware, click-to-inspect. Verified live: a "test spec" prompt moved its agent to QA Lab. |
| T3 | Workflow builder | React Flow canvas, 8 custom node types, palette, inspector, undo/redo, auto-layout, live validation, project-scoped autosave to `/api/workflows`. |

| T4 | Settings | Six sections (providers, harnesses, task routing, execution, permissions, general) with a left sub-nav and a save bar that only appears when dirty. Round-trip verified UI → API → hive.config.json. |
| T10a | Dashboard | Real stats: live agents, uncommitted-file counts from git, harness availability with versions. |
| — | Electron | No longer force-opens DevTools; F12 / Ctrl+Shift+I toggles instead. Window no longer flashes white on launch. |

## Backend landed (needs UI)

These route modules are implemented and mounted, but their screens are still the old UI:

- `routes/git.ts` — status / diff / branches / log, project-scoped
- `routes/settings.ts` — providers, harnesses, task routing
- `routes/tasks.ts` — task list for Kanban
- `routes/memory.ts` — session/key CRUD with path-traversal guards
- `routes/schedules.ts` — colours, project scoping, run history, cron helpers
- `routes/agents.ts` — Office roster

`routes/logs.ts` is still a 501 stub — the whole logs/tracing workstream is unstarted.

## Remaining

| # | Task | State |
|---|---|---|
| T5 | Logs + traces | Nothing done. Needs `telemetry.ts`, `logs`/`spans` tables, instrumentation in orchestrator/loopEngine/harnesses, then the UI. |
| T6 | Changes (git) | Backend done; page still mock. |
| T7 | Schedule | Backend done; page still mock. |
| T8 | Memory | `pages/memory/{SessionsPane,KeysPane,ValuePane,JsonTree}.tsx` exist; page not assembled. Backend done. |
| T9 | Kanban | `pages/kanban/{types,constants}.ts` exist; page not assembled. Backend done. |
| T10 | Chat / Permissions | Dashboard done. **Chat has a live bug**: client sends `{prompt}` and reads `data.result`, server expects `{message}` and returns `{output}` — replies never render. |

## Health

`npx tsc --noEmit` clean for both packages · `npx eslint packages/client packages/server` clean · `npx vitest run` 31/31 passing.
