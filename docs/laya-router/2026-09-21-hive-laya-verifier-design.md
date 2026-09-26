# Hive Laya Verifier / Guard

**Date:** 2026-09-21
**Status:** Proposed
**Branch:** `docs/laya-router-specs`
**Scope:** Post-`llmRoute` verification + destructive-command risk signal. Depends on fast-lane spec §3 vocabulary; can land independently. No changes to harness adapters or LoopEngine retry semantics.

## 1. Core idea

Keep the LLM router as the decider. Add Laya as a ~33ms second opinion that (a) confirms or challenges the `category`, and (b) scores `risk` / `destructive` intent for the permission gate. Agreement boosts confidence; disagreement with high Laya confidence forces one LLM retry or a safe fallback instead of silently running the wrong agent.

This mirrors the viral Jev pattern (`jev-guard`, `jevscan`, coding-agent watchers): the big model reasons, the small decision model watches.

## 2. Where it hooks in

In `Router.route()` (`router.ts:253`), after `llmRoute` returns a decision and before `applyHints`:

```
soul -> [laya-fast?] -> llm -> laya-verify -> hints -> return
```

`laya-verify` runs the same 4 questions as the fast-lane spec plus two more in the same forward pass (6 total):

```python
questions = {
  "category": {...9-way, identical to fast-lane...},
  "complexity": {...identical to fast-lane...},
  "needs_strong_model": {...identical to fast-lane...},
  "multi_file": {...identical to fast-lane...},
  "risk": {"type": "score", "instructions": "How risky is executing this task?",
    "criteria": ["read-only", "edits code", "destructive or irreversible"]},
  "destructive": {"type": "noul", "instructions": "Does this ask to delete, reset, force-push, clean, or prune?"}
}
```

State is the same `{task}` text. One call, ~6 questions batched (~40ms GPU per Laya benchmarks).

## 3. Decision rule

Let `L` = LLM decision, `V` = Laya answers:

- **Agree** (`V.category.choice == L.category`, or L has no category and mapped harness matches): return `{...L, reasoning: L.reasoning + " (laya confirms <choice> 0.91)", confidence: min(1, L.confidence+0.15), strategy: "llm"}`. Span records both confidences.
- **Disagree, V high-conf** (`V.category.confidence >= 0.85` and maps to a different available harness): log `warn/router` with both answers; retry `llmRoute` once with `V.category` injected as a hint line ("A fast classifier reads this as bugfix (0.89). Reconsider."). If retry agrees with V, take retry. If retry still disagrees, take the higher-confidence side but cap confidence at 0.6 and set `strategy:"llm"`.
- **Disagree, V low-conf**: keep L unchanged.
- **Risk signal** (independent of agree/disagree): if `V.destructive.noul >= 0.7` or `V.risk.score >= 1.6/2.0`, attach `riskFlags: ["laya:destructive 0.78"]` to the span and surface on the Permissions screen as an advisory line. It never blocks by itself — `PermissionManager` (`permissions.ts`, `runtimeGuard.ts`) still owns the real gate on observed shell calls. Advisory only in this spec.

`minConfidence` for the LLM layer (`0.5`) is unchanged; Laya cannot rescue a below-threshold LLM null (that path already falls to heuristics).

## 4. Config (additive)

```jsonc
"routing": { "layaVerify": {
  "enabled": true, "disagreeThreshold": 0.85,
  "retryOnce": true, "advisoryRisk": true, "timeoutMs": 1500
}}
```

All defaults preserve current behavior when `enabled:false`.

## 5. Calibration and limits

- Same temperature-fit requirement as fast-lane: fit on ~200 Hive prompts before trusting 0.85; `score` is Laya's weakest primitive (SST-5 0.372), so `risk.score` is advisory only until calibrated.
- Laya sees prompt text only, not repo state — it cannot judge true blast radius. The `destructive` noul catches explicit language ("reset --hard", "rm -rf", "push -f"); the real gate stays on observed commands (word-boundary match, `gateOn:"commands"` default).
- Extra latency per LLM-routed task: one Laya forward pass (33ms GPU / ~200–400ms CPU preloaded). Cached routes pay nothing (verification result is cached with the decision).
- Prompt-injection: task text is data (fenced `<task>` block per `fenceTask`); V output is validated against the harness list; worst case is a wasted retry, not a hijacked route.

## 6. Observability

Every verified route emits the existing span plus `laya: {category, categoryConf, risk, destructive, agrees: bool}`. The Logs screen shows "why did it pick that?" as: LLM reasoning + Laya confirm/challenge line. This feeds the planned router scorecard (which agent wins which category over N samples) without changing Second Brain learning thresholds (`minSamples:5`, `minMargin:0.2`).

## 7. Error handling

Laya timeout, missing weights, or exception → skip verification silently, return L unchanged, log `warn/router` once. Verification never fails a task and never changes the harness set under consideration (availability re-checked before any override, same as `applyHints` guards).

## 8. Testing

- Unit (fake Laya + fake LLM): agree boosts, high-conf disagree triggers one retry, retry-agrees-with-V wins, low-conf disagree ignored, risk flags attached, disabled skips, timeout skips.
- Regression: `router.test.ts`, `dynamicRouter.test.ts` unchanged when flag off; with flag on, all existing fallback paths (no model, single harness, unparseable LLM) still hold.
- Manual: force disagreement with a crafted prompt ("the retry path silently swallows failures...") and confirm the Logs span shows both sides.

## 9. Rollout

Docs only in this branch. Code lands behind `routing.layaVerify.enabled` (default off until calibration). Fast-lane and verifier compose: fast-lane handles obvious cases without an LLM call; verifier watches the rest. Either can ship alone.
