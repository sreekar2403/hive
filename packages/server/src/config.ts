import * as path from "path";
import * as fs from "fs";

/**
 * Every CLI Hive knows how to drive. Adding one here is the type-level half
 * of the job; the other halves are an adapter in harnesses/, a profile in
 * harnesses/profiles.ts, a probe spec in harnesses/health.ts, and a default
 * block in `createDefaultConfig`.
 */
export type HarnessId =
  | "opencode"
  | "claude-code"
  | "pi"
  | "codex"
  | "gemini"
  | "qwen"
  | "cursor-agent"
  | "aider"
  | "amp"
  | "goose"
  | "crush"
  | "copilot";

/**
 * The same list at runtime, and the only one the server should use.
 *
 * It was previously duplicated as a literal inside routes/settings.ts, which
 * meant a newly supported CLI was invisible to the Settings screen and
 * rejected by `PUT /api/settings` until somebody remembered the second copy.
 * The `satisfies` clause makes a future divergence a compile error rather
 * than a silently half-supported harness.
 */
export const HARNESS_IDS = [
  "opencode",
  "claude-code",
  "pi",
  "codex",
  "gemini",
  "qwen",
  "cursor-agent",
  "aider",
  "amp",
  "goose",
  "crush",
  "copilot",
] as const satisfies readonly HarnessId[];

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

/**
 * Dynamic routing: a model decides which agent runs the work.
 *
 * The keyword table this replaces could only answer questions someone had
 * already anticipated. It routed "add a test for the retry path" correctly
 * and "the retry path is wrong, and nothing covers it" to whichever rule
 * happened to fire first. A model reading the harness profiles answers both,
 * and — unlike the table — can pick the *model* as well as the CLI, which is
 * the difference between routing across harnesses and routing across
 * providers.
 *
 * It is a layer, not a replacement. When it is off, unreachable, slow, or
 * unsure, the rules/semantic/default cascade underneath still answers, so a
 * machine with no spare model to think with routes exactly as it did before.
 */
export interface LlmRoutingConfig {
  enabled: boolean;
  /**
   * Catalog id (`harness/provider/model`) to route *with*. Empty means
   * "choose one" — see pickRoutingModel in router.ts, which prefers a small
   * fast model and never spends a frontier model on a routing question.
   */
  model: string;
  /** Let the router choose the model to run, not only the harness. */
  selectModel: boolean;
  /**
   * Give up and fall through to the heuristics after this long. Routing is
   * overhead on every task, so this is deliberately short: a router that
   * takes ten seconds to save one has cost more than it saved.
   */
  timeoutMs: number;
  /** Decisions below this confidence are discarded in favour of the rules. */
  minConfidence: number;
  /**
   * How long an identical prompt reuses its decision. Retries and the staged
   * loop re-route the same text repeatedly; without this, a five-stage
   * pipeline pays for five routing calls to reach the same answer.
   */
  cacheTtlMs: number;
}

export interface Config {
  harnesses: Record<HarnessId, HarnessConfig>;
  routing: {
    default: string;
    fallback: string;
    rules: RoutingRule[];
    /**
     * Catalog id (`harness/provider/model`) for LLM-based routing.
     *
     * @deprecated Superseded by `routing.llm.model`, which is read first.
     * Still honoured so configs written before the dynamic router keep
     * working; `saveConfig` migrates it forward.
     */
    llmModel: string;
    llm: LlmRoutingConfig;
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
  /**
   * Which model looks at an attached image when the model running the task
   * cannot. See visionBridge.ts — the image is described in words and the
   * description is handed to the working agent.
   */
  vision: {
    /**
     * A catalog id (`harness/provider/model`). Empty means "pick one",
     * which prefers a vision model on the harness already in use.
     *
     * Worth setting by hand: the automatic choice knows only which models
     * *can* see, not which of them is any good at reading a screenshot, and
     * on a machine with several it will not necessarily pick the one you
     * would have.
     */
    model: string;
    /** Describe images even when the working model could see them itself. */
    always: boolean;
  };
  permission: {
    enabled: boolean;
    timeout: number;
    destructiveActions: string[];
    /**
     * What the approval gate inspects.
     *
     *   "commands" — the agent's actual shell tool calls, watched live
     *                (runtimeGuard.ts). The default: it catches a
     *                destructive command whatever the prompt said, and
     *                never blocks a prompt that only *mentions* one.
     *   "prompt"   — the old behaviour: scan the user's prompt up front.
     *   "both"     — scan the prompt, then keep watching the tool stream.
     */
    gateOn: "prompt" | "commands" | "both";
  };
  loop: {
    maxIterations: number;
    /** Per-task execution timeout, in milliseconds. */
    timeoutMs: number;
    /**
     * How long a harness may print nothing before the run is abandoned as
     * stuck, in milliseconds. 0 turns the check off.
     *
     * Well under `timeoutMs` on purpose. A CLI that has said nothing for two
     * minutes is not thinking, and waiting out the full run budget to find
     * that out costs the budget and teaches the loop nothing.
     */
    idleTimeoutMs: number;
    /**
     * When a harness answers with silence, hand the same work to a different
     * harness instead of asking that one again.
     *
     * On by default. The failure this exists for is not the CLI's fault and
     * not the prompt's: a provider went quiet, a local model never loaded,
     * a CLI is waiting on an interactive prompt nobody can answer. None of
     * those get better on the second attempt against the same binary, and
     * every other installed harness is a live alternative sitting idle.
     */
    harnessFallback: boolean;
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
    /**
     * Sub-agent fan-out: one request split across several agents that run
     * at the same time, each in its own worktree, then merged back. See
     * fanout/planner.ts for when a request qualifies — the planner declines
     * far more often than it accepts, because a wrong split costs N agent
     * runs and produces N answers to questions nobody asked.
     */
    fanout: {
      enabled: boolean;
      /** Ceiling on sub-agents per request. Hard-capped by MAX_SUBTASKS. */
      maxSubtasks: number;
      /**
       * Merge the finished sub-branches back automatically. Off leaves each
       * one on disk to be reviewed and merged by hand, which is the right
       * default for anyone who does not want agents touching their current
       * branch unattended.
       */
      merge: boolean;
      /** Budget for the planning call itself, in milliseconds. */
      plannerTimeoutMs: number;
    };
  };
  server: {
    port: number;
    /**
     * Interface to bind. Defaults to loopback: the API spawns CLI agents
     * with shell and git access to the project, so listening on every
     * interface by default handed that to anyone who could reach the box.
     * Binding anywhere else requires `authToken` — see server.ts.
     */
    host: string;
    /** Shared secret required on /api/* when set. Empty disables auth. */
    authToken: string;
    /**
     * Browser origins allowed to call the API. Empty means "any localhost
     * origin", which covers Vite's dev server and the Electron shell.
     */
    allowedOrigins: string[];
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
  /**
   * First-run state. `completed` gates the setup screen, which asks the one
   * question Hive cannot discover — which model to route with — and seeds
   * soul.md from what it finds. See setup.ts.
   */
  setup: {
    completed: boolean;
    completedAt: number;
    /** Bumped when setup starts asking something new. */
    version: number;
  };
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
  if (process.env.HIVE_HOST) config.server.host = process.env.HIVE_HOST;
  if (process.env.HIVE_AUTH_TOKEN) {
    config.server.authToken = process.env.HIVE_AUTH_TOKEN;
  }

  // Migration: configs written before providers moved into the harness CLIs
  // carry a `providers` block (and per-rule `provider` pins). Strip them so
  // the next saveConfig converges the file instead of resurrecting keys the
  // app no longer reads.
  delete (config as { providers?: unknown }).providers;
  for (const rule of config.routing.rules) {
    delete (rule as { provider?: unknown }).provider;
  }

  // Migration: `routing.llmModel` predates the `routing.llm` block. A config
  // that set the old field meant "route with this model", so honour that
  // rather than silently ignoring it — but never overwrite an explicit new
  // setting, which is the more recent statement of intent.
  if (config.routing.llmModel && !config.routing.llm.model) {
    config.routing.llm.model = config.routing.llmModel;
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
    vision: {
      model: "",
      always: false,
    },
    // Every harness starts *off*. A harness is only useful if its CLI is
    // installed, and defaulting to `enabled: true` meant a fresh config
    // claimed twelve agents were ready on a machine that had none of them —
    // which surfaces as tasks failing at spawn time rather than as an
    // honest "not installed" in Settings. Startup reconciliation and the
    // setup screen (setup.ts) turn on what is actually there.
    harnesses: {
      opencode: {
        enabled: false,
        path: "opencode",
        defaultModel: "claude-sonnet-4",
        args: [],
        concurrency: 2,
      },
      "claude-code": {
        enabled: false,
        path: "claude",
        defaultModel: "claude-sonnet-4",
        args: [],
        concurrency: 2,
      },
      pi: {
        enabled: false,
        path: "pi",
        defaultModel: "claude-sonnet-4",
        args: [],
        concurrency: 2,
      },
      codex: {
        enabled: false,
        path: "codex",
        defaultModel: "",
        args: [],
        concurrency: 2,
      },
      gemini: {
        enabled: false,
        path: "gemini",
        defaultModel: "",
        args: [],
        concurrency: 2,
      },
      qwen: {
        enabled: false,
        path: "qwen",
        defaultModel: "",
        args: [],
        concurrency: 2,
      },
      "cursor-agent": {
        enabled: false,
        path: "cursor-agent",
        defaultModel: "",
        args: [],
        concurrency: 2,
      },
      aider: {
        enabled: false,
        path: "aider",
        defaultModel: "",
        args: [],
        concurrency: 2,
      },
      amp: {
        enabled: false,
        path: "amp",
        defaultModel: "",
        args: [],
        concurrency: 1,
      },
      goose: {
        enabled: false,
        path: "goose",
        defaultModel: "",
        args: [],
        concurrency: 1,
      },
      crush: {
        enabled: false,
        path: "crush",
        defaultModel: "",
        args: [],
        concurrency: 2,
      },
      copilot: {
        enabled: false,
        path: "copilot",
        defaultModel: "",
        args: [],
        concurrency: 1,
      },
    },
    routing: {
      default: "opencode",
      fallback: "claude-code",
      rules: defaultRoutingRules(),
      llmModel: "",
      llm: {
        enabled: true,
        model: "",
        selectModel: true,
        timeoutMs: 20000,
        minConfidence: 0.5,
        cacheTtlMs: 5 * 60 * 1000,
      },
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
      gateOn: "commands",
    },
    loop: {
      maxIterations: 10,
      timeoutMs: 300000,
      idleTimeoutMs: 120000,
      harnessFallback: true,
      maxConcurrentAgents: 0,
      pipeline: {
        enabled: false,
        plan: true,
        maxRepairs: 2,
        testCommand: "",
      },
      fanout: {
        enabled: true,
        maxSubtasks: 4,
        merge: true,
        plannerTimeoutMs: 120000,
      },
      retry: {
        enabled: true,
        maxRetries: 3,
      },
    },
    server: {
      port: 3001,
      host: "127.0.0.1",
      authToken: "",
      allowedOrigins: [],
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
    setup: {
      completed: false,
      completedAt: 0,
      version: 0,
    },
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
