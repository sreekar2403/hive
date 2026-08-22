**Type:** wayfinder:task
**Blocked by:** 018
**Blocks:** 025 (permission history needs this in place)

## Question

Implement the schema decided in 018: replace `SharedMemory`'s one-JSON-file-per-key storage and
`ResourceManager`'s in-memory `Map`-based locks/task-contexts with SQLite-backed equivalents (e.g. via
`better-sqlite3`). Preserve the existing public method signatures where reasonable
(`get`/`set`/`delete`/`list` on `SharedMemory`; `acquireLock`/`releaseLock`/`createTask`/
`updateTaskStatus`/`getTask` on `ResourceManager`) so callers in `orchestrator.ts` don't need to change,
unless 018 decided otherwise. Task state must now actually survive a server restart — verify this by
restarting the dev server mid-task and confirming `getTask` still returns the right status.
