/**
 * Mirrors packages/server/src/config.ts's Config shape. There are no
 * provider credentials here on purpose: every harness CLI holds its own
 * authentication, and local model servers need no key.
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

export interface HarnessConfig {
  enabled: boolean;
  path: string;
  defaultModel: string;
  args: string[];
  concurrency: number;
}

/**
 * Dynamic routing settings. Mirrors LlmRoutingConfig in the server's
 * config.ts — when the rules table and this disagree, this wins, because
 * the rules are what runs only after the model declines to decide.
 */
export interface LlmRoutingConfig {
  enabled: boolean;
  /** Catalog id to route with. Empty = pick a small model automatically. */
  model: string;
  selectModel: boolean;
  timeoutMs: number;
  minConfidence: number;
  cacheTtlMs: number;
}

export interface RoutingRule {
  id: string;
  taskType: string;
  pattern: string;
  harness: string;
  model: string;
  reasoning: string;
  enabled: boolean;
}

export interface SettingsConfig {
  localModels: {
    ollama: string;
    lmstudio: string;
  };
  /**
   * Which model reads an attached image when the model running the task
   * cannot see one — most local models can't. The image is described in
   * words and the description goes to the working agent.
   */
  vision?: {
    /** Catalog id (`harness/provider/model`); empty means choose for me. */
    model: string;
    /** Describe images even when the working model could see them. */
    always: boolean;
  };
  harnesses: Record<HarnessId, HarnessConfig>;
  routing: {
    default: string;
    fallback: string;
    rules: RoutingRule[];
    /** @deprecated Superseded by `routing.llm.model`. */
    llmModel?: string;
    llm?: LlmRoutingConfig;
  };
  permission: {
    enabled: boolean;
    timeout: number;
    destructiveActions: string[];
  };
  loop: {
    maxIterations: number;
    timeoutMs: number;
    /**
     * How long a harness may print nothing before it is abandoned as stuck.
     * Absent in configs written before it existed, so reads tolerate
     * undefined.
     */
    idleTimeoutMs?: number;
    /** Hand the work to a different harness when one goes silent. */
    harnessFallback?: boolean;
    maxConcurrentAgents: number;
    retry: {
      enabled: boolean;
      maxRetries: number;
    };
    /**
     * The staged loop. Absent in configs written before it existed, so
     * every read has to tolerate undefined.
     */
    pipeline?: {
      enabled: boolean;
      plan: boolean;
      maxRepairs: number;
      testCommand: string;
    };
  };
  server: {
    port: number;
    /** Bind address; loopback by default. Absent in older configs. */
    host?: string;
    /** Bearer token for /api/*. Absent or empty means no auth. */
    authToken?: string;
    allowedOrigins?: string[];
  };
  storage: {
    cacheDir: string;
  };
  /** Office floor geometry. Absent in older configs — sections must tolerate undefined. */
  office?: {
    gridCols: number;
    gridRows: number;
    tileSize: number;
  };
  /** Per-column kanban WIP limits; 0 means unlimited. */
  kanban?: {
    wipLimits: Partial<Record<string, number>>;
  };
  secondBrain: SecondBrainConfig;
  general: {
    defaultProjectId: string;
    /** Folder the built-in General workspace runs in. Empty = `~/.hive/workspace`. */
    rootDirectory: string;
  };
}

export interface HarnessProbe {
  id: HarnessId;
  enabled: boolean;
  path: string;
  defaultModel: string;
  args: string[];
  concurrency: number;
  available: boolean;
  version: string | null;
}

export const HARNESS_IDS: HarnessId[] = [
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
];

/**
 * What to render for a harness the server sent no config block for.
 *
 * The client's list of supported harnesses and the server's can differ — an
 * older server, or a hand-edited hive.config.json. Reading straight through
 * to `config.harnesses[id].enabled` in that case throws during render and
 * takes the whole Settings screen down, which is a bad trade for a missing
 * row. Defaults stand in, and saving writes a real block.
 */
export function harnessConfigOr(
  harnesses: Partial<Record<HarnessId, HarnessConfig>>,
  id: HarnessId,
): HarnessConfig {
  return (
    harnesses[id] ?? {
      enabled: false,
      path: HARNESS_COMMANDS[id],
      defaultModel: "",
      args: [],
      concurrency: 2,
    }
  );
}

/** Default binary name per harness, used when no config block exists. */
export const HARNESS_COMMANDS: Record<HarnessId, string> = {
  opencode: "opencode",
  "claude-code": "claude",
  pi: "pi",
  codex: "codex",
  gemini: "gemini",
  qwen: "qwen",
  "cursor-agent": "cursor-agent",
  aider: "aider",
  amp: "amp",
  goose: "goose",
  crush: "crush",
  copilot: "copilot",
};

export const HARNESS_LABELS: Record<HarnessId, string> = {
  opencode: "opencode",
  "claude-code": "Claude Code",
  pi: "pi",
  codex: "Codex",
  gemini: "Gemini CLI",
  qwen: "Qwen Code",
  "cursor-agent": "Cursor Agent",
  aider: "aider",
  amp: "Amp",
  goose: "goose",
  crush: "Crush",
  copilot: "GitHub Copilot CLI",
};

export interface SecondBrainConfig {
  enabled: boolean;
  dir: string;
  globalDir: string;
  learning: {
    enabled: boolean;
    triggers: {
      onFailure: boolean;
      onCorrection: boolean;
      onExplicitNote: boolean;
      periodic: boolean;
    };
    batchIntervalMs: number;
    model: string;
    minConfidence: number;
    maxSuggestionsPerBatch: number;
  };
  routing: {
    augment: boolean;
    minSamples: number;
    minMargin: number;
  };
  retrieval: {
    maxPreferences: number;
    maxLessons: number;
    maxBriefingChars: number;
  };
}

export type SettingsSectionId =
  | "models"
  | "harnesses"
  | "routing"
  | "execution"
  | "permissions"
  | "general"
  | "second-brain";
