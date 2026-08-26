import { Router, Request, Response } from "express";
import spawn from "cross-spawn";
import {
  Config,
  HarnessId,
  deepMerge,
  loadConfig,
  saveConfig,
} from "../config";

/**
 * Harnesses and task-model routing — the control panel for the whole
 * swarm. Credentials are not managed here: every harness CLI holds its own
 * (that is Hive's premise), and local model servers need no key at all.
 * See packages/client/src/pages/settings for the UI that drives these
 * endpoints.
 */
const router: Router = Router();

const HARNESS_IDS: HarnessId[] = ["opencode", "claude-code", "pi"];

/** Config as sent to the client. No secrets exist in this shape any more. */
function toView(config: Config) {
  return {
    localModels: config.localModels,
    harnesses: config.harnesses,
    routing: config.routing,
    permission: config.permission,
    loop: config.loop,
    server: config.server,
    storage: config.storage,
    secondBrain: config.secondBrain,
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
  if (body.localModels) {
    if (typeof body.localModels !== "object" || Array.isArray(body.localModels)) {
      throw new Error("localModels must be an object");
    }
    for (const [key, value] of Object.entries(body.localModels)) {
      if (typeof value !== "string") {
        throw new Error(`localModels.${key} must be a string (a base URL)`);
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

  if (body.routing?.llmModel !== undefined) {
    if (typeof body.routing.llmModel !== "string") {
      throw new Error("routing.llmModel must be a string");
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
    if ("pipeline" in l && l.pipeline !== undefined) {
      const pl = l.pipeline as Record<string, unknown>;
      if (typeof pl !== "object" || Array.isArray(pl)) {
        throw new Error("loop.pipeline must be an object");
      }
      if ("enabled" in pl && typeof pl.enabled !== "boolean") {
        throw new Error("loop.pipeline.enabled must be a boolean");
      }
      if ("plan" in pl && typeof pl.plan !== "boolean") {
        throw new Error("loop.pipeline.plan must be a boolean");
      }
      if (
        "maxRepairs" in pl &&
        (typeof pl.maxRepairs !== "number" || pl.maxRepairs < 0 || pl.maxRepairs > 10)
      ) {
        throw new Error("loop.pipeline.maxRepairs must be between 0 and 10");
      }
      if ("testCommand" in pl && typeof pl.testCommand !== "string") {
        throw new Error("loop.pipeline.testCommand must be a string");
      }
    }
    // 0 is meaningful: it hands the limit to capacity.ts, which sizes it
    // against the machine rather than a number typed once on a laptop.
    if (
      "maxConcurrentAgents" in l &&
      (typeof l.maxConcurrentAgents !== "number" ||
        l.maxConcurrentAgents < 0 ||
        !Number.isFinite(l.maxConcurrentAgents))
    ) {
      throw new Error(
        "loop.maxConcurrentAgents must be 0 (auto) or a positive number",
      );
    }
  }

  if (body.secondBrain) {
    const b = body.secondBrain;
    if (typeof b !== "object" || Array.isArray(b)) {
      throw new Error("secondBrain must be an object");
    }
    if ("enabled" in b && typeof b.enabled !== "boolean") {
      throw new Error("secondBrain.enabled must be a boolean");
    }
    // These two decide where files get written, so a wrong type here is a
    // wrong path, not a wrong setting.
    for (const key of ["dir", "globalDir"]) {
      if (key in b && typeof b[key] !== "string") {
        throw new Error(`secondBrain.${key} must be a string`);
      }
    }

    if (b.learning) {
      const l = b.learning;
      if ("enabled" in l && typeof l.enabled !== "boolean") {
        throw new Error("secondBrain.learning.enabled must be a boolean");
      }
      if ("model" in l && typeof l.model !== "string") {
        throw new Error("secondBrain.learning.model must be a string");
      }
      if (
        "batchIntervalMs" in l &&
        (typeof l.batchIntervalMs !== "number" || l.batchIntervalMs < 60_000)
      ) {
        throw new Error(
          "secondBrain.learning.batchIntervalMs must be at least 60000ms",
        );
      }
      if ("minConfidence" in l && !isUnitInterval(l.minConfidence)) {
        throw new Error(
          "secondBrain.learning.minConfidence must be between 0 and 1",
        );
      }
      if (
        "maxSuggestionsPerBatch" in l &&
        (typeof l.maxSuggestionsPerBatch !== "number" ||
          l.maxSuggestionsPerBatch < 0)
      ) {
        throw new Error(
          "secondBrain.learning.maxSuggestionsPerBatch must be zero or more",
        );
      }
      if (l.triggers) {
        for (const [name, value] of Object.entries(l.triggers)) {
          if (typeof value !== "boolean") {
            throw new Error(
              `secondBrain.learning.triggers.${name} must be a boolean`,
            );
          }
        }
      }
    }

    if (b.routing) {
      const r = b.routing;
      if ("augment" in r && typeof r.augment !== "boolean") {
        throw new Error("secondBrain.routing.augment must be a boolean");
      }
      if (
        "minSamples" in r &&
        (typeof r.minSamples !== "number" || r.minSamples < 1)
      ) {
        throw new Error("secondBrain.routing.minSamples must be at least 1");
      }
      if ("minMargin" in r && !isUnitInterval(r.minMargin)) {
        throw new Error("secondBrain.routing.minMargin must be between 0 and 1");
      }
    }

    if (b.retrieval) {
      for (const [key, value] of Object.entries(b.retrieval)) {
        if (typeof value !== "number" || value < 0) {
          throw new Error(`secondBrain.retrieval.${key} must be zero or more`);
        }
      }
    }
  }
}

function isUnitInterval(value: unknown): boolean {
  return typeof value === "number" && value >= 0 && value <= 1;
}

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
