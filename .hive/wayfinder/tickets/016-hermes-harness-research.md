**Findings:** .hive/wayfinder/research/hermes-harness-research.md

**Type:** wayfinder:research (AFK — subagent fired during charting)
**Blocked by:** none
**Blocks:** 021 (category-routing settings), 024 (VRAM-aware queue), 027 (per-harness streaming adapter)

## Question

Hive is adding **hermes** — Nous Research's agentic CLI harness — as a fourth harness alongside opencode,
claude-code, and pi. Find out: how it's installed and invoked from the command line, its non-interactive
prompt-execution flags (equivalent to `claude -p <prompt> --output-format json`), what output format it
produces (structured JSON vs raw text vs something else), whether it supports streaming/incremental
output or only returns a final result, what providers/models it can be pointed at (cloud APIs, and
specifically whether it can talk to local inference servers like Ollama/LM Studio), and how model/provider
selection is passed on its command line or config. Findings should be enough to write a `HermesHarness`
implementing the existing `Harness` interface (`packages/shared/src/harness.ts`) the same way
`packages/server/src/harnesses/claudeCode.ts` etc. do today.
