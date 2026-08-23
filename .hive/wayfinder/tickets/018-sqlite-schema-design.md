**Type:** wayfinder:grilling
**Blocked by:** none
**Blocks:** 019, 021 (storage), 025, 030, 033, 034

## Question

Design the SQLite schema that replaces today's flat-JSON `SharedMemory` and in-memory-only
`ResourceManager`, and backs the new UI panels. Needs tables (or equivalent) for: sessions, tasks (with
enough state to survive a restart — status, harness, branch, timestamps — matching/extending today's
`AgentTask`), subtasks (once swarm decomposition (023) exists, a task may have children), memory entries
(key/value per session today — decide whether to keep that shape or generalize — plus an FTS5 virtual
table for keyword search), file locks (currently `FileLock` in `resourceManager.ts`, in-memory and
lock-timeout-based), permission requests (both pending — currently lost on restart — and a resolved
_history_, since the Permissions panel (032) needs to show past decisions, not just live ones), and a
generic log/event table backing the global Logs panel (033). Decide migration/versioning approach (even
if just "no migrations yet, single schema, blow away and recreate on breaking change" for a personal
tool) and which package owns the SQLite file/connection (likely `packages/server`).
