import { Config, HarnessId, loadConfig } from "./config";
import { HiveServer } from "./server";
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

async function main() {
  // Load configuration (defaults, layered with hive.config.json and PORT env var)
  const config: Config = loadConfig();

  const harnesses = new Map<string, Harness>();

  // Registration is deliberately cheap: each isAvailable() is a `--version`
  // spawn with a short timeout. Deep event-stream validation happens per run
  // (see runHarness's unparseable-stream detection), never at boot — running
  // a real prompt through every CLI here would cost tokens and minutes.
  //
  // Every harness is probed, including the ones config says are disabled.
  // `enabled` is a preference about what *should* run; this is a fact about
  // what *can*, and the two are reconciled below rather than conflated —
  // without the probe, a harness disabled once could never be seen again.
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
  // never offer an agent that cannot run. On a machine that has not been set
  // up yet, everything installed is switched on so Hive works immediately;
  // after setup, an installed-but-off harness is the user's decision.
  syncHarnessAvailability(config, installed, {
    enableInstalled: !config.setup?.completed,
    persist: true,
  });

  for (const [id, harness, available] of probes) {
    if (!available) continue;
    harnesses.set(id, harness);
    const state = config.harnesses[id]?.enabled ? "enabled" : "installed, off";
    console.log(`${harnessProfile(id).label} harness available (${state})`);
  }

  // Direct API harnesses for local model servers. Not CLIs: these speak HTTP
  // to a server on this machine, which is why they are registered separately
  // and are not in the routing table's harness list.
  const ollamaDirectHarness = new OllamaDirectHarness(
    config.localModels?.ollama || "http://localhost:11434",
  );
  if (await ollamaDirectHarness.isAvailable()) {
    harnesses.set("ollama-direct", ollamaDirectHarness);
    console.log("Ollama Direct harness available");
  }

  const lmstudioDirectHarness = new LMStudioDirectHarness(
    config.localModels?.lmstudio || "http://localhost:1234",
  );
  if (await lmstudioDirectHarness.isAvailable()) {
    harnesses.set("lmstudio-direct", lmstudioDirectHarness);
    console.log("LM Studio Direct harness available");
  }

  if (harnesses.size === 0) {
    console.error(
      "No harnesses available. Install at least one agent CLI — opencode, " +
        "claude, codex, gemini, cursor-agent, pi, aider, amp, goose, crush " +
        "or copilot — and run `hive doctor` to check what this machine sees.",
    );
    process.exit(1);
  }

  // Start server
  const server = new HiveServer(config, harnesses);
  await server.start();

  console.log(
    `Hive started with ${harnesses.size} harnesses: ${Array.from(harnesses.keys()).join(", ")}`,
  );

  // Graceful shutdown
  process.on("SIGINT", () => {
    console.log("Shutting down...");
    server.stop();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    console.log("Shutting down...");
    server.stop();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("Failed to start Hive:", err);
  process.exit(1);
});
