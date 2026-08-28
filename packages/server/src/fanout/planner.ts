import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import { Harness } from "@hive/shared/harness";
import { extractJsonObject } from "../llmJson";
import { log } from "../telemetry";

/**
 * Deciding whether one request is really several, and splitting it.
 *
 * This is the difference between Hive running "a task" and Hive running a
 * team. "Read the PRD and write a frontend and a backend PRD" is two pieces
 * of work that do not need each other; handing both to one agent in one
 * pass gets a worse answer than handing each to its own agent and stitching
 * the results together.
 *
 * The split is deliberately conservative. Fanning out costs N agent runs
 * and N worktrees, and a wrongly-split task produces N confident answers to
 * questions nobody asked. So the planner must *earn* the fan-out: it
 * declines by default, and every guard below turns an unclear answer into
 * "just run it normally" rather than into a guess.
 */

export interface SubTask {
  /** Short label — used for the branch name and shown in the trail. */
  title: string;
  /** The full instruction handed to that sub-agent. */
  prompt: string;
  /** Harness the planner wants for this piece; routing decides if absent. */
  harness?: string;
}

export interface FanoutPlan {
  subtasks: SubTask[];
  reasoning: string;
}

/** Hard ceiling regardless of config: a plan is a plan, not a swarm. */
export const MAX_SUBTASKS = 6;

export interface PlannerContext {
  harness: Harness;
  /** Model in the CLI's own notation. */
  model?: string;
  /** Harness ids a sub-task may name. */
  available: string[];
  conversationHistory?: Array<{ role: string; content: string }>;
  maxSubtasks?: number;
  timeoutMs?: number;
}

/**
 * Phrases where the user has already answered the question themselves.
 *
 * When someone writes "use subagents" or "in parallel", declining to fan
 * out is not caution, it is ignoring them — so these lower the bar rather
 * than raise it. They never *force* a split: the planner still has to come
 * back with more than one genuinely separable piece.
 */
const EXPLICIT_REQUEST =
  /\b(sub-?agents?|in parallel|parallel(?:ly|ise|ize)?|concurrently|simultaneously|at the same time|split (?:this|it) (?:up|into)|separate agents?|multiple agents?|fan[- ]?out)\b/i;

export function asksForFanout(prompt: string): boolean {
  return EXPLICIT_REQUEST.test(prompt);
}

export async function planFanout(
  prompt: string,
  ctx: PlannerContext,
): Promise<FanoutPlan | null> {
  const ceiling = Math.min(ctx.maxSubtasks ?? 4, MAX_SUBTASKS);
  if (ceiling < 2) return null;

  const explicit = asksForFanout(prompt);

  let output: string;
  try {
    const result = await ctx.harness.execute(
      buildPlanningPrompt(prompt, ctx, ceiling, explicit),
      {
        model: ctx.model,
        timeout: ctx.timeoutMs ?? 120000,
        // Planning must never touch the working tree — the sub-agents are
        // the ones with a mandate to change files. Same reasoning as the
        // router's scratch dir, and the same consequence if it were
        // skipped: a planner that "helpfully" started the work would do it
        // unisolated, before any of the gates below had run.
        cwd: planningScratchDir(),
      },
    );
    if (!result.success || !result.output) return null;
    output = result.output;
  } catch {
    return null;
  }

  return parsePlan(output, ctx.available, ceiling, explicit);
}

/**
 * Turns the planner's answer into a plan, or into nothing.
 *
 * Exported for tests, which is worth saying plainly: this function is where
 * every "should we really fan out" judgement lives, and those are cheap to
 * test here and expensive to test through a live model.
 */
export function parsePlan(
  output: string,
  available: string[],
  requestedCeiling: number,
  explicit = false,
): FanoutPlan | null {
  // Clamped here rather than only at the call site, so the hard cap holds
  // however this is reached — a config value, a test, a future caller.
  const ceiling = Math.min(requestedCeiling, MAX_SUBTASKS);

  const json = extractJsonObject(output);
  if (!json) return null;

  // An explicit `parallel: false` is the planner using its veto, which is
  // the outcome we want it to be comfortable reaching for.
  if (json.parallel === false) return null;

  const raw = Array.isArray(json.subtasks) ? json.subtasks : [];
  const subtasks: SubTask[] = [];

  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const promptText =
      typeof record.prompt === "string" ? record.prompt.trim() : "";
    if (!promptText) continue;

    const title =
      typeof record.title === "string" && record.title.trim()
        ? record.title.trim().slice(0, 80)
        : promptText.slice(0, 60);

    // A harness the planner invented would fail the run at spawn time; the
    // task still makes sense without it, so drop the field, not the task.
    const named =
      typeof record.harness === "string" ? record.harness.trim() : "";
    const harness = named && available.includes(named) ? named : undefined;

    subtasks.push({ title, prompt: promptText, harness });
  }

  // One sub-task is not a fan-out — it is the normal path with extra steps,
  // and running it through the parallel machinery would cost a worktree and
  // a merge to arrive exactly where the plain path arrives.
  if (subtasks.length < 2) return null;

  // Over the ceiling is a planner that has started listing steps rather
  // than separating work. Truncating would keep the first few steps of a
  // sequence and silently drop the rest, so decline instead — unless the
  // user asked for this, in which case take what fits.
  if (subtasks.length > ceiling) {
    if (!explicit) {
      log(
        "info",
        "fanout",
        `Planner proposed ${subtasks.length} subtasks (max ${ceiling}); running normally`,
      );
      return null;
    }
    subtasks.length = ceiling;
  }

  // Near-identical prompts mean the split was cosmetic. Running them in
  // parallel produces N answers to one question and a merge conflict.
  if (hasDuplicates(subtasks)) {
    log(
      "info",
      "fanout",
      "Planner's subtasks overlap too much; running normally",
    );
    return null;
  }

  return {
    subtasks,
    reasoning: typeof json.reasoning === "string" ? json.reasoning.trim() : "",
  };
}

/**
 * Whether two sub-tasks are really the same instruction.
 *
 * Word overlap rather than string equality: a planner that splits "write
 * the PRD" into "write the PRD" and "write the PRD document" has not split
 * anything, and those are not equal strings.
 */
function hasDuplicates(subtasks: SubTask[]): boolean {
  const sets = subtasks.map(
    (task) =>
      new Set(
        task.prompt
          .toLowerCase()
          .split(/[^a-z0-9]+/)
          .filter((word) => word.length > 3),
      ),
  );

  for (let i = 0; i < sets.length; i++) {
    for (let j = i + 1; j < sets.length; j++) {
      const a = sets[i];
      const b = sets[j];
      if (a.size === 0 || b.size === 0) continue;
      let shared = 0;
      for (const word of a) if (b.has(word)) shared++;
      const overlap = shared / Math.min(a.size, b.size);
      if (overlap > 0.85) return true;
    }
  }
  return false;
}

function buildPlanningPrompt(
  prompt: string,
  ctx: PlannerContext,
  ceiling: number,
  explicit: boolean,
): string {
  const sections: string[] = [];

  sections.push(
    "You are a dispatcher. Decide whether the request below is ONE piece of work or SEVERAL independent pieces that could be done at the same time by different agents.",
    "",
    "Split it ONLY when every piece is true of the following:",
    "  - it can be completed without waiting for any other piece",
    "  - it writes to different files than the other pieces",
    '  - it is a real deliverable, not a step ("plan it", then "do it" is ONE piece)',
    "",
    "If the request is one piece of work, say so. That is the common answer and it is not a failure.",
  );

  if (explicit) {
    sections.push(
      "",
      "The user explicitly asked for parallel sub-agents, so split it if there is any reasonable way to. Only refuse if the work is genuinely sequential.",
    );
  }

  if (ctx.available.length > 0) {
    sections.push(
      "",
      `You may name a harness for a piece from: ${ctx.available.join(", ")}. Omit the field to let routing choose.`,
    );
  }

  if (ctx.conversationHistory?.length) {
    sections.push("", "=== Conversation so far ===");
    for (const message of ctx.conversationHistory.slice(-6)) {
      sections.push(`${message.role}: ${message.content}`);
    }
    sections.push("=== End conversation ===");
  }

  sections.push(
    "",
    "=== Request ===",
    prompt,
    "=== End request ===",
    "",
    `Answer with JSON only, at most ${ceiling} subtasks:`,
    '{"parallel": true, "reasoning": "...", "subtasks": [{"title": "short label", "prompt": "the full self-contained instruction for this agent", "harness": "optional"}]}',
    "",
    "Each subtask prompt must stand alone: the agent running it sees only that prompt, not this conversation. Repeat any file path or requirement it needs.",
    'For one piece of work answer exactly: {"parallel": false, "reasoning": "..."}',
  );

  return sections.join("\n");
}

let scratchDir: string | null = null;

/** Mirrors the router's scratch dir; see the cwd comment in planFanout. */
function planningScratchDir(): string {
  if (scratchDir) return scratchDir;
  const dir = path.join(os.tmpdir(), "hive-planner");
  try {
    fs.mkdirSync(dir, { recursive: true });
    scratchDir = dir;
  } catch {
    scratchDir = os.tmpdir();
  }
  return scratchDir;
}
