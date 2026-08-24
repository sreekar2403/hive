import { Router, Request, Response } from "express";
import spawn from "cross-spawn";
import {
  Config,
  HarnessId,
  ProviderId,
  deepMerge,
  loadConfig,
  saveConfig,
} from "../config";
import {
  signOutSso,
  ssoStatus,
  startSso,
  type AuthMode,
  type SsoStatus,
} from "../auth/sso";

/**
 * Providers, harnesses and task-model routing — the control panel for the
 * whole swarm. See packages/client/src/pages/settings for the UI that
 * drives these endpoints.
 */
const router: Router = Router();

const PROVIDER_IDS: ProviderId[] = [
  "anthropic",
  "openai",
  "openrouter",
  "google",
  "ollama",
  "lmstudio",
];

const HARNESS_IDS: HarnessId[] = ["opencode", "claude-code", "pi"];

/** "sk-abcd...wxyz" -> "sk-…wxyz". Never enough to reconstruct the key. */
function maskKey(key: string): string {
  if (!key) return "";
  if (key.length <= 8) return "•".repeat(key.length);
  return `${key.slice(0, 3)}…${key.slice(-4)}`;
}

interface ProviderView {
  enabled: boolean;
  baseUrl: string;
  hasKey: boolean;
  keyHint: string | null;
  authMode: AuthMode;
  /** Live SSO state, so the UI never has to guess whether a CLI is signed in. */
  sso: SsoStatus;
}

/** Config as sent to the client: providers' apiKey is never included raw. */
function toView(config: Config) {
  const providers: Record<string, ProviderView> = {};
  for (const id of PROVIDER_IDS) {
    const p = config.providers[id];
    providers[id] = {
      enabled: p.enabled,
      baseUrl: p.baseUrl,
      hasKey: Boolean(p.apiKey),
      keyHint: p.apiKey ? maskKey(p.apiKey) : null,
      authMode: p.authMode ?? "api-key",
      sso: ssoStatus(id),
    };
  }

  return {
    providers,
    harnesses: config.harnesses,
    routing: config.routing,
    permission: config.permission,
    loop: config.loop,
    server: config.server,
    storage: config.storage,
    general: config.general,
  };
}

// GET /api/settings — full config, secrets masked
router.get("/", (_req: Request, res: Response) => {
  const config = loadConfig();
  res.json(toView(config));
});

// PUT /api/settings — partial update, merged and persisted
router.put("/", (req: Request, res: Response) => {
  const config = loadConfig();
  const body = req.body;

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return res.status(400).json({ error: "Expected a settings object" });
  }

  try {
    validatePartialConfig(body);
  } catch (err) {
    return res.status(400).json({
      error: err instanceof Error ? err.message : "Invalid settings payload",
    });
  }

  // Mutates the same object every other component in the running server
  // holds a reference to (see loadConfig's singleton cache), so routing
  // rules, permission keywords, loop limits, etc. take effect immediately.
  deepMerge(config, body);

  try {
    saveConfig(config);
  } catch (err) {
    return res.status(500).json({
      error: `Settings applied but could not be saved to disk: ${
        err instanceof Error ? err.message : String(err)
      }`,
    });
  }

  res.json(toView(config));
});

function validatePartialConfig(body: any): void {
  if (body.providers) {
    if (typeof body.providers !== "object" || Array.isArray(body.providers)) {
      throw new Error("providers must be an object");
    }
    for (const [id, patch] of Object.entries(body.providers)) {
      if (!PROVIDER_IDS.includes(id as ProviderId)) {
        throw new Error(`Unknown provider '${id}'`);
      }
      if (!patch || typeof patch !== "object") {
        throw new Error(`providers.${id} must be an object`);
      }
      const p = patch as Record<string, unknown>;
      if ("apiKey" in p && typeof p.apiKey !== "string") {
        throw new Error(`providers.${id}.apiKey must be a string`);
      }
      if ("baseUrl" in p && typeof p.baseUrl !== "string") {
        throw new Error(`providers.${id}.baseUrl must be a string`);
      }
      if ("enabled" in p && typeof p.enabled !== "boolean") {
        throw new Error(`providers.${id}.enabled must be a boolean`);
      }
      if ("authMode" in p && p.authMode !== "api-key" && p.authMode !== "sso") {
        throw new Error(
          `providers.${id}.authMode must be "api-key" or "sso"`,
        );
      }
    }
  }

  if (body.harnesses) {
    if (typeof body.harnesses !== "object" || Array.isArray(body.harnesses)) {
      throw new Error("harnesses must be an object");
    }
    for (const [id, patch] of Object.entries(body.harnesses)) {
      if (!HARNESS_IDS.includes(id as HarnessId)) {
        throw new Error(`Unknown harness '${id}'`);
      }
      if (!patch || typeof patch !== "object") {
        throw new Error(`harnesses.${id} must be an object`);
      }
      const h = patch as Record<string, unknown>;
      if ("args" in h && !Array.isArray(h.args)) {
        throw new Error(`harnesses.${id}.args must be an array`);
      }
      if (
        "concurrency" in h &&
        (typeof h.concurrency !== "number" || h.concurrency < 1)
      ) {
        throw new Error(`harnesses.${id}.concurrency must be a positive number`);
      }
    }
  }

  if (body.routing?.rules) {
    if (!Array.isArray(body.routing.rules)) {
      throw new Error("routing.rules must be an array");
    }
    for (const rule of body.routing.rules) {
      if (!rule || typeof rule !== "object") {
        throw new Error("Each routing rule must be an object");
      }
      if (typeof rule.id !== "string" || !rule.id) {
        throw new Error("Each routing rule needs an id");
      }
      if (typeof rule.harness !== "string" || !rule.harness) {
        throw new Error(`Routing rule '${rule.id}' needs a harness`);
      }
      if (rule.pattern && typeof rule.pattern === "string") {
        try {
          new RegExp(rule.pattern);
        } catch {
          throw new Error(
            `Routing rule '${rule.id}' has an invalid pattern: not a valid regular expression`,
          );
        }
      }
    }
  }

  if (body.permission?.destructiveActions) {
    if (!Array.isArray(body.permission.destructiveActions)) {
      throw new Error("permission.destructiveActions must be an array");
    }
    if (
      body.permission.destructiveActions.some(
        (a: unknown) => typeof a !== "string",
      )
    ) {
      throw new Error("permission.destructiveActions entries must be strings");
    }
  }

  if (body.loop) {
    const l = body.loop;
    if ("maxIterations" in l && (typeof l.maxIterations !== "number" || l.maxIterations < 1)) {
      throw new Error("loop.maxIterations must be a positive number");
    }
    if ("timeoutMs" in l && (typeof l.timeoutMs !== "number" || l.timeoutMs < 1000)) {
      throw new Error("loop.timeoutMs must be at least 1000ms");
    }
    if (
      "maxConcurrentAgents" in l &&
      (typeof l.maxConcurrentAgents !== "number" || l.maxConcurrentAgents < 1)
    ) {
      throw new Error("loop.maxConcurrentAgents must be a positive number");
    }
  }
}

// POST /api/settings/providers/:id/test — probe a provider credential
router.post("/providers/:id/test", async (req: Request, res: Response) => {
  const id = req.params.id as ProviderId;
  if (!PROVIDER_IDS.includes(id)) {
    return res.status(404).json({ error: `Unknown provider '${id}'` });
  }

  const config = loadConfig();
  const stored = config.providers[id];

  const apiKey =
    typeof req.body?.apiKey === "string" && req.body.apiKey
      ? req.body.apiKey
      : stored.apiKey;
  const baseUrl =
    typeof req.body?.baseUrl === "string" && req.body.baseUrl
      ? req.body.baseUrl
      : stored.baseUrl;

  // An SSO provider has no key to test — what matters is whether the CLI
  // that owns the credential is signed in, so report that instead of
  // failing with "no API key configured".
  if ((stored.authMode ?? "api-key") === "sso") {
    const sso = ssoStatus(id);
    return res.json({ success: sso.signedIn, message: sso.detail });
  }

  const result = await testProvider(id, apiKey, baseUrl);
  res.json(result);
});

interface ProviderTestResult {
  success: boolean;
  message: string;
}

async function testProvider(
  id: ProviderId,
  apiKey: string,
  baseUrl: string,
): Promise<ProviderTestResult> {
  if (id !== "ollama" && !apiKey) {
    return { success: false, message: "No API key configured" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);

  try {
    let url: string;
    const headers: Record<string, string> = {};

    switch (id) {
      case "anthropic":
        url = `${baseUrl || "https://api.anthropic.com"}/v1/models`;
        headers["x-api-key"] = apiKey;
        headers["anthropic-version"] = "2023-06-01";
        break;
      case "openai":
        url = `${baseUrl || "https://api.openai.com"}/v1/models`;
        headers.Authorization = `Bearer ${apiKey}`;
        break;
      case "openrouter":
        url = `${baseUrl || "https://openrouter.ai/api"}/v1/key`;
        headers.Authorization = `Bearer ${apiKey}`;
        break;
      case "google":
        url = `${
          baseUrl || "https://generativelanguage.googleapis.com"
        }/v1beta/models?key=${encodeURIComponent(apiKey)}`;
        break;
      case "ollama":
        url = `${baseUrl || "http://localhost:11434"}/api/tags`;
        break;
      case "lmstudio":
        url = `${baseUrl || "http://localhost:1234"}/v1/models`;
        break;
    }

    const response = await fetch(url, { headers, signal: controller.signal });

    if (response.ok) {
      return {
        success: true,
        message:
          id === "ollama" || id === "lmstudio" ? "Reachable" : "Key is valid",
      };
    }
    if (response.status === 401 || response.status === 403) {
      return { success: false, message: "Invalid API key" };
    }
    return {
      success: false,
      message: `Provider responded with ${response.status} ${response.statusText}`,
    };
  } catch (err) {
    const isAbort = err instanceof Error && err.name === "AbortError";
    return {
      success: false,
      message: isAbort
        ? "Timed out reaching provider"
        : err instanceof Error
          ? err.message
          : "Could not reach provider",
    };
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ */
/* Single sign-on                                                      */
/* ------------------------------------------------------------------ */

/** Narrows a path param to a known provider, answering 404 if it isn't. */
function requireProvider(req: Request, res: Response): ProviderId | null {
  const id = req.params.id as ProviderId;
  if (!PROVIDER_IDS.includes(id)) {
    res.status(404).json({ error: `Unknown provider '${id}'` });
    return null;
  }
  return id;
}

// GET /api/settings/providers/:id/sso — is the owning CLI signed in?
router.get("/providers/:id/sso", (req: Request, res: Response) => {
  const id = requireProvider(req, res);
  if (!id) return;
  res.json(ssoStatus(id));
});

// POST /api/settings/providers/:id/sso/login — open the CLI's own flow
router.post("/providers/:id/sso/login", (req: Request, res: Response) => {
  const id = requireProvider(req, res);
  if (!id) return;
  const result = startSso(id);
  // The flow is interactive and finishes in a terminal Hive doesn't own,
  // so the status the client polls afterwards is the real answer.
  res.json({ ...result, status: ssoStatus(id) });
});

// POST /api/settings/providers/:id/sso/logout
router.post("/providers/:id/sso/logout", (req: Request, res: Response) => {
  const id = requireProvider(req, res);
  if (!id) return;
  res.json({ ...signOutSso(id), status: ssoStatus(id) });
});

// GET /api/settings/harnesses — live availability probe of each harness
router.get("/harnesses", async (_req: Request, res: Response) => {
  const config = loadConfig();

  const harnesses = await Promise.all(
    HARNESS_IDS.map(async (id) => {
      const hc = config.harnesses[id];
      const probe = await probeHarness(hc.path);
      return {
        id,
        enabled: hc.enabled,
        path: hc.path,
        defaultModel: hc.defaultModel,
        args: hc.args,
        concurrency: hc.concurrency,
        available: probe.available,
        version: probe.version,
      };
    }),
  );

  res.json({ harnesses });
});

interface HarnessProbeResult {
  available: boolean;
  version: string | null;
}

/** Spawns `<path> --version` and reports whether it succeeded. */
function probeHarness(execPath: string): Promise<HarnessProbeResult> {
  return new Promise((resolve) => {
    let stdout = "";
    let settled = false;

    const settle = (result: HarnessProbeResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    let proc;
    try {
      proc = spawn(execPath, ["--version"], { timeout: 4000 });
    } catch {
      settle({ available: false, version: null });
      return;
    }

    proc.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    proc.on("error", () => settle({ available: false, version: null }));

    proc.on("close", (code) => {
      const version = stdout.trim().split("\n")[0]?.trim() || null;
      settle({ available: code === 0, version: code === 0 ? version : null });
    });
  });
}

export default router;
