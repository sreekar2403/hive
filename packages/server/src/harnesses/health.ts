import { probeAvailable, probeHarnessHealth } from "./runner";
import {
  ClaudeCodeParser,
  OpenCodeParser,
  PiParser,
  type StreamParser,
} from "./eventStream";
import type { Config } from "../config";

/**
 * Does each CLI still speak the event stream we parse?
 *
 * Hive's whole read of what an agent is doing comes from parsing a CLI's
 * structured output. That is an unversioned contract with a tool that
 * updates on its own schedule, so it needs checking rather than assuming:
 * `--version` succeeding says the binary is there, not that
 * `--output-format stream-json` still emits what `eventStream.ts` expects.
 *
 * The shallow check is cheap (spawn `--version`). The deep check runs a real
 * one-word prompt and asserts events actually parse out of it, which costs a
 * model call — so it is always explicit: `hive doctor --deep`, or the
 * Settings screen's re-check button.
 */

export interface HarnessProbe {
  harness: string;
  command: string;
  installed: boolean;
  /** Only set when a deep check ran. */
  streamOk?: boolean;
  eventsParsed?: number;
  error?: string;
}

interface HarnessSpec {
  harness: string;
  command: string;
  /** Args before the prompt, matching what the harness itself sends. */
  args: string[];
  parser: () => StreamParser;
}

/**
 * Kept beside each harness's `execute()` on purpose: if the flags there
 * change, the probe has to change with them or it stops checking the thing
 * that actually runs.
 */
export function harnessSpecs(config?: Config): HarnessSpec[] {
  const path = (id: string, fallback: string) =>
    config?.harnesses?.[id as keyof Config["harnesses"]]?.path || fallback;

  return [
    {
      harness: "opencode",
      command: path("opencode", "opencode"),
      args: ["run", "--pure", "--format", "json", "--thinking"],
      parser: () => new OpenCodeParser(),
    },
    {
      harness: "claude-code",
      command: path("claude-code", "claude"),
      args: ["-p", "--output-format", "stream-json", "--verbose"],
      parser: () => new ClaudeCodeParser(),
    },
    {
      harness: "pi",
      command: path("pi", "pi"),
      args: ["-p", "--mode", "json"],
      parser: () => new PiParser(),
    },
  ];
}

/** Which CLIs are installed. Cheap enough to run on demand. */
export async function checkInstalled(config?: Config): Promise<HarnessProbe[]> {
  return Promise.all(
    harnessSpecs(config).map(async (spec) => ({
      harness: spec.harness,
      command: spec.command,
      installed: await probeAvailable(spec.command),
    })),
  );
}

/**
 * Installed *and* still parseable. Runs one real prompt per installed CLI;
 * missing ones are reported as missing rather than probed.
 */
export async function checkStreamContracts(
  config?: Config,
  cwd = process.cwd(),
): Promise<HarnessProbe[]> {
  const specs = harnessSpecs(config);
  const results: HarnessProbe[] = [];

  // Sequential on purpose: these are real model calls, and running three
  // CLIs at once on a laptop is exactly what the capacity limit exists to
  // prevent.
  for (const spec of specs) {
    const installed = await probeAvailable(spec.command);
    if (!installed) {
      results.push({
        harness: spec.harness,
        command: spec.command,
        installed: false,
      });
      continue;
    }
    const health = await probeHarnessHealth(
      spec.command,
      spec.args,
      spec.parser(),
      "Reply with exactly: ok",
      cwd,
      // A cold model — a local one especially — can take most of a minute
      // to answer its first prompt. Being slow is not the same as having
      // changed its output format.
      60000,
    );
    results.push({
      harness: spec.harness,
      command: spec.command,
      installed: true,
      streamOk: health.healthy,
      eventsParsed: health.eventsParsed,
      error: health.error,
    });
  }

  return results;
}
