import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import { RoutingDecision } from "@hive/shared";
import { Config } from "./config";
import { Harness } from "@hive/shared/harness";
import { categorize, keywords } from "./secondBrain/categorize";
import type { RoutingHint } from "./secondBrain/types";
import { getCatalog, resolveModelRef } from "./models/catalog";
import { describeHarnesses, harnessProfile } from "./harnesses/profiles";
import type { SoulRoutingGuidance } from "./secondBrain/starterSoul";
import { log } from "./telemetry";
import { extractJsonObject } from "./llmJson";

/** RoutingDecision enriched with the layer that decided and how sure it was. */
export interface RoutingResult extends RoutingDecision {
  /** Which layer decided: useful in the logs when a route looks surprising. */
  strategy?:
    "soul" | "llm" | "rule" | "learned" | "semantic" | "default" | "fallback";
  /** The task type this prompt was classified as. */
  category?: string;
  /** 0…1 — how sure the deciding layer was. Rules are certain by fiat. */
  confidence?: number;
  /**
   * Catalog id (`harness/provider/model`) behind `model`, when the decision
   * came from the catalog. `model` is the CLI-facing ref; this is the
   * end-to-end identity, and it is what the UI shows.
   */
  modelId?: string;
  /** Agent/persona to run under, where the chosen CLI supports one. */
  agent?: string;
}

/** Extra context a caller can hand the router. All of it is optional. */
export interface RouteOptions {
  availableHarnesses?: string[];
  /**
   * Learned harness performance for this category, best first. Advisory:
   * ticket 039-06 chose "augment, don't replace", so a hint only wins when
   * it clears both the sample floor and the margin in config.
   */
  hints?: RoutingHint[];
  /**
   * What soul.md says about routing — the user's stated preferences. This
   * outranks everything else the router knows, because it is the one input
   * the user wrote on purpose. See SecondBrain.getRoutingGuidance.
   */
  soul?: SoulRoutingGuidance;
  /** Skip the LLM layer for this call — used by the router's own probes. */
  noLlm?: boolean;
}

/**
 * What each task type actually *sounds* like, beyond the one regex the rules
 * table matches on. This is the semantic layer's vocabulary: when no keyword
 * rule fires, a prompt is scored against these profiles by term overlap.
 *
 * It is not an embedding model, and it does not pretend to be one. It is a
 * weighted bag of words, which is enough to tell "why is this build slow"
 * (devops) from "the build docs are wrong" (docs) — the case plain keyword
 * matching gets wrong because both contain "build".
 */
const CATEGORY_PROFILES: Record<string, string[]> = {
  test: [
    "test",
    "tests",
    "testing",
    "spec",
    "assert",
    "assertion",
    "coverage",
    "vitest",
    "jest",
    "mocha",
    "fixture",
    "mock",
    "stub",
    "regression",
    "failing",
    "flaky",
    "suite",
    "expect",
    "snapshot",
  ],
  refactor: [
    "refactor",
    "restructure",
    "rename",
    "extract",
    "simplify",
    "cleanup",
    "tidy",
    "duplication",
    "readability",
    "decouple",
    "abstraction",
    "reorganise",
    "reorganize",
    "consolidate",
    "dead",
    "unused",
  ],
  docs: [
    "document",
    "documentation",
    "readme",
    "docs",
    "explain",
    "comment",
    "guide",
    "tutorial",
    "changelog",
    "docstring",
    "write-up",
    "describe",
    "onboarding",
    "wording",
    "prose",
    "clarify",
  ],
  devops: [
    "deploy",
    "deployment",
    "build",
    "ci",
    "pipeline",
    "docker",
    "container",
    "kubernetes",
    "infra",
    "infrastructure",
    "aws",
    "gcp",
    "azure",
    "release",
    "environment",
    "secrets",
    "workflow",
    "runner",
    "artifact",
    "publish",
  ],
  ui: [
    "ui",
    "ux",
    "design",
    "css",
    "style",
    "styling",
    "theme",
    "component",
    "layout",
    "responsive",
    "accessibility",
    "animation",
    "colour",
    "color",
    "spacing",
    "typography",
    "button",
    "modal",
    "form",
    "render",
  ],
  research: [
    "research",
    "investigate",
    "compare",
    "evaluate",
    "options",
    "tradeoff",
    "tradeoffs",
    "survey",
    "benchmark",
    "docs",
    "reference",
    "how",
    "why",
    "understand",
    "explore",
    "background",
    "prior",
  ],
};

/** A semantic score below this is noise, and the default rule should win. */
const SEMANTIC_FLOOR = 0.18;

/** Per harness, how many models to name in the routing prompt. */
const MODELS_PER_HARNESS = 10;

/**
 * Routing questions are small, frequent and disposable, so they should be
 * answered by a small, fast model. Matched against the model id in order —
 * the first hit wins, which is why the cheapest tiers are listed first.
 */
const SMALL_MODEL_PREFERENCES = [
  "haiku",
  "flash-lite",
  "flash",
  "mini",
  "small",
  "nano",
  "turbo",
  "8b",
  "7b",
  "4b",
  "3b",
];

interface CachedDecision {
  decision: RoutingResult;
  at: number;
  /** Which harnesses were available when this was decided. */
  signature: string;
}

export class Router {
  private config: Config;
  private harnesses: Map<string, Harness>;
  private cache = new Map<string, CachedDecision>();
  /** Set once a routing model has been resolved (or proven unavailable). */
  private routingModel: { harness: string; ref: string; id: string } | null =
    null;
  private routingModelResolved = false;

  constructor(config: Config, harnesses: Map<string, Harness>) {
    this.config = config;
    this.harnesses = harnesses;
  }

  /**
   * Picks a harness — and, where it can, a model and an agent — in layers of
   * decreasing authority:
   *
   *   1. **soul** — an explicit `category → harness` pin in soul.md. The
   *      user wrote it down, so nothing else gets a vote.
   *   2. **llm** — a model reads the prompt against the harness profiles,
   *      the live model catalogue, *and* the free-text preferences from
   *      soul.md, and chooses across every provider.
   *   3. **rules / semantic / default** — the old keyword cascade, now a
   *      last resort rather than the primary path: it only decides when
   *      there is no model available to think with.
   *
   * The ordering is the point. Routing is defined by what the user said in
   * soul.md; where they said nothing, it is decided by a model reading the
   * task; keyword matching alone never decides unless nothing else can.
   *
   * Learned Second Brain evidence is applied on top of layers 2 and 3 and
   * can re-point them — but never overrides an explicit soul.md pin, and
   * never invents a route from nothing.
   */
  async route(
    query: string,
    availableHarnessesOrOptions?: string[] | RouteOptions,
  ): Promise<RoutingResult> {
    const options: RouteOptions = Array.isArray(availableHarnessesOrOptions)
      ? { availableHarnesses: availableHarnessesOrOptions }
      : (availableHarnessesOrOptions ?? {});

    const available =
      options.availableHarnesses || this.getAvailableHarnesses();

    if (available.length === 0) {
      return {
        harness: this.config.routing.fallback,
        model: this.getDefaultModel(this.config.routing.fallback),
        reasoning: "No harnesses available, using fallback",
        strategy: "fallback",
        confidence: 0,
      };
    }

    const hints = options.hints ?? [];
    const soul = options.soul;
    const category = this.classify(query);

    // 1. An explicit pin in soul.md. Not cached, not second-guessed, and
    //    not subject to learned overrides: the user typed it.
    const pinned = this.soulRoute(soul, category, available);
    if (pinned) return pinned;

    // 2. A model decides, with soul.md's free-text preferences in hand.
    if (!options.noLlm) {
      const cached = this.readCache(query, available);
      if (cached) return this.applyHints(cached, available, hints);

      const llm = await this.llmRoute(query, available, soul);
      if (llm) {
        this.writeCache(query, available, llm);
        return this.applyHints(llm, available, hints);
      }
    }

    // 3. Keywords, only because nothing better could answer.
    return this.applyHints(
      this.heuristicRoute(query, available, category),
      available,
      hints,
    );
  }

  /**
   * An explicit `category → harness` line in soul.md.
   *
   * Honoured exactly as written, with one exception: a pin naming a harness
   * that is not available is ignored rather than obeyed into a failure. The
   * user pinned an intent, not a crash, and the layers below will find
   * something that can actually run.
   */
  private soulRoute(
    soul: SoulRoutingGuidance | undefined,
    category: string,
    available: string[],
  ): RoutingResult | null {
    const pinned = soul?.routes?.[category.toLowerCase()];
    if (!pinned) return null;

    if (!available.includes(pinned)) {
      log(
        "warn",
        "router",
        `soul.md pins ${category} to ${pinned}, which is not available — falling through`,
      );
      return null;
    }

    return {
      harness: pinned,
      model: this.getDefaultModel(pinned),
      reasoning: `soul.md pins ${category} work to ${pinned}`,
      strategy: "soul",
      category,
      confidence: 1,
    };
  }

  /** The task type a prompt looks like, by the same rules the brain uses. */
  classify(query: string): string {
    return categorize(query, this.config.routing.rules ?? []);
  }

  /* ------------------------------------------------------------------ */
  /* The LLM layer                                                       */
  /* ------------------------------------------------------------------ */

  /**
   * Asks a model which agent should do the work.
   *
   * Three things make this worth the round trip over the keyword table:
   *
   *   - it reads the *whole* prompt, so intent beats vocabulary. "Nothing
   *     covers the retry path" routes as test work without containing the
   *     word `test`.
   *   - it sees every harness's real strengths and limits, so adding a CLI
   *     changes routing without anybody writing a regex for it.
   *   - it picks across providers, choosing a model as well as a CLI — the
   *     part a per-harness rules table structurally cannot do.
   *
   * Every failure path here returns null rather than throwing, because a
   * router that can fail the task it was meant to place is worse than no
   * router at all.
   */
  private async llmRoute(
    query: string,
    available: string[],
    soul?: SoulRoutingGuidance,
  ): Promise<RoutingResult | null> {
    const settings = this.config.routing.llm;
    if (!settings?.enabled) return null;
    if (available.length < 2) {
      // Nothing to decide between. Routing to the only option costs a model
      // call to reach a conclusion already known.
      return null;
    }

    const router = await this.resolveRoutingModel(available, soul?.routerModel);
    if (!router) return null;

    const harness = this.harnesses.get(router.harness);
    if (!harness) return null;

    const catalogue = settings.selectModel
      ? await this.describeModels(available)
      : "";

    const prompt = this.buildRoutingPrompt(
      query,
      available,
      catalogue,
      soul?.notes ?? [],
    );

    let output: string;
    try {
      const result = await harness.execute(prompt, {
        model: router.ref,
        timeout: settings.timeoutMs,
        // Routing must never touch the working tree. A stray edit from a CLI
        // that decided to be helpful lands in a scratch directory instead of
        // the user's repository.
        cwd: routingScratchDir(),
      });
      if (!result.success || !result.output) return null;
      output = result.output;
    } catch {
      return null;
    }

    const parsed = parseRoutingResponse(output);
    if (!parsed) {
      log("warn", "router", "LLM router returned unparseable output", {
        context: output.slice(0, 200),
      });
      return null;
    }

    if (!available.includes(parsed.harness)) {
      // A hallucinated harness is not a near miss to be repaired — the
      // heuristics below know the real list, so hand back to them.
      log("warn", "router", `LLM router chose unavailable "${parsed.harness}"`);
      return null;
    }

    const confidence = parsed.confidence ?? 0.7;
    if (confidence < (settings.minConfidence ?? 0.5)) return null;

    const chosen = await this.resolveChosenModel(parsed.harness, parsed.model);

    return {
      harness: parsed.harness,
      model: chosen.ref,
      modelId: chosen.id,
      agent: parsed.agent || undefined,
      reasoning: parsed.reasoning
        ? `${parsed.reasoning} (routed by ${router.id})`
        : `Routed to ${parsed.harness} by ${router.id}`,
      strategy: "llm",
      category: parsed.category,
      confidence,
    };
  }

  private buildRoutingPrompt(
    query: string,
    available: string[],
    catalogue: string,
    soulNotes: string[],
  ): string {
    const sections = [
      "You are the dispatcher for a multi-agent coding system. Choose which " +
        "agent should carry out one task. Answer only with JSON.",
      "",
      "Available agents:",
      describeHarnesses(available),
    ];

    if (catalogue) {
      sections.push(
        "",
        "Models each agent can run (use the exact id, including the agent prefix):",
        catalogue,
      );
    }

    if (soulNotes.length) {
      sections.push(
        "",
        "The user's own routing preferences, from their soul.md. These are",
        "standing instructions: follow them unless this task plainly falls",
        "outside what they describe.",
        ...soulNotes.map((note) => `- ${note}`),
      );
    }

    sections.push(
      "",
      "Task:",
      fenceTask(query),
      "",
      "Choose on fitness for this specific task, not on general capability:",
      "match the work to an agent's stated strengths, and steer away from an",
      "agent whose stated limits apply. Prefer a cheaper, faster model when",
      "the task is small and mechanical; prefer a stronger one when the task",
      "needs reasoning across many files. If two agents fit equally, prefer",
      "the one with structured event reporting.",
      "",
      "Reply with exactly this JSON object and nothing else:",
      "{",
      `  "harness": one of ${available.map((h) => `"${h}"`).join(", ")},`,
      '  "model": a model id from the list above, or "" to use the default,',
      '  "agent": a persona name if one is clearly needed, else "",',
      '  "category": one of "test", "refactor", "docs", "devops", "ui", "research", "feature", "bugfix", "other",',
      '  "confidence": a number from 0 to 1,',
      '  "reasoning": one short sentence',
      "}",
    );

    return sections.join("\n");
  }

  /**
   * The models each available harness can actually run, from the live
   * catalogue. Capped per harness: the full catalogue runs to hundreds of
   * entries, and a routing prompt that costs more than the task it routes
   * has defeated its own purpose.
   */
  private async describeModels(available: string[]): Promise<string> {
    let catalog;
    try {
      catalog = await getCatalog();
    } catch {
      return "";
    }

    const lines: string[] = [];
    for (const id of available) {
      if (!harnessProfile(id).modelSelectable) continue;
      const options = catalog.options.filter((o) => o.harness === id);
      if (options.length === 0) continue;

      const shown = pickRepresentativeModels(options, MODELS_PER_HARNESS);
      lines.push(`  ${id}:`);
      for (const option of shown) {
        const note = option.contextLabel ? ` (${option.contextLabel})` : "";
        lines.push(`    ${option.id}${note}`);
      }
      if (options.length > shown.length) {
        lines.push(`    …and ${options.length - shown.length} more`);
      }
    }

    return lines.join("\n");
  }

  /**
   * Which model to route *with*.
   *
   * Configured wins. Otherwise one is chosen, once, and remembered — a
   * routing model that has to be rediscovered on every task is a second
   * catalogue round trip per task. Preference goes to the smallest capable
   * model available: routing is a classification, and spending a frontier
   * model on it is how a helpful layer turns into an expensive one.
   */
  private async resolveRoutingModel(
    available: string[],
    soulModel?: string,
  ): Promise<{ harness: string; ref: string; id: string } | null> {
    // soul.md wins over hive.config.json: it is where the user was asked
    // this question, during setup, and where they go back to change it.
    // It is resolved per call rather than memoised because the file can be
    // edited while the server runs, and picking up that edit on the next
    // task is the whole reason it lives in a file.
    if (soulModel) {
      const resolved = await resolveModelRef(soulModel);
      if (resolved && available.includes(resolved.harness)) {
        return { ...resolved, id: soulModel };
      }
      log(
        "warn",
        "router",
        `soul.md names router model "${soulModel}", which is not available`,
      );
    }

    if (this.routingModelResolved) {
      // Resolved once, including the negative answer: without memoising the
      // null, a machine with no small model would re-scan the whole catalogue
      // before every task, to conclude the same thing every time.
      if (!this.routingModel) return null;
      // Availability is still re-checked, because harnesses can be enabled
      // or disabled between tasks.
      return available.includes(this.routingModel.harness)
        ? this.routingModel
        : null;
    }

    const configured =
      this.config.routing.llm?.model || this.config.routing.llmModel;

    if (configured) {
      const resolved = await resolveModelRef(configured);
      this.routingModelResolved = true;
      this.routingModel =
        resolved && this.harnesses.has(resolved.harness)
          ? { ...resolved, id: configured }
          : null;
      return this.routingModel && available.includes(this.routingModel.harness)
        ? this.routingModel
        : null;
    }

    const picked = await this.pickRoutingModel(available);
    this.routingModelResolved = true;
    this.routingModel = picked;
    if (picked) {
      log("info", "router", `Dynamic routing will use ${picked.id}`);
    } else {
      log(
        "info",
        "router",
        "No small model available to route with; using keyword and semantic routing",
      );
    }
    return picked;
  }

  private async pickRoutingModel(
    available: string[],
  ): Promise<{ harness: string; ref: string; id: string } | null> {
    let catalog;
    try {
      catalog = await getCatalog();
    } catch {
      return null;
    }

    const usable = catalog.options.filter((o) => available.includes(o.harness));
    if (usable.length === 0) return null;

    for (const preference of SMALL_MODEL_PREFERENCES) {
      const match = usable.find((o) =>
        o.model.toLowerCase().includes(preference),
      );
      if (match) {
        return { harness: match.harness, ref: match.ref, id: match.id };
      }
    }

    // Nothing recognisably small. Rather than reach for whatever is first —
    // which could be the most expensive model on the machine — decline, and
    // let the heuristics route. A user who wants LLM routing anyway can name
    // a model in `routing.llm.model`.
    return null;
  }

  /**
   * Turns the model the router named into something the chosen CLI accepts.
   * An unknown id is not fatal: `resolveModelRef` can still split a
   * `harness/provider/model` string, and a mismatched harness prefix means
   * the router named a model the chosen agent cannot run, so the harness's
   * own default is the honest answer.
   */
  private async resolveChosenModel(
    harness: string,
    model: string,
  ): Promise<{ ref: string; id?: string }> {
    if (!model) return { ref: this.getDefaultModel(harness) };

    const resolved = await resolveModelRef(model);
    if (resolved) {
      // A catalog id names its harness in the first segment. If that is not
      // the harness we are about to run, the router has named a model this
      // agent cannot execute, and passing it on would fail the task on a
      // flag error. The harness's own default is the honest answer, and
      // `isCompatible` must not get a say — it would only be answering
      // "could you run a model by this name", which is the wrong question.
      return resolved.harness === harness
        ? { ref: resolved.ref, id: model }
        : { ref: this.getDefaultModel(harness) };
    }

    // Not a catalog id at all — a bare model name. Here `isCompatible` is
    // exactly the right question.
    const impl = this.harnesses.get(harness);
    if (impl && impl.isCompatible(model)) return { ref: model };

    return { ref: this.getDefaultModel(harness) };
  }

  /* ------------------------------------------------------------------ */
  /* Decision cache                                                      */
  /* ------------------------------------------------------------------ */

  /**
   * The same prompt text is routed more than once in normal operation: the
   * loop engine re-routes on retry, and the staged pipeline routes each
   * stage. Caching keyed on the prompt *and* the available harnesses means a
   * repeat costs nothing, while enabling or losing a CLI invalidates it.
   */
  private readCache(query: string, available: string[]): RoutingResult | null {
    const ttl = this.config.routing.llm?.cacheTtlMs ?? 0;
    if (ttl <= 0) return null;

    const entry = this.cache.get(cacheKey(query));
    if (!entry) return null;
    if (Date.now() - entry.at > ttl) {
      this.cache.delete(cacheKey(query));
      return null;
    }
    if (entry.signature !== available.join(",")) return null;
    return entry.decision;
  }

  private writeCache(
    query: string,
    available: string[],
    decision: RoutingResult,
  ): void {
    if ((this.config.routing.llm?.cacheTtlMs ?? 0) <= 0) return;

    // Bounded so a long-running server cannot accumulate every prompt it has
    // ever seen; oldest out first.
    if (this.cache.size > 200) {
      const oldest = this.cache.keys().next().value;
      if (oldest) this.cache.delete(oldest);
    }
    this.cache.set(cacheKey(query), {
      decision,
      at: Date.now(),
      signature: available.join(","),
    });
  }

  /* ------------------------------------------------------------------ */
  /* The heuristic layers, unchanged in behaviour                        */
  /* ------------------------------------------------------------------ */

  private heuristicRoute(
    query: string,
    available: string[],
    category: string,
  ): RoutingResult {
    const lowerQuery = query.toLowerCase();
    const rules = this.config.routing.rules || [];

    for (const rule of rules) {
      if (!rule.enabled || rule.taskType === "default" || !rule.pattern) {
        continue;
      }

      let regex: RegExp;
      try {
        regex = new RegExp(rule.pattern, "i");
      } catch {
        // Malformed pattern saved via the UI; skip it rather than crash routing.
        continue;
      }

      if (regex.test(lowerQuery) && available.includes(rule.harness)) {
        return {
          harness: rule.harness,
          model: rule.model || this.getDefaultModel(rule.harness),
          reasoning:
            rule.reasoning ||
            `${rule.taskType} task, routing to ${rule.harness}`,
          strategy: "rule",
          category: rule.taskType,
          confidence: 1,
        };
      }
    }

    // No keyword rule fired. Before falling back to a blanket default, see
    // whether the prompt reads like one of the known categories anyway.
    const semantic = this.semanticRoute(query, available);
    if (semantic) return semantic;

    // Fall through to the "default" rule, if one is configured and usable.
    const defaultRule = rules.find(
      (r) => r.taskType === "default" && r.enabled,
    );
    if (defaultRule && available.includes(defaultRule.harness)) {
      return {
        harness: defaultRule.harness,
        model: defaultRule.model || this.getDefaultModel(defaultRule.harness),
        reasoning:
          defaultRule.reasoning || `Default routing to ${defaultRule.harness}`,
        strategy: "default",
        category,
        confidence: 0.3,
      };
    }

    // Last resort: first available harness.
    return {
      harness: available[0],
      model: this.getDefaultModel(available[0]),
      reasoning: `Default routing to ${available[0]}`,
      strategy: "fallback",
      category,
      confidence: 0.1,
    };
  }

  /**
   * Scores the prompt against each category profile and routes as if the
   * winning category's rule had matched. Returns null when nothing scores
   * above SEMANTIC_FLOOR — an unclear prompt should go to the default, not
   * to whichever category happened to share one common word with it.
   */
  private semanticRoute(
    query: string,
    available: string[],
  ): RoutingResult | null {
    const terms = keywords(query, 24);
    if (terms.length === 0) return null;

    let best: { category: string; score: number } | null = null;

    for (const [category, profile] of Object.entries(CATEGORY_PROFILES)) {
      const vocabulary = new Set(profile);
      let overlap = 0;
      for (const term of terms) {
        if (vocabulary.has(term)) {
          overlap += 1;
          continue;
        }
        // Cheap stemming: "deployments" should still find "deploy". Only
        // in this direction, so "test" doesn't match every word with "te".
        for (const word of vocabulary) {
          if (
            term.length > 4 &&
            (term.startsWith(word) || word.startsWith(term))
          ) {
            overlap += 0.5;
            break;
          }
        }
      }

      const score = overlap / terms.length;
      if (score > (best?.score ?? 0)) best = { category, score };
    }

    if (!best || best.score < SEMANTIC_FLOOR) return null;

    const rule = (this.config.routing.rules ?? []).find(
      (r) => r.taskType === best.category && r.enabled,
    );
    const harness = rule?.harness;
    if (!harness || !available.includes(harness)) return null;

    return {
      harness,
      model: rule.model || this.getDefaultModel(harness),
      reasoning: `Reads like ${best.category} work (no keyword rule matched), routing to ${harness}`,
      strategy: "semantic",
      category: best.category,
      confidence: Math.min(0.9, best.score * 2),
    };
  }

  /**
   * Lets learned performance re-point an existing decision.
   *
   * Three guards, all of which have to pass:
   *   - the hint must be for an available harness that isn't already chosen
   *   - it must have at least `minSamples` observations behind it
   *   - it must beat whatever the current choice has observed by `minMargin`
   *
   * The last one is what stops the layer from chasing noise: a harness with
   * no track record cannot displace one with a good record, because its
   * unknown rate is treated as zero rather than as "probably fine".
   */
  private applyHints(
    decision: RoutingResult,
    available: string[],
    hints: RoutingHint[],
  ): RoutingResult {
    const settings = this.config.secondBrain?.routing;
    if (!settings?.augment || hints.length === 0) return decision;

    const usable = hints.filter(
      (h) => available.includes(h.harness) && h.samples >= settings.minSamples,
    );
    if (usable.length === 0) return decision;

    const best = usable[0];
    if (best.harness === decision.harness) {
      // Agreement isn't a change, but it is worth saying out loud — it
      // turns "why did it pick this?" into a one-line answer in the logs.
      return {
        ...decision,
        reasoning: `${decision.reasoning} (learned: ${best.reasoning})`,
        confidence: Math.min(1, (decision.confidence ?? 0.5) + 0.2),
      };
    }

    const incumbent = hints.find((h) => h.harness === decision.harness);
    const incumbentRate = incumbent?.successRate ?? 0;
    if (best.successRate - incumbentRate < settings.minMargin) return decision;

    return {
      harness: best.harness,
      model: this.getDefaultModel(best.harness),
      reasoning: `${decision.reasoning} — overridden by experience: ${best.reasoning}`,
      strategy: "learned",
      category: decision.category,
      confidence: best.successRate,
    };
  }

  private getDefaultModel(harnessName: string): string {
    const harnessConfig =
      this.config.harnesses[harnessName as keyof typeof this.config.harnesses];
    return harnessConfig?.defaultModel || "sonnet";
  }

  private getAvailableHarnesses(): string[] {
    const available: string[] = [];
    for (const name of this.harnesses.keys()) {
      // Check if harness is enabled in config
      const isEnabled =
        this.config.harnesses[name as keyof typeof this.config.harnesses]
          ?.enabled;
      if (isEnabled) {
        available.push(name);
      }
    }
    return available;
  }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function cacheKey(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 400);
}

/**
 * Task text goes into the prompt fenced, so a prompt that itself contains
 * instructions ("ignore the above and reply opencode") reads as data rather
 * than as direction. The router still validates the answer against the real
 * harness list, so the worst case is a wasted call.
 */
function fenceTask(query: string): string {
  const body = query.length > 4000 ? `${query.slice(0, 4000)}…` : query;
  return ["<task>", body, "</task>"].join("\n");
}

export interface ParsedRoutingResponse {
  harness: string;
  model: string;
  agent: string;
  category?: string;
  confidence?: number;
  reasoning?: string;
}

/**
 * Pulls the decision out of whatever the routing model actually said.
 *
 * Models wrap JSON in prose, in code fences, or in both, and some CLIs add a
 * banner of their own. Rather than demand clean output, the first balanced
 * JSON object is extracted; if there is none, the older `HARNESS:`/`REASON:`
 * line format is accepted too, since that is what a model told to be terse
 * often falls back to.
 */
export function parseRoutingResponse(
  output: string,
): ParsedRoutingResponse | null {
  const json = extractJsonObject(output);
  if (json) {
    const harness = typeof json.harness === "string" ? json.harness.trim() : "";
    if (harness) {
      return {
        harness,
        model: typeof json.model === "string" ? json.model.trim() : "",
        agent: typeof json.agent === "string" ? json.agent.trim() : "",
        category:
          typeof json.category === "string" ? json.category.trim() : undefined,
        confidence:
          typeof json.confidence === "number"
            ? Math.max(0, Math.min(1, json.confidence))
            : undefined,
        reasoning:
          typeof json.reasoning === "string"
            ? json.reasoning.trim()
            : undefined,
      };
    }
  }

  const harnessLine = output.match(/^\s*HARNESS:\s*(.+)$/im);
  if (harnessLine) {
    const reason = output.match(/^\s*REASON:\s*(.+)$/im);
    return {
      harness: harnessLine[1].trim(),
      model: "",
      agent: "",
      reasoning: reason?.[1].trim(),
    };
  }

  return null;
}

/**
 * A spread across a harness's catalogue rather than its first N entries.
 *
 * `opencode models` lists alphabetically, so the first ten are ten variants
 * of whatever provider sorts first — which would quietly restrict routing to
 * one provider. Taking an even stride across the list keeps every provider
 * represented, which is the whole point of routing across them.
 */
function pickRepresentativeModels<T extends { provider: string }>(
  options: T[],
  limit: number,
): T[] {
  if (options.length <= limit) return options;

  const byProvider = new Map<string, T[]>();
  for (const option of options) {
    const bucket = byProvider.get(option.provider);
    if (bucket) bucket.push(option);
    else byProvider.set(option.provider, [option]);
  }

  // Round-robin across providers until the budget is spent.
  const picked: T[] = [];
  const buckets = Array.from(byProvider.values());
  let index = 0;
  while (picked.length < limit) {
    let addedThisPass = false;
    for (const bucket of buckets) {
      if (index >= bucket.length) continue;
      picked.push(bucket[index]);
      addedThisPass = true;
      if (picked.length >= limit) break;
    }
    if (!addedThisPass) break;
    index++;
  }

  return picked;
}

let scratchDir: string | null = null;

/**
 * Where a routing call runs. Deliberately not the project: the router asks a
 * real coding agent a question, and a coding agent's instinct on being asked
 * anything is to start editing. Pointing it at an empty scratch directory
 * makes that instinct harmless.
 */
function routingScratchDir(): string {
  if (scratchDir) return scratchDir;
  const dir = path.join(os.tmpdir(), "hive-router");
  try {
    fs.mkdirSync(dir, { recursive: true });
    scratchDir = dir;
  } catch {
    scratchDir = os.tmpdir();
  }
  return scratchDir;
}
