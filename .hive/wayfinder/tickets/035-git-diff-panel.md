**Type:** wayfinder:prototype
**Blocked by:** 026
**Blocks:** none

## Question

Land the read-only Git panel: branch list, diff view, and commit graph per task, mapped to the task's
`branchName` (`Orchestrator` already generates `hive/<session>/<task>` or `.../parallel`). Confirmed
read-only — no stage/commit/push/PR buttons; `Orchestrator.mergeToPR` remains the only path that acts on
git. Pick a diff-rendering approach (a lightweight diff library is enough; this doesn't need Monaco-level
editing, just visualization) and decide how it queries git state (shell out per-request like
`detectFilesChanged` does today, or watch the working tree).
