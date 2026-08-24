# Redesign status

All P0 work is complete. Read `docs/DESIGN_SYSTEM.md` before touching the UI.

## Done

| # | Task | Notes |
|---|---|---|
| T1 | Design system + shell + projects | "Ledger" tokens (light + dark), 15 primitives, grouped sidebar, top bar, project switcher, `ProjectContext`, `lib/api.ts`. |
| T2 | Office | pixi floor, 7 zones where **zone = pipeline phase**, named characters, A* pathfinding, theme-aware, click-to-inspect. |
| T3 | Workflows | React Flow, 8 node types, palette, inspector, undo/redo, auto-layout, live validation, project-scoped autosave. |
| T4 | Settings | Providers, harnesses (live probe), task → harness/model/provider routing, execution, permissions, general. Persists to `hive.config.json`. |
| T5 | Logs + traces | `telemetry.ts` with `logs`/`spans` tables; orchestrator, loop engine and harnesses instrumented. Live stream with filters, plus an APM-style span waterfall per run. |
| T6 | Changes | Real git status/diff/log, project-scoped, dual line numbers, history tab, j/k navigation. |
| T7 | Schedule | Real CRUD, per-schedule colour, cron validation + human summary, next-run times, run history, calendar + list views. |
| T8 | Memory | Three-pane browser over the real store, JSON tree, edit/delete, search. |
| T9 | Kanban | Real tasks, drag + keyboard move, WIP limits, harness colours, filters, detail modal. |
| T10 | Dashboard / Chat / Permissions | Real stats; the chat field-name bug is fixed; approval queue with live countdown and an audit list. |
| — | Electron | No longer force-opens DevTools (F12 toggles); no white flash on launch. |
| E1 | General workspace | A synthesised, always-present scope (`__general__`) for questions that belong to no repository. Server: `generalWorkspace.ts` (+ orchestrator/git/projects wiring), client: pinned switcher section and scope-aware chat empty state. Folder configurable under Settings → General. |
| E2 | Provider SSO | Providers can authenticate through the harness CLI that owns their OAuth credential instead of an API key (`auth/sso.ts`, status/login/logout endpoints, sign-in panel per provider). |
| E3 | Board columns + feel | Backlog / Testing / Blocked join the original five; collapsed minor columns keep eight columns usable; density toggle, search, coalesced reloads, optimistic moves with rollback, per-column add and delete. |
| E4 | Switch control | Rebuilt on border-box geometry so the knob can never escape the track; carries a check/minus glyph, not colour alone. |
| E5 | Office expand | The floor's expand button now actually expands (folds header + roster, Escape restores) and Fit is its own control; a pane ResizeObserver refits on any layout change. |

## Known gaps

These are real limits of what's wired today, not oversights to rediscover later:

- Kanban tasks and chat tasks are separate concepts — a chat run does not appear on the board.
- Workflows can be designed and saved, but there is no executor yet; a schedule's `workflow_id` is stored, not run.
- A provider's "Test connection" validates the credential only; model calls still go through each harness's own CLI configuration rather than the configured provider.
- Logs written before a project is known are kept visible rather than hidden, so an unattributed line still shows under any project filter.

## Health

`npx tsc --noEmit` clean (both packages) · `npx eslint packages/client packages/server` clean ·
`npx vitest run` 51/51 · `tsc --build` and `vite build` both succeed.
