/**
 * Mirrors packages/server/src/config.ts's Config shape. There are no
 * provider credentials here on purpose: every harness CLI holds its own
 * authentication, and local model servers need no key.
 */

export type HarnessId = "opencode" | "claude-code" | "pi";

export interface HarnessConfig {
  enabled: boolean;
  path: string;
  defaultModel: string;
  args: string[];
  concurrency: number;
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
    timeoutMs: number;
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

export const HARNESS_IDS: HarnessId[] = ["opencode", "claude-code", "pi"];

export const HARNESS_LABELS: Record<HarnessId, string> = {
  opencode: "opencode",
  "claude-code": "Claude Code",
  pi: "pi",
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
