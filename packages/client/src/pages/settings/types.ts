/**
 * Mirrors packages/server/src/config.ts's Config shape, minus what the
 * server never sends over the wire (raw API keys). Kept as a local,
 * hand-written mirror rather than a shared import since @hive/shared only
 * carries runtime-agnostic types, not the server's on-disk config shape.
 */

export type ProviderId =
  | "anthropic"
  | "openai"
  | "openrouter"
  | "google"
  | "ollama"
  | "lmstudio";

export type HarnessId = "opencode" | "claude-code" | "pi";

export type AuthMode = "api-key" | "sso";

/**
 * Mirrors SsoStatus in packages/server/src/auth/sso.ts. Every field is
 * observed server-side (a credential file, an env var) rather than
 * remembered, so the UI can state the sign-in state as fact.
 */
export interface SsoStatus {
  supported: boolean;
  signedIn: boolean;
  cli: string | null;
  description: string | null;
  detail: string;
  command: string | null;
}

export interface ProviderView {
  enabled: boolean;
  baseUrl: string;
  hasKey: boolean;
  keyHint: string | null;
  authMode: AuthMode;
  sso: SsoStatus;
}

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
  provider: string;
  reasoning: string;
  enabled: boolean;
}

export interface SettingsConfig {
  providers: Record<ProviderId, ProviderView>;
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
  };
  server: {
    port: number;
  };
  storage: {
    cacheDir: string;
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

export const PROVIDER_IDS: ProviderId[] = [
  "anthropic",
  "openai",
  "openrouter",
  "google",
  "ollama",
  "lmstudio",
];

export const HARNESS_IDS: HarnessId[] = ["opencode", "claude-code", "pi"];

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  openrouter: "OpenRouter",
  google: "Google",
  ollama: "Ollama (local)",
  lmstudio: "LM Studio (local)",
};

export const PROVIDER_KEY_PLACEHOLDERS: Record<ProviderId, string> = {
  anthropic: "sk-ant-…",
  openai: "sk-…",
  openrouter: "sk-or-…",
  google: "AIza…",
  ollama: "No key required",
  lmstudio: "No key required",
};

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
  | "providers"
  | "models"
  | "harnesses"
  | "routing"
  | "execution"
  | "permissions"
  | "general"
  | "second-brain";
