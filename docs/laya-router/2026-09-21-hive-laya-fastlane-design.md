# Hive Laya Fast-Lane Pre-Router

**Date:** 2026-09-21
**Status:** Proposed
**Branch:** `docs/laya-router-specs`
**Scope:** `packages/server/src/router.ts`, `packages/server/src/harnesses/profiles.ts`, config, telemetry, tests. No changes to LoopEngine, permissions, or harness adapters.

## 1. Core idea

Hive routes in layers (`router.ts:253`): `soul` pin wins, then `llm` (small model over dispatch prompt, `llmRoute`), then `rules/semantic/default` keyword fallback. The `llm` layer is accurate but costs a full harness `execute()` (20s timeout, JSON parse via `extractJsonObject`, hallucinated-harness risk, `minConfidence:0.5`, scratch-dir run).

Add a `laya-fast` layer between `soul` and `llm`: a local `convaiinnovations/laya` `Router(preload=True)` answers 4 typed questions in one ~33ms GPU forward pass (193–464ms CPU), with calibrated confidence. High-confidence answers skip the LLM call entirely. Low-confidence answers fall through to the existing `llm` path unchanged.

New order: `soul -> laya-fast -> llm -> rules/semantic/default -> fallback`. Learned Second Brain hints (`applyHints`) still apply on top of whichever layer answered, never overriding a `soul` pin.

## 2. What already exists and gets reused

| Existing piece | Role |
|---|---|
| `Router.route(query, options)` (`router.ts:253`) | Single insertion point; `laya-fast` is a private method called after `soulRoute`, before cache/`llmRoute` |
| `classify()` / `categorize()` | Still defines the 9 categories; Laya returns the same vocabulary so downstream code is unchanged |
| `describeHarnesses()` (`profiles.ts:242`) | Source of harness strengths/limits; used to build the coarse-to-fine map, not sent to Laya |
| Decision cache (`readCache`/`writeCache`, `cacheTtlMs`, 200-entry cap) | Laya decisions are cached with the same key (prompt + harness signature) so retries and staged pipeline re-routes stay free |
| `resolveRoutingModel` / `pickRoutingModel` | Untouched; Laya needs no routing model, which is the cost saving |
| Trace spans (`strategy`, `category`, `confidence`, `reasoning` in `RoutingResult`) | Extend `strategy` union with `"laya"` (`router.ts:17-19`); Logs screen renders it with the same row as `"llm"` (no new UI) |
| `router.test.ts`, `dynamicRouter.test.ts` | Extended with fake-Laya cases; no existing assertions change |

## 3. Laya questions (one forward pass)

State is `{ task: query.slice(0,4000) }` — the same fenced text the LLM prompt uses, without profiles or catalogue.

```python
questions = {
  "category": {"type": "choice", "instructions": "What kind of coding work is this?",
    "criteria": {"test": "tests, specs, assertions, coverage, failing suite",
      "refactor": "refactor, rename, extract, cleanup, restructure",
      "docs": "readme, docs, explain, comments, guide",
      "devops": "deploy, build, ci, docker, infra, release",
      "ui": "css, layout, component, theme, responsive",
      "research": "compare, investigate, survey, explore options",
      "feature": "new feature, new endpoint, new behavior",
      "bugfix": "error, crash, wrong output, regression fix",
      "other": "everything else"}},
  "complexity": {"type": "score", "instructions": "How complex is this task?",
    "criteria": ["trivial single edit", "multi-step", "cross-cutting reasoning"]},
  "needs_strong_model": {"type": "noul", "instructions": "Does this need a strong reasoning model rather than a small fast one?"},
  "multi_file": {"type": "noul", "instructions": "Will this touch more than two files?"}
}
```

Why 9 categories, not 12 harnesses: Laya degrades past ~20 options (Banking77 0.425 vs Jev 0.870 at 77 labels; head budget ~3–4 tokens/label). 9-way choice stays in the accurate regime. Harness mapping is a deterministic coarse-to-fine table derived from `profiles.ts` (e.g. `test -> opencode`, `refactor/docs/ui -> claude-code`, `devops/research -> opencode`, `feature/bugfix/other -> default`), filtered by `available` list. A pin naming an unavailable harness is ignored, same as `soulRoute`.

## 4. Decision rule

1. Call `router.predict(state, questions)` with `model="english"` (tasks are English; multilingual checkpoint reserved for future non-English prompts).
2. If `answers.category.confidence >= 0.85` AND mapped harness is in `available`: return `{harness, model: getDefaultModel(harness), reasoning: "laya-fast category <choice> (conf 0.91)", strategy: "laya", category, confidence}`. Write cache. Done — no LLM call.
3. Else return null — fall through to existing cached-`llm` → `heuristicRoute` path exactly as today.
4. `complexity` / `needs_strong_model` / `multi_file` are recorded on the span for now (feeds spec 2 and the router scorecard); they do not change the harness in this spec.

Threshold 0.85 is a starting default (`routing.laya.minConfidence`), tunable per repo after temperature fitting (see §6).

## 5. Config (additive, all defaults preserve current behavior)

```jsonc
"routing": { "laya": {
  "enabled": true, "minConfidence": 0.85, "timeoutMs": 1500, "model": "english"
}}
```

`enabled:false` restores today's behavior exactly. No change to `routing.llm`, `routing.rules`, or `secondBrain.routing`.

## 6. Calibration and honest limits

- Laya ships over-confident (mean ECE 0.466 → 0.081 after per-(type, option-count) temperature fit). Before trusting 0.85, fit one temperature on ~200 labeled Hive prompts; re-fit per repo.
- Base checkpoint is near chance on unseen typed-decision benchmarks — the 0.766 figure belongs to the fine-tuned checkpoint. This spec uses Laya only for 9-way category where ModernBERT-large is strong (AG News 0.950, MASSIVE intent EN 0.783), not for open-ended routing.
- CPU latency 193–464ms still beats an LLM round trip (seconds + 20s timeout risk). Preload at server start (`Router(preload=True)`); `max_loaded=1` is fine since tasks are English-only in this spec.
- `USE_TF=0` guard for the transformers/TF deadlock noted in the Laya model card.

## 7. Error handling

Every Laya failure returns null (fall through), never throws: model not installed, timeout > `timeoutMs`, exception, or unavailable mapped harness. Logged at `warn/router` with 200-char context, same as unparseable LLM output today. Single-harness machines skip Laya (nothing to decide), same as `llmRoute`.

## 8. Testing

- Unit: `layaRoute` high-conf hit, low-conf fallthrough, unavailable-harness ignore, timeout → null, disabled flag → skipped. Fake Laya client, no weights in CI.
- Integration: existing `router.test.ts` + `dynamicRouter.test.ts` pass unchanged; new suite asserts cache key reuse and span fields.
- Manual: `hive doctor` reports `laya: ok/missing`; startup log states `laya-fast enabled, threshold 0.85`.

## 9. Rollout

Branch ships docs only. Code lands later behind `routing.laya.enabled`, default on in dev, off in release until calibration data is collected. No migration: existing `hive.config.json` files load unchanged.
