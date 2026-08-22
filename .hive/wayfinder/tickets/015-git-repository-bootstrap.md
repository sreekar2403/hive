**Type:** wayfinder:task (AFK)
**Blocked by:** none
**Blocks:** everything that touches branch-per-task, `git diff` change detection, or `mergeToPR`

## Question

This workspace has no `.git` directory at all. `Orchestrator.createTask` generates a `hive/<session>/<task>`
branch name, `detectFilesChanged` in each harness shells out to `git diff --name-only HEAD` / `git status
--porcelain`, and `Orchestrator.mergeToPR` shells out to `git push` + `gh pr create` — none of this can
work today. Resolve by initializing the repo (`git init`, initial commit of the current tree — the
`.gitignore` already exists and looks correct), picking a default branch name, and deciding whether an
initial commit history matters (e.g. should Phase 1's work land as one commit, or should we preserve
today's working tree as-is with no attempt at retroactive history). Confirm `gh` CLI auth status too,
since `mergeToPR`'s PR-creation path depends on it.
