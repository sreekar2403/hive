import { Config, HarnessId } from "./config";
import type { Harness } from "@hive/shared/harness";
import {
  OpenCodeHarness,
  ClaudeCodeHarness,
  PiHarness,
  CodexHarness,
  GeminiHarness,
  QwenHarness,
  CursorAgentHarness,
  AiderHarness,
  AmpHarness,
  GooseHarness,
  CrushHarness,
  CopilotHarness,
  OllamaDirectHarness,
  LMStudioDirectHarness,
} from "./harnesses";
import { harnessProfile } from "./harnesses/profiles";
import { syncHarnessAvailability } from "./setup";

/**
 * Every CLI harness, built from config so a custom binary path is honoured.
 *
 * One table rather than a block of near-identical `if (await x.isAvailable())`
 * stanzas: with a dozen CLIs supported, the repetitive version is where a
 * newly added harness gets forgotten.
 */
function cliHarnesses(config: Config): Array<[HarnessId, Harness]> {
  const at = (id: HarnessId) =>
    config.harnesses[id]?.path || harnessProfile(id).command;
  const model = (id: HarnessId) => config.harnesses[id]?.defaultModel || "";

  return [
    ["opencode", new OpenCodeHarness(at("opencode"), model("opencode"))],
    [
      "claude-code",
      new ClaudeCodeHarness(at("claude-code"), model("claude-code")),
    ],
    ["pi", new PiHarness(at("pi"), model("pi"))],
    ["codex", new CodexHarness(at("codex"), model("codex"))],
    ["gemini", new GeminiHarness(at("gemini"), model("gemini"))],
    ["qwen", new QwenHarness(at("qwen"), model("qwen"))],
    [
      "cursor-agent",
      new CursorAgentHarness(at("cursor-agent"), model("cursor-agent")),
    ],
    ["aider", new AiderHarness(at("aider"), model("aider"))],
    ["amp", new AmpHarness(at("amp"), model("amp"))],
    ["goose", new GooseHarness(at("goose"), model("goose"))],
    ["crush", new CrushHarness(at("crush"), model("crush"))],
    ["copilot", new CopilotHarness(at("copilot"), model("copilot"))],
  ];
}

/**
 * Probes every CLI harness plus the local-model direct harnesses and returns
 * the ones actually usable on this machine. Shared by the server's startup
 * (`index.ts`) and the headless `hive run` path so the two never drift on
 * what "available" means.
 *
 * `log`, when passed, receives one line per harness found — index.ts wants
 * those on stdout, the headless script wants them on stderr (so stdout stays
 * clean JSON), and callers that don't care can omit it.
 */
export async function registerHarnesses(
  config: Config,
  log?: (line: string) => void,
): Promise<Map<string, Harness>> {
  const harnesses = new Map<string, Harness>();

  // Registration is deliberately cheap: each isAvailable() is a `--version`
  // spawn with a short timeout. Deep event-stream validation happens per run
  // (see runHarness's unparseable-stream detection), never at boot.
  //
  // Every harness is probed, including the ones config says are disabled.
  // `enabled` is a preference about what *should* run; this is a fact about
  // what *can*, and the two are reconciled below rather than conflated.
  //
  // Probed in parallel: a dozen sequential 3-second timeouts would be most of
  // a minute of startup on a machine that has none of them installed.
  const probes = await Promise.all(
    cliHarnesses(config).map(async ([id, harness]) => {
      try {
        return [id, harness, await harness.isAvailable()] as const;
      } catch {
        return [id, harness, false] as const;
      }
    }),
  );

  const installed = probes.filter(([, , ok]) => ok).map(([id]) => id);

  // Anything not installed is forced off, so Settings and the routing table
  // never offer an agent that cannot run.
  syncHarnessAvailability(config, installed, {
    enableInstalled: !config.setup?.completed,
    persist: true,
  });

  for (const [id, harness, available] of probes) {
    if (!available) continue;
    harnesses.set(id, harness);
    const state = config.harnesses[id]?.enabled ? "enabled" : "installed, off";
    log?.(`${harnessProfile(id).label} harness available (${state})`);
  }

  // Direct API harnesses for local model servers. Not CLIs: these speak HTTP
  // to a server on this machine, which is why they are registered separately
  // and are not in the routing table's harness list.
  const ollamaDirectHarness = new OllamaDirectHarness(
    config.localModels?.ollama || "http://localhost:11434",
  );
  if (await ollamaDirectHarness.isAvailable()) {
    harnesses.set("ollama-direct", ollamaDirectHarness);
    log?.("Ollama Direct harness available");
  }

  const lmstudioDirectHarness = new LMStudioDirectHarness(
    config.localModels?.lmstudio || "http://localhost:1234",
  );
  if (await lmstudioDirectHarness.isAvailable()) {
    harnesses.set("lmstudio-direct", lmstudioDirectHarness);
    log?.("LM Studio Direct harness available");
  }

  return harnesses;
}
