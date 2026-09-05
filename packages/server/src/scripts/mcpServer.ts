/**
 * Exposes Hive over MCP (stdio transport) so an MCP client — Claude Desktop,
 * Claude Code, any IDE that speaks MCP — can dispatch a task without
 * adopting the chat UI at all.
 *
 * `hive_run` shells out to the exact `runHeadless.ts` path `hive run` uses,
 * one subprocess per call, rather than driving an in-process Orchestrator:
 * the Orchestrator assumes one working tree per process (`workingTreeFor`
 * falls back to `process.cwd()`, and `Orchestrator.active` is a process-wide
 * singleton), but an MCP client can ask this one long-lived server to touch
 * a different repo on every call. A subprocess per call gets a real,
 * independent cwd for each, and it's the same code path already exercised
 * by `hive run` directly.
 *
 * Every stdout byte here is JSON-RPC — nothing may `console.log`. Anything
 * for a human goes to stderr.
 */
import path from "path";
import fs from "fs";
import { spawn } from "child_process";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "../config";
import { registerHarnesses } from "../registerHarnesses";

const ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const TSX = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
const HEADLESS_SCRIPT = path.join(
  ROOT,
  "packages",
  "server",
  "src",
  "scripts",
  "runHeadless.ts",
);

/** Runs one task through the same path `hive run` uses, in the given cwd. */
function runHeadlessTask(
  cwd: string,
  args: {
    prompt: string;
    harness?: string;
    model?: string;
    agent?: string;
    yes?: boolean;
  },
): Promise<{ code: number; stdout: string; stderr: string }> {
  const flags: string[] = [];
  if (args.harness) flags.push("--harness", args.harness);
  if (args.model) flags.push("--model", args.model);
  if (args.agent) flags.push("--agent", args.agent);
  if (args.yes) flags.push("--yes");

  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [TSX, HEADLESS_SCRIPT, args.prompt, ...flags],
      { cwd, stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c.toString()));
    child.stderr.on("data", (c) => (stderr += c.toString()));
    child.on("error", (err) =>
      resolve({ code: 1, stdout: "", stderr: err.message }),
    );
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

function textResult(text: string, isError = false) {
  return { content: [{ type: "text" as const, text }], isError };
}

/** A directory the task can actually run in: exists, and is a directory. */
function resolveCwd(requested: string | undefined): string | null {
  const target = requested ? path.resolve(requested) : process.cwd();
  try {
    if (!fs.statSync(target).isDirectory()) return null;
  } catch {
    return null;
  }
  return target;
}

async function main(): Promise<void> {
  const server = new McpServer({ name: "hive", version: "0.1.0" });

  server.registerTool(
    "hive_run",
    {
      title: "Run a Hive task",
      description:
        "Dispatches one prompt to a Hive-managed AI coding agent (Claude Code, " +
        "opencode, Codex, Gemini, and others) against a git working tree. " +
        "The agent has shell and git access to that repo and can create, edit, " +
        "and delete files and run commands there — treat it like handing the " +
        "task to a capable but unsupervised engineer. Runs to completion " +
        "(may take minutes) and returns the final result as JSON: status, " +
        "output, harness used, filesChanged, and error if any.",
      inputSchema: {
        prompt: z
          .string()
          .min(1)
          .describe("The task to run, in plain language."),
        cwd: z
          .string()
          .optional()
          .describe(
            "Absolute path to the git repo to run against. Defaults to wherever this MCP server process was started.",
          ),
        harness: z
          .string()
          .optional()
          .describe(
            "Pin a specific harness instead of letting Hive route (e.g. claude-code, opencode, codex, gemini).",
          ),
        model: z
          .string()
          .optional()
          .describe("Pin a model — catalog id or the harness's own model ref."),
        agent: z
          .string()
          .optional()
          .describe("Agent/persona name, where the harness supports one."),
        yes: z
          .boolean()
          .optional()
          .describe(
            "Skip Hive's destructive-command approval gate. There is no human to ask over MCP, so a run that hits a guarded command (rm, force-push, ...) without this will simply time out and fail. Only set this for a repo/task you trust.",
          ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: true,
      },
    },
    async ({ prompt, cwd, harness, model, agent, yes }) => {
      const target = resolveCwd(cwd);
      if (!target) {
        return textResult(
          `"${cwd}" is not a directory Hive can see. Pass an absolute path to an existing git working tree.`,
          true,
        );
      }

      const { code, stdout, stderr } = await runHeadlessTask(target, {
        prompt,
        harness,
        model,
        agent,
        yes,
      });

      // runHeadless.ts prints exactly one JSON line on success; a crash
      // before it gets there leaves stdout empty and the reason on stderr.
      const line = stdout.trim().split(/\r?\n/).filter(Boolean).pop();
      if (!line) {
        return textResult(
          `The task did not complete: ${stderr.trim().slice(0, 500) || `exit code ${code}`}`,
          true,
        );
      }
      return textResult(line, code !== 0);
    },
  );

  server.registerTool(
    "hive_list_harnesses",
    {
      title: "List available Hive harnesses",
      description:
        "Lists the AI coding CLIs (harnesses) installed and enabled on this " +
        "machine — what hive_run can route a task to.",
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const config = loadConfig(path.join(ROOT, "hive.config.json"));
      const harnesses = await registerHarnesses(config);
      const rows = Array.from(harnesses.keys()).map((id) => ({
        id,
        enabled:
          config.harnesses[id as keyof typeof config.harnesses]?.enabled ??
          true,
      }));
      return textResult(JSON.stringify(rows));
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("hive mcp server failed to start:", err);
  process.exit(1);
});
