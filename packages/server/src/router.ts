import { RoutingDecision } from '@hive/shared';
import { Config } from './config';
import { Harness } from '@hive/shared/harness';

export class Router {
  private config: Config;
  private harnesses: Map<string, Harness>;

  constructor(config: Config, harnesses: Map<string, Harness>) {
    this.config = config;
    this.harnesses = harnesses;
  }

  route(query: string, availableHarnesses?: string[]): RoutingDecision {
    // Check available harnesses
    const available = availableHarnesses || this.getAvailableHarnesses();

    if (available.length === 0) {
      return {
        harness: this.config.routing.fallback,
        model: this.getDefaultModel(this.config.routing.fallback),
        reasoning: 'No harnesses available, using fallback',
      };
    }

    // Simple heuristic routing based on query analysis
    const decision = this.heuristicRoute(query, available);

    return decision;
  }

  private heuristicRoute(query: string, available: string[]): RoutingDecision {
    const lowerQuery = query.toLowerCase();

    // Task-specific routing heuristics
    const rules: Array<{ pattern: RegExp; harness: string; reasoning: string }> = [
      {
        pattern: /test|spec|assert|expect|describe|it\(|jest|vitest|mocha/,
        harness: 'opencode',
        reasoning: 'Test-related task, routing to opencode',
      },
      {
        pattern: /refactor|clean|restructure|rename|move|extract/,
        harness: 'claude-code',
        reasoning: 'Refactoring task, routing to claude-code',
      },
      {
        pattern: /document|readme|doc|writeup|explain|comment/,
        harness: 'claude-code',
        reasoning: 'Documentation task, routing to claude-code',
      },
      {
        pattern: /deploy|build|ci|cd|docker|kubernetes|infra|aws|gcp|azure/,
        harness: 'opencode',
        reasoning: 'DevOps task, routing to opencode',
      },
      {
        pattern: /design|ui|ux|css|style|theme|component/,
        harness: 'claude-code',
        reasoning: 'UI/UX task, routing to claude-code',
      },
      {
        pattern: /research|search|find|look up|documentation|api doc/,
        harness: 'opencode',
        reasoning: 'Research task, routing to opencode',
      },
    ];

    for (const rule of rules) {
      if (rule.pattern.test(lowerQuery) && available.includes(rule.harness)) {
        return {
          harness: rule.harness,
          model: this.getDefaultModel(rule.harness),
          reasoning: rule.reasoning,
        };
      }
    }

    // Default to first available harness
    return {
      harness: available[0],
      model: this.getDefaultModel(available[0]),
      reasoning: `Default routing to ${available[0]}`,
    };
  }

  private getDefaultModel(harnessName: string): string {
    const harnessConfig = this.config.harnesses[harnessName as keyof typeof this.config.harnesses];
    return harnessConfig?.defaultModel || 'sonnet';
  }

  private getAvailableHarnesses(): string[] {
    const available: string[] = [];
    for (const [name, harness] of this.harnesses) {
      // Check if harness is enabled in config
      const isEnabled = this.config.harnesses[name as keyof typeof this.config.harnesses]?.enabled;
      if (isEnabled) {
        available.push(name);
      }
    }
    return available;
  }
}
