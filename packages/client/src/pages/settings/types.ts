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

export interface ProviderView {
  enabled: boolean;
  baseUrl: string;
  hasKey: boolean;
  keyHint: string | null;
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
  general: {
    defaultProjectId: string;
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

export type SettingsSectionId =
  | "providers"
  | "models"
  | "harnesses"
  | "routing"
  | "execution"
  | "permissions"
  | "general";
