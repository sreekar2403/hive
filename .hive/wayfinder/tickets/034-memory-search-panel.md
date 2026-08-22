**Type:** wayfinder:prototype
**Blocked by:** 018, 026
**Blocks:** none

## Question

Land the Memory panel: keyword/full-text search (SQLite FTS5, per the destination decision against
semantic/embedding search) over `SharedMemory` entries across sessions. Decide the search UX (global
search box, per-session filter, result preview/snippet highlighting) and whether entries are editable/
deletable from this panel or strictly read-only, mirroring the current `SharedMemory.delete` capability
that already exists in the backend.
