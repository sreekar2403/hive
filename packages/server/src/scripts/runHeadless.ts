/**
 * `hive run "<prompt>"` — drive the Orchestrator without the UI or Electron.
 *
 * Runs with the invoker's own cwd (bin/hive.js does *not* force ROOT here,
 * unlike every other mode): the task should operate on whatever git working
 * tree the person is standing in, the same way `git` or `eslint` would.
 * `hive.config.json` is still the checkout's own, found via this file's
 * fixed location rather than cwd.
 *
 * Prints exactly one JSON object to stdout and nothing else, so it composes
 * with `jq`/`&&` in scripts and CI. Progress goes to stderr instead.
 */
import path from "path";
import { loadConfig } from "../config";
import { Orchestrator } from "../orchestrator";
import { registerHarnesses } from "../registerHarnesses";
import { resolveModelRef } from "../models/catalog";

const ROOT = path.resolve(__dirname, "..", "..", "..", "..");

interface RunArgs {
  prompt: string;
  harness?: string;
  model?: string;
  agent?: string;
  yes: boolean;
}

function parseArgs(argv: string[]): RunArgs {
  const promptParts: string[] = [];
  const args: RunArgs = { prompt: "", yes: false };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--harness":
        args.harness = argv[++i];
        break;
      case "--model":
        args.model = argv[++i];
        break;
      case "--agent":
        args.agent = argv[++i];
        break;
      case "-y":
      case "--yes":
        args.yes = true;
        break;
      default:
        promptParts.push(arg);
    }
  }

  args.prompt = promptParts.join(" ").trim();
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (!args.prompt) {
    process.stdout.write(
      JSON.stringify({ status: "failed", error: "No prompt given." }) + "\n",
    );
    process.exit(1);
  }

  const config = loadConfig(path.join(ROOT, "hive.config.json"));

  // `--yes` is the CI/scripting escape hatch: a headless run has nobody to
  // answer the approval dialog, and the gate would otherwise just eat the
  // full timeout and fail every destructive command. Same trust model as
  // passing --yes to apt/npm — the caller is asserting this run is trusted.
  if (args.yes) config.permission.enabled = false;

  const harnesses = await registerHarnesses(config, (line) =>
    console.error(line),
  );

  if (harnesses.size === 0) {
    process.stdout.write(
      JSON.stringify({
        status: "failed",
        error:
          "No harnesses available. Run `hive doctor` to see what this machine is missing.",
      }) + "\n",
    );
    process.exit(1);
  }

  if (args.harness && !harnesses.has(args.harness)) {
    process.stdout.write(
      JSON.stringify({
        status: "failed",
        error: `Harness "${args.harness}" is not available. Installed: ${Array.from(harnesses.keys()).join(", ")}`,
      }) + "\n",
    );
    process.exit(1);
  }

  const picked = args.model ? await resolveModelRef(args.model) : null;
  const chosenHarness = args.harness ?? picked?.harness;

  const orchestrator = new Orchestrator(config, harnesses);
  const sessionId = `headless-${Date.now()}`;

  try {
    const task = await orchestrator.createTask(
      sessionId,
      args.prompt,
      chosenHarness,
      null,
      {
        model: picked?.ref ?? null,
        agent: args.agent ?? null,
      },
    );

    const result = await orchestrator.executeTask(task.id);

    process.stdout.write(
      JSON.stringify({
        status: result.status,
        output: result.output,
        harness: result.harness,
        model: result.model,
        iterations: result.iteration ?? null,
        filesChanged: result.filesChanged,
        error: result.error ?? null,
      }) + "\n",
    );
    process.exit(result.status === "completed" ? 0 : 1);
  } catch (err) {
    process.stdout.write(
      JSON.stringify({
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
      }) + "\n",
    );
    process.exit(1);
  }
}

void main();
