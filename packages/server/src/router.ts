import { RoutingDecision } from "@hive/shared";
import { Config } from "./config";
import { Harness } from "@hive/shared/harness";
import { categorize, keywords } from "./secondBrain/categorize";
import type { RoutingHint } from "./secondBrain/types";
import { resolveModelRef } from "./models/catalog";

/** RoutingDecision enriched with the layer that decided and how sure it was. */
export interface RoutingResult extends RoutingDecision {
  /** Which layer decided: useful in the logs when a route looks surprising. */
  strategy?: "rule" | "learned" | "semantic" | "llm" | "default" | "fallback";
  /** The task type this prompt was classified as. */
  category?: string;
  /** 0…1 — how sure the deciding layer was. Rules are certain by fiat. */
  confidence?: number;
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
    "test", "tests", "testing", "spec", "assert", "assertion", "coverage",
    "vitest", "jest", "mocha", "fixture", "mock", "stub", "regression",
    "failing", "flaky", "suite", "expect", "snapshot",
  ],
  refactor: [
    "refactor", "restructure", "rename", "extract", "simplify", "cleanup",
    "tidy", "duplication", "readability", "decouple", "abstraction",
    "reorganise", "reorganize", "consolidate", "dead", "unused",
  ],
  docs: [
    "document", "documentation", "readme", "docs", "explain", "comment",
    "guide", "tutorial", "changelog", "docstring", "write-up", "describe",
    "onboarding", "wording", "prose", "clarify",
  ],
  devops: [
    "deploy", "deployment", "build", "ci", "pipeline", "docker", "container",
    "kubernetes", "infra", "infrastructure", "aws", "gcp", "azure", "release",
    "environment", "secrets", "workflow", "runner", "artifact", "publish",
  ],
  ui: [
    "ui", "ux", "design", "css", "style", "styling", "theme", "component",
    "layout", "responsive", "accessibility", "animation", "colour", "color",
    "spacing", "typography", "button", "modal", "form", "render",
  ],
  research: [
    "research", "investigate", "compare", "evaluate", "options", "tradeoff",
    "tradeoffs", "survey", "benchmark", "docs", "reference", "how", "why",
    "understand", "explore", "background", "prior",
  ],
};

/** A semantic score below this is noise, and the default rule should win. */
const SEMANTIC_FLOOR = 0.18;

export class Router {
  private config: Config;
  private harnesses: Map<string, Harness>;

  constructor(config: Config, harnesses: Map<string, Harness>) {
    this.config = config;
    this.harnesses = harnesses;
  }

  /**
   * Picks a harness, in four layers of decreasing certainty:
   *
   *   1. **rules** — the configurable keyword table (Settings → Task routing)
   *   2. **learned** — Second Brain evidence, when it clears the bar in
   *      `secondBrain.routing`, and only to re-point a rule that already fired
   *   3. **semantic** — term-overlap scoring against CATEGORY_PROFILES, for
   *      prompts no keyword rule matched
   *   4. **default / fallback** — the configured default rule, then whatever
   *      harness is actually available
   *
   * The learned layer never invents a route from nothing; it re-points one.
   * That is the difference between "augment" and "replace", and it is why a
   * new install with an empty brain routes exactly as it did before.
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

    const category = this.classify(query);
    const decision = this.heuristicRoute(query, available, category);

    // Try LLM-based routing if configured
    const llmDecision = await this.llmRoute(query, available);
    if (llmDecision) {
      return this.applyHints(llmDecision, available, options.hints ?? []);
    }

    return this.applyHints(decision, available, options.hints ?? []);
  }

  /** The task type a prompt looks like, by the same rules the brain uses. */
  classify(query: string): string {
    return categorize(query, this.config.routing.rules ?? []);
  }

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
            rule.reasoning || `${rule.taskType} task, routing to ${rule.harness}`,
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
    const defaultRule = rules.find((r) => r.taskType === "default" && r.enabled);
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
  private semanticRoute(query: string, available: string[]): RoutingResult | null {
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
          if (term.length > 4 && (term.startsWith(word) || word.startsWith(term))) {
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
   * LLM-based routing: uses an LLM to classify the prompt and pick the best harness.
   * This is an optional layer that runs when a routing model is configured.
   * It runs after semantic routing and before the default/fallback.
   */
  private async llmRoute(query: string, available: string[]): Promise<RoutingResult | null> {
    const routingModel = this.config.routing?.llmModel;
    if (!routingModel) return null;

    const resolved = await resolveModelRef(routingModel);
    if (!resolved) return null;

    const harness = this.harnesses.get(resolved.harness);
    if (!harness || !(await harness.isAvailable())) return null;

    const harnessDescriptions = available.map((h) => {
      const rule = (this.config.routing.rules ?? []).find((r) => r.harness === h && r.enabled);
      return `- ${h}: ${rule?.reasoning || "General purpose"}`;
    }).join("\n");

    const prompt = `You are a task router for a multi-agent coding system. Given a user's prompt, choose the best harness to handle it.

Available harnesses:
${harnessDescriptions}

User prompt: "${query}"

Respond with ONLY the harness name (one of: ${available.join(", ")}) and a brief reason. Format:
HARNESS: <name>
REASON: <reason>`;

    try {
      const result = await harness.execute(prompt, {
        model: resolved.ref,
        timeout: 10000,
      });

      if (!result.success || !result.output) return null;

      // Parse the LLM response
      const lines = result.output.trim().split("\n");
      let chosenHarness = "";
      let reason = "";
      for (const line of lines) {
        if (line.startsWith("HARNESS:")) chosenHarness = line.slice(8).trim();
        if (line.startsWith("REASON:")) reason = line.slice(7).trim();
      }

      if (!chosenHarness || !available.includes(chosenHarness)) return null;

      return {
        harness: chosenHarness,
        model: this.getDefaultModel(chosenHarness),
        reasoning: `LLM routing: ${reason}`,
        strategy: "llm",
        category: "llm-classified",
        confidence: 0.85,
      };
    } catch {
      return null;
    }
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
