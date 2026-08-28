import spawn from "cross-spawn";
import { loadConfig } from "../config";
import { log } from "../telemetry";

/**
 * What models can this machine actually run, right now?
 *
 * Every source is asked in its own dialect rather than assumed:
 *
 *   opencode      `opencode models`       → one `provider/model` per line
 *   pi            `pi --list-models`      → fixed-width table with context/thinking
 *   codex         `codex --help`          → no list command; documented ids
 *   gemini / qwen no list command exists  → documented ids
 *   cursor-agent  `cursor-agent models`   → one id per line
 *   claude-code   no list command exists  → aliases, plus the Anthropic API when keyed
 *   aider         `aider --list-models ""` → LiteLLM ids, one per line
 *   ollama        GET /api/tags
 *   lm studio     GET /v1/models
 *
 * Amp, goose and Crush are absent on purpose: they choose their own model
 * (per plan, per profile, per step) and expose no per-run flag, so there is
 * nothing here for a picker to offer. `HarnessProfile.modelSelectable` in
 * harnesses/profiles.ts is the same fact, stated where routing reads it.
 *
 * A source that is missing or unreachable reports why instead of vanishing:
 * "LM Studio isn't running" is the answer to a real question, and the UI
 * shows it rather than an empty list.
 */

export interface ModelOption {
  /** Stable identity for the picker: `harness/provider/model`. */
  id: string;
  provider: string;
  model: string;
  /** What the harness itself wants passed to `--model`. */
  ref: string;
  contextLabel: string | null;
  thinking: boolean | null;
  /**
   * Whether this model can actually look at an image.
   *
   * `null` means nobody could tell us, which is different from `false` —
   * a picker greys out what it knows cannot work, and leaves the unknown
   * alone rather than hiding a model that would have been fine.
   */
  vision: boolean | null;
}

export interface CatalogSource {
  id: string;
  kind: "harness" | "provider";
  label: string;
  ok: boolean;
  /** Why the list is empty, when it is. */
  error: string | null;
  models: ModelOption[];
  checkedAt: number;
}

export interface Catalog {
  sources: CatalogSource[];
  /** Every model from every harness, flattened for search. */
  options: Array<ModelOption & { harness: string }>;
  generatedAt: number;
}

const HARNESS_LABEL: Record<string, string> = {
  opencode: "opencode",
  "claude-code": "Claude Code",
  pi: "pi",
  codex: "Codex",
  gemini: "Gemini CLI",
  qwen: "Qwen Code",
  "cursor-agent": "Cursor Agent",
  aider: "aider",
  copilot: "GitHub Copilot CLI",
};

/**
 * The CLIs with no model-list command. Same situation as Claude Code's
 * aliases: a written-down catalogue is better than an empty picker, and the
 * `error` field on each source says plainly that this list is documentation
 * rather than discovery.
 */
const STATIC_MODELS: Record<
  string,
  { provider: string; entries: Array<{ model: string; note?: string }> }
> = {
  codex: {
    provider: "openai",
    entries: [
      { model: "gpt-5-codex", note: "agentic coding" },
      { model: "gpt-5", note: "general reasoning" },
      { model: "o4-mini", note: "fast reasoning" },
    ],
  },
  gemini: {
    provider: "google",
    entries: [
      { model: "gemini-2.5-pro", note: "most capable" },
      { model: "gemini-2.5-flash", note: "fast" },
      { model: "gemini-2.5-flash-lite", note: "cheapest" },
    ],
  },
  qwen: {
    provider: "qwen",
    entries: [
      { model: "qwen3-coder-plus", note: "coding" },
      { model: "qwen3-coder-flash", note: "fast" },
    ],
  },
  copilot: {
    provider: "github",
    entries: [
      { model: "claude-sonnet-4.5", note: "balanced" },
      { model: "gpt-5", note: "general reasoning" },
    ],
  },
};

/**
 * Claude Code takes an alias or a full model id and has no way to list
 * them, so this is a written-down catalogue rather than a discovered one.
 * Aliases are what the CLI documents; they keep working as models move.
 */
const CLAUDE_ALIASES: Array<{ model: string; note: string }> = [
  { model: "default", note: "whatever the CLI is configured to use" },
  { model: "opus", note: "most capable" },
  { model: "sonnet", note: "balanced" },
  { model: "haiku", note: "fastest" },
  { model: "sonnet[1m]", note: "1M-token context" },
];

const CACHE_TTL_MS = 5 * 60 * 1000;
let cached: Catalog | null = null;
let inFlight: Promise<Catalog> | null = null;

/* ------------------------------------------------------------------ */
/* Process + HTTP helpers                                              */
/* ------------------------------------------------------------------ */

interface CommandResult {
  ok: boolean;
  stdout: string;
  error: string | null;
}

/**
 * These CLIs are interactive by nature; stdin is closed immediately so a
 * discovery call can never sit waiting for a prompt nobody will answer.
 */
function run(
  command: string,
  args: string[],
  timeoutMs = 20000,
): Promise<CommandResult> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;

    const settle = (result: CommandResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    let proc;
    try {
      proc = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    } catch (err) {
      settle({
        ok: false,
        stdout: "",
        error:
          err instanceof Error ? err.message : "Could not start the command",
      });
      return;
    }

    const timer = setTimeout(() => {
      proc.kill();
      settle({ ok: false, stdout, error: `\`${command}\` timed out` });
    }, timeoutMs);

    proc.stdin?.end();
    proc.stdout?.on("data", (d: Buffer) => (stdout += d.toString()));
    proc.stderr?.on("data", (d: Buffer) => (stderr += d.toString()));

    proc.on("error", (err: Error) => {
      clearTimeout(timer);
      settle({
        ok: false,
        stdout: "",
        error: /ENOENT/.test(err.message)
          ? `\`${command}\` is not on PATH`
          : err.message,
      });
    });

    proc.on("close", (code) => {
      clearTimeout(timer);
      settle({
        ok: code === 0,
        stdout,
        error:
          code === 0
            ? null
            : stderr.trim().split("\n")[0] || `exited with ${code}`,
      });
    });
  });
}

async function getJson(
  url: string,
  headers: Record<string, string> = {},
  timeoutMs = 6000,
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    if (!res.ok)
      return { ok: false as const, error: `HTTP ${res.status}`, data: null };
    return { ok: true as const, error: null, data: (await res.json()) as any };
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return {
      ok: false as const,
      error: aborted ? "timed out" : "not reachable",
      data: null,
    };
  } finally {
    clearTimeout(timer);
  }
}

function option(
  harness: string,
  provider: string,
  model: string,
  extra: Partial<ModelOption> = {},
): ModelOption {
  return {
    id: `${harness}/${provider}/${model}`,
    provider,
    model,
    ref: extra.ref ?? `${provider}/${model}`,
    contextLabel: extra.contextLabel ?? null,
    thinking: extra.thinking ?? null,
    vision: extra.vision ?? null,
  };
}

/**
 * Model families documented to accept images.
 *
 * Only consulted when the source could not say for itself. Ollama reports
 * real capabilities per model and is always believed over this list; these
 * are the CLIs that publish no capability data at all, where a written-down
 * answer beats greying out a model that works.
 */
const VISION_FAMILIES =
  // Claude Code's catalogue is aliases — "sonnet", "opus" — not full ids,
  // so those have to be named as well as the family they belong to.
  /(claude|^(default|opus|sonnet|haiku)|gpt-5|gpt-4o|gemini|pixtral|llava|qwen.*-vl|minicpm-v|moondream|internvl)/i;

function knownVision(model: string): boolean | null {
  return VISION_FAMILIES.test(model) ? true : null;
}

/* ------------------------------------------------------------------ */
/* Sources                                                             */
/* ------------------------------------------------------------------ */

/** `opencode models` prints `provider/model`, one per line. */
async function fromOpenCode(execPath: string): Promise<CatalogSource> {
  const result = await run(execPath, ["models"]);
  const models: ModelOption[] = [];

  for (const line of result.stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.includes("/")) continue;
    const slash = trimmed.indexOf("/");
    const provider = trimmed.slice(0, slash);
    const model = trimmed.slice(slash + 1);
    if (!provider || !model || /\s/.test(provider)) continue;
    // opencode wants back exactly what it printed.
    models.push(option("opencode", provider, model, { ref: trimmed }));
  }

  return {
    id: "opencode",
    kind: "harness",
    label: HARNESS_LABEL.opencode,
    ok: result.ok && models.length > 0,
    error: models.length === 0 ? (result.error ?? "No models reported") : null,
    models,
    checkedAt: Date.now(),
  };
}

/**
 * `pi --list-models` prints a table:
 *   provider  model  context  max-out  thinking  images
 * Columns are whitespace-padded, and model ids can themselves contain a
 * slash, so split on runs of two-or-more spaces rather than on any space.
 */
async function fromPi(execPath: string): Promise<CatalogSource> {
  const result = await run(execPath, ["--list-models"]);
  const models: ModelOption[] = [];

  for (const line of result.stdout.split(/\r?\n/)) {
    const cells = line.trim().split(/\s{2,}/);
    if (cells.length < 2) continue;
    const [provider, model, context, , thinking] = cells;
    if (!provider || !model) continue;
    if (provider.toLowerCase() === "provider") continue; // header row
    models.push(
      option("pi", provider, model, {
        ref: `${provider}/${model}`,
        contextLabel: context ?? null,
        thinking: thinking ? thinking.toLowerCase() === "yes" : null,
      }),
    );
  }

  return {
    id: "pi",
    kind: "harness",
    label: HARNESS_LABEL.pi,
    ok: result.ok && models.length > 0,
    error: models.length === 0 ? (result.error ?? "No models reported") : null,
    models,
    checkedAt: Date.now(),
  };
}

/**
 * Claude Code has no list command and Hive holds no provider API keys —
 * credentials live inside the CLI. The documented aliases are the catalogue.
 */
async function fromClaudeCode(): Promise<CatalogSource> {
  const models: ModelOption[] = CLAUDE_ALIASES.map((entry) =>
    option("claude-code", "anthropic", entry.model, {
      ref: entry.model,
      contextLabel: entry.note,
    }),
  );

  return {
    id: "claude-code",
    kind: "harness",
    label: HARNESS_LABEL["claude-code"],
    ok: true,
    error:
      "Documented aliases only — Claude Code has no model list command; run `claude /model` to see what your account offers",
    models,
    checkedAt: Date.now(),
  };
}

/**
 * `cursor-agent models` prints one bare model id per line. Cursor gates the
 * list on the signed-in plan, so an unauthenticated CLI reports why rather
 * than pretending the list is empty.
 */
async function fromCursorAgent(execPath: string): Promise<CatalogSource> {
  const result = await run(execPath, ["models"]);
  const models: ModelOption[] = [];

  for (const line of result.stdout.split(/\r?\n/)) {
    const trimmed = line.trim().replace(/^[*-]\s+/, "");
    // Ids only: skip headers, blank lines and anything with prose in it.
    if (!trimmed || /\s/.test(trimmed)) continue;
    models.push(option("cursor-agent", "cursor", trimmed, { ref: trimmed }));
  }

  return {
    id: "cursor-agent",
    kind: "harness",
    label: HARNESS_LABEL["cursor-agent"],
    ok: result.ok && models.length > 0,
    error:
      models.length === 0
        ? (result.error ?? "No models reported — try `cursor-agent login`")
        : null,
    models,
    checkedAt: Date.now(),
  };
}

/**
 * aider delegates model naming to LiteLLM, so its list is long and provider
 * agnostic. An empty search term asks for everything.
 */
async function fromAider(execPath: string): Promise<CatalogSource> {
  const result = await run(execPath, ["--list-models", ""]);
  const models: ModelOption[] = [];

  for (const line of result.stdout.split(/\r?\n/)) {
    const trimmed = line.trim().replace(/^[*-]\s+/, "");
    if (!trimmed || /\s/.test(trimmed)) continue;
    // LiteLLM ids are `provider/model`; a bare id means the default provider.
    const slash = trimmed.indexOf("/");
    const provider = slash === -1 ? "aider" : trimmed.slice(0, slash);
    const model = slash === -1 ? trimmed : trimmed.slice(slash + 1);
    models.push(option("aider", provider, model, { ref: trimmed }));
  }

  return {
    id: "aider",
    kind: "harness",
    label: HARNESS_LABEL.aider,
    ok: result.ok && models.length > 0,
    error: models.length === 0 ? (result.error ?? "No models reported") : null,
    models,
    checkedAt: Date.now(),
  };
}

/** A CLI with no list command, from the written-down catalogue above. */
function fromStatic(harness: string): CatalogSource {
  const spec = STATIC_MODELS[harness];
  const models: ModelOption[] = spec.entries.map((entry) =>
    option(harness, spec.provider, entry.model, {
      ref: entry.model,
      contextLabel: entry.note ?? null,
    }),
  );

  return {
    id: harness,
    kind: "harness",
    label: HARNESS_LABEL[harness] ?? harness,
    ok: true,
    error:
      "Documented model ids only — this CLI has no list command, so anything " +
      "it accepts can also be typed by hand",
    models,
    checkedAt: Date.now(),
  };
}

/** Ollama's own list, which is the ground truth for what's pulled locally. */
async function fromOllama(baseUrl: string): Promise<CatalogSource> {
  const base = baseUrl || "http://localhost:11434";
  const res = await getJson(`${base}/api/tags`);
  const models: ModelOption[] = [];

  if (res.ok && Array.isArray(res.data?.models)) {
    for (const entry of res.data.models) {
      if (!entry?.name) continue;
      const size =
        typeof entry.size === "number" ? formatBytes(entry.size) : null;
      // Ollama is the one source that states this outright, per model.
      const capabilities = Array.isArray(entry.capabilities)
        ? (entry.capabilities as string[])
        : null;
      models.push(
        option("*", "ollama", entry.name, {
          contextLabel: size,
          vision: capabilities ? capabilities.includes("vision") : null,
        }),
      );
    }
  }

  return {
    id: "ollama",
    kind: "provider",
    label: "Ollama",
    ok: res.ok,
    error: res.ok ? null : `${base} — ${res.error}`,
    models,
    checkedAt: Date.now(),
  };
}

/** LM Studio speaks the OpenAI models endpoint. */
async function fromLmStudio(baseUrl: string): Promise<CatalogSource> {
  const base = baseUrl || "http://localhost:1234";
  const res = await getJson(`${base}/v1/models`);
  const models: ModelOption[] = [];

  if (res.ok && Array.isArray(res.data?.data)) {
    for (const entry of res.data.data) {
      if (!entry?.id) continue;
      models.push(option("*", "lmstudio", entry.id));
    }
  }

  return {
    id: "lmstudio",
    kind: "provider",
    label: "LM Studio",
    ok: res.ok,
    error: res.ok ? null : `${base} — ${res.error}`,
    models,
    checkedAt: Date.now(),
  };
}

function formatBytes(bytes: number): string {
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${Math.round(bytes / 1024 ** 2)} MB`;
}

/* ------------------------------------------------------------------ */
/* Assembly                                                            */
/* ------------------------------------------------------------------ */

async function build(): Promise<Catalog> {
  const config = loadConfig();

  // Every source is asked at once; one slow CLI shouldn't hold up the rest.
  // A harness that isn't installed is not asked: probing an absent binary
  // costs a spawn and a timeout to learn something `hive doctor` already
  // reports, and it would fill the picker with sources that can never answer.
  const enabled = (id: string) =>
    config.harnesses[id as keyof typeof config.harnesses]?.enabled !== false;
  const at = (id: string, fallback: string) =>
    config.harnesses[id as keyof typeof config.harnesses]?.path || fallback;

  const discovered: Array<Promise<CatalogSource> | CatalogSource> = [
    fromClaudeCode(),
    fromOllama(config.localModels?.ollama ?? ""),
    fromLmStudio(config.localModels?.lmstudio ?? ""),
  ];

  if (enabled("opencode")) {
    discovered.push(fromOpenCode(at("opencode", "opencode")));
  }
  if (enabled("pi")) discovered.push(fromPi(at("pi", "pi")));
  if (enabled("cursor-agent")) {
    discovered.push(fromCursorAgent(at("cursor-agent", "cursor-agent")));
  }
  if (enabled("aider")) discovered.push(fromAider(at("aider", "aider")));
  for (const id of Object.keys(STATIC_MODELS)) {
    if (enabled(id)) discovered.push(fromStatic(id));
  }

  const sources = await Promise.all(discovered);

  // What each provider says about its own models, so a harness that only
  // lists names can inherit it. `opencode models` prints
  // "ollama/ornith-1.5:35b" and nothing else; Ollama itself knows that
  // model has vision. Joining the two is the only way the picker can tell.
  const providerVision = new Map<string, boolean>();
  for (const source of sources) {
    if (source.kind !== "provider") continue;
    for (const model of source.models) {
      if (model.vision !== null) providerVision.set(model.model, model.vision);
    }
  }

  const options: Catalog["options"] = [];
  for (const source of sources) {
    if (source.kind !== "harness") continue;
    for (const model of source.models) {
      const vision =
        model.vision ??
        providerVision.get(model.model) ??
        knownVision(model.model);
      options.push({ ...model, vision, harness: source.id });
    }
  }

  const catalog: Catalog = { sources, options, generatedAt: Date.now() };

  log("info", "models", `Model catalog refreshed: ${options.length} options`, {
    context: sources.map((s) => `${s.id}:${s.models.length}`).join(" "),
  });

  return catalog;
}

/** Cached because each refresh spawns three CLIs and hits two HTTP endpoints. */
export async function getCatalog(force = false): Promise<Catalog> {
  if (!force && cached && Date.now() - cached.generatedAt < CACHE_TTL_MS) {
    return cached;
  }
  // Concurrent callers (Settings and Chat both mount at once) share one build.
  if (inFlight) return inFlight;

  inFlight = build()
    .then((catalog) => {
      cached = catalog;
      return catalog;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

/** Resolves a picker id (`harness/provider/model`) back to what to pass a CLI. */
export async function resolveModelRef(
  id: string,
): Promise<{ harness: string; ref: string } | null> {
  if (!id) return null;
  const catalog = await getCatalog();
  const match = catalog.options.find((o) => o.id === id);
  if (match) return { harness: match.harness, ref: match.ref };

  // Unknown to the catalog (a hand-typed id, or a model added since the
  // last refresh) — still usable: the first segment names the harness.
  const [harness, ...rest] = id.split("/");
  if (!harness || rest.length === 0) return null;
  return { harness, ref: rest.join("/") };
}
