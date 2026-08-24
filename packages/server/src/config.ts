import * as path from "path";
import * as fs from "fs";

export type ProviderId =
  | "anthropic"
  | "openai"
  | "openrouter"
  | "google"
  | "ollama"
  | "lmstudio";

export type HarnessId = "opencode" | "claude-code" | "pi";

export interface ProviderConfig {
  enabled: boolean;
  /** Stored server-side only. Never echoed back raw over the API. */
  apiKey: string;
  /** Empty string means "use the provider's default endpoint". */
  baseUrl: string;
}

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
  /** Empty string means "no specific provider pinned". */
  provider: string;
  reasoning: string;
  enabled: boolean;
}

export interface Config {
  providers: Record<ProviderId, ProviderConfig>;
  harnesses: Record<HarnessId, HarnessConfig>;
  routing: {
    default: string;
    fallback: string;
    rules: RoutingRule[];
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
    maxConcurrentAgents: number;
    retry: {
      enabled: boolean;
      maxRetries: number;
    };
  };
  server: {
    port: number;
  };
  storage: {
    cacheDir: string;
  };
  general: {
    defaultProjectId: string;
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
      provider: "",
      reasoning: "Test-related task, routing to opencode",
      enabled: true,
    },
    {
      id: "refactor",
      taskType: "refactor",
      pattern: "refactor|clean|restructure|rename|move|extract",
      harness: "claude-code",
      model: "",
      provider: "",
      reasoning: "Refactoring task, routing to claude-code",
      enabled: true,
    },
    {
      id: "docs",
      taskType: "docs",
      pattern: "document|readme|doc|writeup|explain|comment",
      harness: "claude-code",
      model: "",
      provider: "",
      reasoning: "Documentation task, routing to claude-code",
      enabled: true,
    },
    {
      id: "devops",
      taskType: "devops",
      pattern: "deploy|build|ci|cd|docker|kubernetes|infra|aws|gcp|azure",
      harness: "opencode",
      model: "",
      provider: "",
      reasoning: "DevOps task, routing to opencode",
      enabled: true,
    },
    {
      id: "ui",
      taskType: "ui",
      pattern: "design|ui|ux|css|style|theme|component",
      harness: "claude-code",
      model: "",
      provider: "",
      reasoning: "UI/UX task, routing to claude-code",
      enabled: true,
    },
    {
      id: "research",
      taskType: "research",
      pattern: "research|search|find|look up|documentation|api doc",
      harness: "opencode",
      model: "",
      provider: "",
      reasoning: "Research task, routing to opencode",
      enabled: true,
    },
    {
      id: "default",
      taskType: "default",
      pattern: "",
      harness: "opencode",
      model: "",
      provider: "",
      reasoning: "Default routing",
      enabled: true,
    },
  ];
}

export function createDefaultConfig(): Config {
  return {
    providers: {
      anthropic: { enabled: true, apiKey: "", baseUrl: "" },
      openai: { enabled: false, apiKey: "", baseUrl: "" },
      openrouter: { enabled: false, apiKey: "", baseUrl: "" },
      google: { enabled: false, apiKey: "", baseUrl: "" },
      ollama: { enabled: false, apiKey: "", baseUrl: "http://localhost:11434" },
      // Local model servers need no key; the base URL is the whole config.
      lmstudio: { enabled: false, apiKey: "", baseUrl: "http://localhost:1234" },
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
      maxConcurrentAgents: 3,
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
    general: {
      defaultProjectId: "",
    },
  };
}
