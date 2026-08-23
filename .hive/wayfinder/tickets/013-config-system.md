# Ticket: Config System

**Label:** `wayfinder:task`
**Status:** CLOSED
**Blocked by:** None
**Resolved:** 2026-08-19

## Question

How should Hive load and manage configuration? The spec defines config files but not the loading mechanism.

**Decision needed:**

- Config format (YAML? JSON? JSON5?)?
- Config location (project root? ~/.config/hive? both?)?
- How are config overrides handled (env vars? CLI flags? UI settings?)?
- How is config validated (schema? TypeScript types? runtime checks?)?

**Considerations:**

- YAML is human-readable but needs a parser
- JSON is native but verbose
- Config needs to be writable from the Settings UI
- Sensitive config (API keys) should be in .env, not config files

**Options:**

- A) YAML files — human-readable, good for config
- B) JSON files — native, no extra deps
- C) TypeScript config — type-safe but not human-writable

**Recommendation:** A) YAML — best readability for config files. Use js-yaml for parsing.

## Resolution

**Decision: A) YAML config with env var overrides for secrets. Three-tier precedence.**

### Precedence (highest wins)

```
1. Environment variables (HIVE_*)
2. User config (~/.config/hive/config.yaml)   ← written by Settings UI
3. Project config (config/default.yaml)        ← checked into repo
```

### Config File Structure

```yaml
# config/default.yaml — project defaults, checked into repo

# Routing
routing:
  frontend:
    pattern: "component|ui|css|style|layout|responsive"
    harness: opencode
    model: sonnet
  backend:
    pattern: "api|endpoint|server|database|auth"
    harness: claude-code
    model: sonnet
  architecture:
    pattern: "design|architect|system|refactor"
    harness: opencode
    model: opus
  devops:
    pattern: "deploy|ci|docker|nginx|infra"
    harness: claude-code
    model: sonnet
  research:
    pattern: "find|search|compare|evaluate"
    harness: pi
    model: haiku
  default:
    harness: opencode
    model: sonnet

# Loop engine
loop:
  max_iterations: 5
  timeout_per_iteration: 300000 # 5 minutes

# Context compaction
compaction:
  enabled: true
  token_budget_per_agent: 10000
  compactor_model: haiku
  fallback: truncate

# Resource limits
resource_limits:
  max_concurrent_local: 1
  queue_timeout: 60000
  fallback_to_cloud: false

# Permissions
permissions:
  mode: ask # ask | allow-session | always-allow
  whitelist: []
  blacklist: []
  timeout: 30000

# Branch manager
branching:
  prefix: hive
  create_pr: false # PR optional
```

```yaml
# ~/.config/hive/config.yaml — user overrides, written by Settings UI

routing:
  architecture:
    model: opus # user prefers opus for architecture

compaction:
  token_budget_per_agent: 15000 # user wants more context
```

```
# .env — secrets only, never committed

HIVE_ANTHROPIC_API_KEY=sk-ant-...
HIVE_OPENAI_API_KEY=sk-...
```

### Environment Variable Mapping

```bash
# .env format
HIVE_ANTHROPIC_API_KEY=sk-ant-...
HIVE_OPENAI_API_KEY=sk-...
HIVE_OLLAMA_BASE_URL=http://localhost:11434
HIVE_LM_STUDIO_BASE_URL=http://localhost:1234

# Maps to config:
# HIVE_.* → config.* (nested with underscores)
```

### Implementation

```typescript
// packages/server/src/config.ts

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import * as yaml from "js-yaml";
import { z } from "zod";

// --- Schema (Zod) ---

const RoutingRuleSchema = z.object({
  pattern: z.string(),
  harness: z.string(),
  model: z.string(),
});

const ConfigSchema = z.object({
  routing: z.record(RoutingRuleSchema),
  loop: z
    .object({
      max_iterations: z.number().default(5),
      timeout_per_iteration: z.number().default(300000),
    })
    .default({}),
  compaction: z
    .object({
      enabled: z.boolean().default(true),
      token_budget_per_agent: z.number().default(10000),
      compactor_model: z.string().default("haiku"),
      fallback: z.enum(["truncate", "error"]).default("truncate"),
    })
    .default({}),
  resource_limits: z
    .object({
      max_concurrent_local: z.number().default(1),
      queue_timeout: z.number().default(60000),
      fallback_to_cloud: z.boolean().default(false),
    })
    .default({}),
  permissions: z
    .object({
      mode: z.enum(["ask", "allow-session", "always-allow"]).default("ask"),
      whitelist: z.array(z.string()).default([]),
      blacklist: z.array(z.string()).default([]),
      timeout: z.number().default(30000),
    })
    .default({}),
  branching: z
    .object({
      prefix: z.string().default("hive"),
      create_pr: z.boolean().default(false),
    })
    .default({}),
});

export type Config = z.infer<typeof ConfigSchema>;

// --- Loading ---

const PROJECT_CONFIG_PATH = join(process.cwd(), "config", "default.yaml");
const USER_CONFIG_PATH = join(homedir(), ".config", "hive", "config.yaml");

export function loadConfig(): Config {
  // 1. Load project config
  let config: Partial<Config> = {};
  if (existsSync(PROJECT_CONFIG_PATH)) {
    const raw = readFileSync(PROJECT_CONFIG_PATH, "utf-8");
    config = yaml.load(raw) || {};
  }

  // 2. Merge user config (overrides project)
  if (existsSync(USER_CONFIG_PATH)) {
    const raw = readFileSync(USER_CONFIG_PATH, "utf-8");
    const userConfig = yaml.load(raw) || {};
    config = deepMerge(config, userConfig);
  }

  // 3. Merge env vars (overrides both)
  const envConfig = loadEnvOverrides();
  config = deepMerge(config, envConfig);

  // 4. Validate with Zod
  const result = ConfigSchema.safeParse(config);
  if (!result.success) {
    console.error("Config validation failed:", result.error.format());
    return ConfigSchema.parse({}); // return defaults
  }

  return result.data;
}

function loadEnvOverrides(): Partial<Config> {
  const overrides: Partial<Config> = {};

  // API keys
  if (process.env.HIVE_ANTHROPIC_API_KEY) {
    overrides.routing = overrides.routing || {};
    // model config handled by harness, not routing
  }

  // Loop settings
  if (process.env.HIVE_MAX_ITERATIONS) {
    overrides.loop = {
      ...overrides.loop,
      max_iterations: parseInt(process.env.HIVE_MAX_ITERATIONS),
    };
  }

  return overrides;
}

// --- User Config (written by Settings UI) ---

export function saveUserConfig(config: Partial<Config>): void {
  const dir = join(homedir(), ".config", "hive");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(USER_CONFIG_PATH, yaml.dump(config, { indent: 2 }));
}

export function getUserConfig(): Partial<Config> {
  if (!existsSync(USER_CONFIG_PATH)) return {};
  const raw = readFileSync(USER_CONFIG_PATH, "utf-8");
  return yaml.load(raw) || {};
}

// --- Helpers ---

function deepMerge(target: any, source: any): any {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] instanceof Object && key in result) {
      result[key] = deepMerge(result[key], source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}
```

### Settings UI → Config

```typescript
// In the SettingsModal component
const handleSave = async (settings: Partial<Config>) => {
  // Send to server via WebSocket
  ws.send(JSON.stringify({
    type: 'settings:update',
    sessionId: 'global',
    payload: { settings },
    id: crypto.randomUUID(),
    timestamp: Date.now(),
  }));
};

// Server handles it
case 'settings:update':
  saveUserConfig(msg.payload.settings);
  // Reload config
  currentConfig = loadConfig();
  break;
```
