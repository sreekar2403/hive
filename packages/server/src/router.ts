import { RoutingDecision } from "@hive/shared";
import { Config } from "./config";
import { Harness } from "@hive/shared/harness";

/**
 * RoutingDecision plus the provider a rule pinned, if any. Kept as a local
 * extension (rather than editing the shared package) since the provider is
 * only meaningful to callers that care about task routing configuration.
 */
export interface RoutingResult extends RoutingDecision {
  provider?: string;
}

export class Router {
  private config: Config;
  private harnesses: Map<string, Harness>;

  constructor(config: Config, harnesses: Map<string, Harness>) {
    this.config = config;
    this.harnesses = harnesses;
  }

  route(query: string, availableHarnesses?: string[]): RoutingResult {
    // Check available harnesses
    const available = availableHarnesses || this.getAvailableHarnesses();

    if (available.length === 0) {
      return {
        harness: this.config.routing.fallback,
        model: this.getDefaultModel(this.config.routing.fallback),
        reasoning: "No harnesses available, using fallback",
      };
    }

    // Routing based on the configurable rules table (Settings > Task routing)
    const decision = this.heuristicRoute(query, available);

    return decision;
  }

  private heuristicRoute(query: string, available: string[]): RoutingResult {
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
          provider: rule.provider || undefined,
          reasoning:
            rule.reasoning || `${rule.taskType} task, routing to ${rule.harness}`,
        };
      }
    }

    // Fall through to the "default" rule, if one is configured and usable.
    const defaultRule = rules.find(
      (r) => r.taskType === "default" && r.enabled,
    );
    if (defaultRule && available.includes(defaultRule.harness)) {
      return {
        harness: defaultRule.harness,
        model: defaultRule.model || this.getDefaultModel(defaultRule.harness),
        provider: defaultRule.provider || undefined,
        reasoning: defaultRule.reasoning || `Default routing to ${defaultRule.harness}`,
      };
    }

    // Last resort: first available harness.
    return {
      harness: available[0],
      model: this.getDefaultModel(available[0]),
      reasoning: `Default routing to ${available[0]}`,
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
