/**
 * The deep harness check, runnable without a server.
 *
 * `hive doctor --deep` spawns this with tsx and reads one JSON object off
 * stdout. Doing it here rather than in bin/hive.js keeps the CLI flag list
 * and the parsers in the same place: the check has to use the exact args
 * each harness sends, and those live in TypeScript beside the parsers.
 */
import { checkStreamContracts } from "../harnesses/health";
import { loadConfig } from "../config";

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch {
    config = undefined;
  }

  try {
    const probes = await checkStreamContracts(config, process.cwd());
    process.stdout.write(
      JSON.stringify({
        probes,
        healthy: probes.every((p) => !p.installed || p.streamOk),
      }) + "\n",
    );
    // A CLI whose stream no longer parses is a real failure — the exit code
    // is what a CI check or a shell `&&` will act on.
    process.exit(probes.some((p) => p.installed && !p.streamOk) ? 1 : 0);
  } catch (err) {
    process.stdout.write(
      JSON.stringify({
        probes: [],
        healthy: false,
        error: err instanceof Error ? err.message : String(err),
      }) + "\n",
    );
    process.exit(1);
  }
}

void main();
