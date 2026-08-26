import { Config, loadConfig } from "./config";
import { HiveServer } from "./server";
import { OpenCodeHarness, ClaudeCodeHarness, PiHarness } from "./harnesses";
import { OllamaDirectHarness } from "./harnesses/ollamaDirect";
import { LMStudioDirectHarness } from "./harnesses/lmstudioDirect";

async function main() {
  // Load configuration (defaults, layered with hive.config.json and PORT env var)
  const config: Config = loadConfig();

  // Initialize harnesses
  const harnesses = new Map<string, any>();

  // Registration is deliberately cheap: each isAvailable() is a `--version`
  // spawn with a short timeout. Deep event-stream validation happens per run
  // (see runHarness's unparseable-stream detection), never at boot — running
  // a real prompt through every CLI here would cost tokens and minutes.
  const opencodeHarness = new OpenCodeHarness();
  if (await opencodeHarness.isAvailable()) {
    harnesses.set("opencode", opencodeHarness);
    console.log("OpenCode harness available");
  }

  const claudeHarness = new ClaudeCodeHarness();
  if (await claudeHarness.isAvailable()) {
    harnesses.set("claude-code", claudeHarness);
    console.log("Claude Code harness available");
  }

  const piHarness = new PiHarness();
  if (await piHarness.isAvailable()) {
    harnesses.set("pi", piHarness);
    console.log("Pi harness available");
  }

  // Direct API harnesses for local model servers
  const ollamaDirectHarness = new OllamaDirectHarness(config.localModels?.ollama || "http://localhost:11434");
  if (await ollamaDirectHarness.isAvailable()) {
    harnesses.set("ollama-direct", ollamaDirectHarness);
    console.log("Ollama Direct harness available");
  }

  const lmstudioDirectHarness = new LMStudioDirectHarness(config.localModels?.lmstudio || "http://localhost:1234");
  if (await lmstudioDirectHarness.isAvailable()) {
    harnesses.set("lmstudio-direct", lmstudioDirectHarness);
    console.log("LM Studio Direct harness available");
  }

  if (harnesses.size === 0) {
    console.error(
      "No harnesses available. Please install opencode, claude-code, or pi.",
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
