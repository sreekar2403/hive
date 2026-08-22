**Findings:** .hive/wayfinder/research/017-harness-provider-model-research.md

**Type:** wayfinder:research (AFK — subagent fired during charting)
**Blocked by:** none
**Blocks:** 021 (category-routing settings), 024 (VRAM-aware queue), 027 (per-harness streaming adapter)

## Question

For each of Hive's existing three harnesses — **opencode**, **claude-code** (the `claude` CLI), and
**pi** — find out what providers/models each can be pointed at (cloud APIs like Anthropic/OpenAI, and
specifically whether/how each supports a local inference backend such as Ollama or LM Studio), and the
exact CLI flags or config needed to select a provider/model per invocation. This determines whether
"local model execution" (round-1 destination decision) can go entirely through each harness's own
provider abstraction, or whether Hive needs its own separate direct-to-Ollama path for any of them.
Findings feed directly into the Settings page design (021) and the VRAM-aware queue design (024), which
needs to know how to tell "this task is about to hit a local model" from the task's configured
harness+provider+model.
