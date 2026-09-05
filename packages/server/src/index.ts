import { Config, loadConfig } from "./config";
import { HiveServer } from "./server";
import { registerHarnesses } from "./registerHarnesses";

async function main() {
  // Load configuration (defaults, layered with hive.config.json and PORT env var)
  const config: Config = loadConfig();

  // On a machine that has not been set up yet, everything installed is
  // switched on so Hive works immediately; after setup, an installed-but-off
  // harness is the user's decision (see syncHarnessAvailability inside).
  const harnesses = await registerHarnesses(config, (line) =>
    console.log(line),
  );

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
