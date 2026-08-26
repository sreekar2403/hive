import * as path from "path";
import * as fs from "fs";

export type HarnessId = "opencode" | "claude-code" | "pi";

export interface HarnessConfig {
  enabled: boolean;
  path: string;
  defaultModel: string;
  args: string[];
  concurrency: number;
}

/**
 * One row of the task-routing table. Rules are evaluated in array order —
 * the array's order *is* priority. A rule with `taskType: "default"` acts
 * as the catch-all and is always evaluated last, regardless of position.
 */
export interface RoutingRule {
  id: string;
  taskType: string;
  /** Regex source, tested case-insensitively against the prompt. Empty for the default rule. */
  pattern: string;
  harness: string;
  /** Empty string falls back to the harness's configured default model. */
  model: string;
  reasoning: string;
  enabled: boolean;
}

/**
 * The Second Brain: a learning memory layer that sits beside the swarm and
 * accumulates what it observes about *you* (preferences, habits) and about
 * *the work* (which harness wins which category, how failures were fixed).
 *
 * Two scopes exist and are read in this order, most specific last:
 *   - global, at `~/.hive/mem`, shared by every project on the machine
 *   - project, at `<project>/mem`, checked in alongside the code it describes
 *
 * `mem/config.json` in either scope may override any field below, so a repo
 * can, say, disable learning without touching the machine-wide setting.
 * See secondBrain/ for the reader, writer, graph and learning agent.
 */
export interface SecondBrainConfig {
  enabled: boolean;
  /** Store directory, relative to a project root (or absolute). */
  dir: string;
  /** Machine-wide store. Empty string means `~/.hive/mem`. */
  globalDir: string;
  learning: {
    enabled: boolean;
    /** Which observations wake the learning agent immediately. */
    triggers: {
      onFailure: boolean;
      onCorrection: boolean;
      onExplicitNote: boolean;
      /** Deeper synthesis over accumulated data, on a timer. */
      periodic: boolean;
    };
    /** How often the periodic batch runs, in milliseconds. */
    batchIntervalMs: number;
    /**
     * Catalog id (`harness/provider/model`) used for LLM-assisted synthesis.
     * Empty means "heuristics only" — the layer stays fully functional
     * without any model, it just derives less.
     */
    model: string;
    /** Records below this confidence are stored but never surfaced to agents. */
    minConfidence: number;
    /** Cap on how many soul.md suggestions one batch may queue. */
    maxSuggestionsPerBatch: number;
  };
  routing: {
    /** Let learned harness performance re-rank the rules table's answer. */
    augment: boolean;
    /** Learned routing needs at least this many observations to speak up. */
    minSamples: number;
    /** ...and at least this success-rate gap before it overrides a rule. */
    minMargin: number;
  };
  retrieval: {
    maxPreferences: number;
    maxLessons: number;
    /** Cap the injected briefing so it can't crowd out the actual prompt. */
    maxBriefingChars: number;
  };
}

export interface Config {
  harnesses: Record<HarnessId, HarnessConfig>;
  routing: {
    default: string;
    fallback: string;
    rules: RoutingRule[];
    /**
     * Catalog id (`harness/provider/model`) for LLM-based routing. Empty
     * disables that layer — routing then stays keyword + semantic + learned.
     */
    llmModel: string;
  };
  /**
   * Local model servers, reached directly over HTTP rather than through a
   * harness CLI (they have no CLI to hold a credential — but they need no
   * key either; the URL is the whole configuration).
   */
  localModels: {
    ollama: string;
    lmstudio: string;
  };
  permission: {
    enabled: boolean;
    timeout: number;
    destructiveActions: string[];
  };
  loop: {
    maxIterations: number;
    /** Per-task execution timeout, in milliseconds. */
    timeoutMs: number;
    /**
     * How many harness runs may execute at once. 0 hands the decision to
     * capacity.ts, which sizes it against the machine.
     */
    maxConcurrentAgents: number;
    retry: {
      enabled: boolean;
      maxRetries: number;
    };
    /**
     * The staged loop — plan, implement, test, review, ship — with a gate
     * after each stage. Off by default: it costs several harness runs per
     * task, which is the right trade for real work and the wrong one for a
     * question. See pipeline.ts.
     */
    pipeline: {
      enabled: boolean;
      /** Skip the planning stage. */
      plan: boolean;
      /** How many times failing tests may send work back to implement. */
      maxRepairs: number;
      /** Overrides test-command detection; empty means detect. */
      testCommand: string;
    };
  };
  server: {
    port: number;
  };
  storage: {
    cacheDir: string;
  };
  office: {
    gridCols: number;
    gridRows: number;
    tileSize: number;
  };
  kanban: {
    wipLimits: Record<string, number>;
  };
  secondBrain: SecondBrainConfig;
  general: {
    defaultProjectId: string;
    /**
     * Working directory for the built-in "General" workspace — the scope
     * for questions that are not about any project. Empty means
     * `~/.hive/workspace`. See generalWorkspace.ts.
     */
    rootDirectory: string;
  };
}

let cachedConfig: Config | null = null;

/**
 * Loads configuration by layering, in increasing priority:
 *   1. built-in defaults
 *   2. hive.config.json at the repo root, if present
 *   3. the PORT environment variable, if set
 *
 * The loaded config is cached as a singleton and the *same object* is
 * returned on every subsequent call. This matters: it means anything that
 * held onto the object from an earlier call (the Router, LoopEngine,
 * PermissionManager, ...) sees in-place updates made via `saveConfig`
 * immediately, without a restart.
 */
export function loadConfig(configPath?: string): Config {
  if (cachedConfig) return cachedConfig;

  const config = createDefaultConfig();

  const configFilePath =
    configPath || path.join(process.cwd(), "hive.config.json");
  try {
    if (fs.existsSync(configFilePath)) {
      const raw = fs.readFileSync(configFilePath, "utf8");
      const overrides = JSON.parse(raw);
      deepMerge(config, overrides);
    }
  } catch (err) {
    console.warn(
      `Could not read config file at ${configFilePath}, using defaults:`,
      err instanceof Error ? err.message : err,
    );
  }

  if (process.env.PORT) {
    const port = parseInt(process.env.PORT, 10);
    if (!Number.isNaN(port)) config.server.port = port;
  }

  // Migration: configs written before providers moved into the harness CLIs
  // carry a `providers` block (and per-rule `provider` pins). Strip them so
  // the next saveConfig converges the file instead of resurrecting keys the
  // app no longer reads.
  delete (config as { providers?: unknown }).providers;
  for (const rule of config.routing.rules) {
    delete (rule as { provider?: unknown }).provider;
  }

  cachedConfig = config;
  return config;
}

/** Resolves the on-disk path hive.config.json is read from and saved to. */
export function getConfigPath(configPath?: string): string {
  return configPath || path.join(process.cwd(), "hive.config.json");
}

/**
 * Persists a config object to hive.config.json. Callers typically pass the
 * same object `loadConfig()` returned (and mutated via `deepMerge`) so the
 * on-disk file and the live, in-memory config never drift apart.
 */
export function saveConfig(config: Config, configPath?: string): void {
  const filePath = getConfigPath(configPath);
  fs.writeFileSync(filePath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

/** Only exposed for tests that need to force a fresh load from disk. */
export function resetConfigCache(): void {
  cachedConfig = null;
}

export function deepMerge(target: any, source: any): void {
  for (const key of Object.keys(source)) {
    if (
      source[key] &&
      typeof source[key] === "object" &&
      !Array.isArray(source[key]) &&
      target[key] &&
      typeof target[key] === "object"
    ) {
      deepMerge(target[key], source[key]);
    } else {
      target[key] = source[key];
    }
  }
}

/**
 * Seeded default routing rules. These reproduce exactly the heuristics that
 * used to be hardcoded in `Router.heuristicRoute` so behaviour doesn't
 * regress now that rules are configurable — see the Settings "Task routing"
 * screen, which reads and writes this array.
 */
function defaultRoutingRules(): RoutingRule[] {
  return [
    {
      id: "test",
      taskType: "test",
      pattern: "test|spec|assert|expect|describe|it\\(|jest|vitest|mocha",
      harness: "opencode",
      model: "",
      reasoning: "Test-related task, routing to opencode",
      enabled: true,
    },
    {
      id: "refactor",
      taskType: "refactor",
      pattern: "refactor|clean|restructure|rename|move|extract",
      harness: "claude-code",
      model: "",
      reasoning: "Refactoring task, routing to claude-code",
      enabled: true,
    },
    {
      id: "docs",
      taskType: "docs",
      pattern: "document|readme|doc|writeup|explain|comment",
      harness: "claude-code",
      model: "",
      reasoning: "Documentation task, routing to claude-code",
      enabled: true,
    },
    {
      id: "devops",
      taskType: "devops",
      pattern: "deploy|build|ci|cd|docker|kubernetes|infra|aws|gcp|azure",
      harness: "opencode",
      model: "",
      reasoning: "DevOps task, routing to opencode",
      enabled: true,
    },
    {
      id: "ui",
      taskType: "ui",
      pattern: "design|ui|ux|css|style|theme|component",
      harness: "claude-code",
      model: "",
      reasoning: "UI/UX task, routing to claude-code",
      enabled: true,
    },
    {
      id: "research",
      taskType: "research",
      pattern: "research|search|find|look up|documentation|api doc",
      harness: "opencode",
      model: "",
      reasoning: "Research task, routing to opencode",
      enabled: true,
    },
    {
      id: "default",
      taskType: "default",
      pattern: "",
      harness: "opencode",
      model: "",
      reasoning: "Default routing",
      enabled: true,
    },
  ];
}

export function createDefaultConfig(): Config {
  return {
    // Local model servers need no key; the base URL is the whole config.
    localModels: {
      ollama: "http://localhost:11434",
      lmstudio: "http://localhost:1234",
    },
    harnesses: {
      opencode: {
        enabled: true,
        path: "opencode",
        defaultModel: "claude-sonnet-4",
        args: [],
        concurrency: 2,
      },
      "claude-code": {
        enabled: true,
        path: "claude",
        defaultModel: "claude-sonnet-4",
        args: [],
        concurrency: 2,
      },
      pi: {
        enabled: true,
        path: "pi",
        defaultModel: "claude-sonnet-4",
        args: [],
        concurrency: 2,
      },
    },
    routing: {
      default: "opencode",
      fallback: "claude-code",
      rules: defaultRoutingRules(),
      llmModel: "",
    },
    permission: {
      enabled: true,
      timeout: 60000,
      destructiveActions: [
        "delete",
        "remove",
        "rm",
        "reset",
        "push --force",
        "force-push",
        "clean",
        "prune",
        "push -f",
      ],
    },
    loop: {
      maxIterations: 10,
      timeoutMs: 300000,
      maxConcurrentAgents: 0,
      pipeline: {
        enabled: false,
        plan: true,
        maxRepairs: 2,
        testCommand: "",
      },
      retry: {
        enabled: true,
        maxRetries: 3,
      },
    },
    server: {
      port: 3001,
    },
    storage: {
      cacheDir: "./.hive-cache",
    },
    office: {
      gridCols: 16,
      gridRows: 9,
      tileSize: 64,
    },
    kanban: {
      wipLimits: {
        backlog: 0,
        queued: 0,
        in_progress: 3,
        review: 2,
        testing: 2,
        blocked: 0,
        done: 0,
        failed: 0,
      },
    },
    secondBrain: createDefaultSecondBrainConfig(),
    general: {
      defaultProjectId: "",
      rootDirectory: "",
    },
  };
}

/**
 * Defaults chosen so that a fresh install learns quietly and never blocks:
 * observation is on, but nothing is written into soul.md without approval,
 * and routing only listens to the learned signal once it has real evidence
 * behind it (see `routing.minSamples` / `routing.minMargin`).
 */
export function createDefaultSecondBrainConfig(): SecondBrainConfig {
  return {
    enabled: true,
    dir: "mem",
    globalDir: "",
    learning: {
      enabled: true,
      triggers: {
        onFailure: true,
        onCorrection: true,
        onExplicitNote: true,
        periodic: true,
      },
      batchIntervalMs: 6 * 60 * 60 * 1000,
      model: "",
      minConfidence: 0.35,
      maxSuggestionsPerBatch: 5,
    },
    routing: {
      augment: true,
      minSamples: 5,
      minMargin: 0.2,
    },
    retrieval: {
      maxPreferences: 8,
      maxLessons: 5,
      maxBriefingChars: 2000,
    },
  };
}
