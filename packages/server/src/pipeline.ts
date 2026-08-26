import { execSync } from "child_process";
import fs from "fs";
import path from "path";

/**
 * The staged loop: plan → implement → test → review → ship.
 *
 * The retry loop in loopEngine.ts asks one question — did the CLI exit
 * zero? — and a harness that confidently does the wrong thing exits zero.
 * This module is the other half: it splits a task into stages, and puts a
 * gate after each one that can send the work back rather than forward.
 *
 * Three rules shape it:
 *
 *   - **A gate that cannot fail is not a gate.** Every stage returns a
 *     verdict with a reason, and "no evidence" is a failure, not a pass:
 *     an implement stage that changed no files did not implement anything.
 *   - **Going back is bounded.** Test failures return to implement at most
 *     `maxRepairs` times, then the run stops and says why. An agent that
 *     can loop forever will.
 *   - **The stages are advisory to the harness, authoritative to us.** The
 *     harness is asked to plan, or to fix a failing test; whether that
 *     worked is decided here, from the working tree and the test command,
 *     not from the harness's own account of itself.
 *
 * Stage execution is injected (`runStage`) so this file has no opinion about
 * harnesses and stays testable without spawning a CLI.
 */

export type StageName = "plan" | "implement" | "test" | "review" | "ship";

export type Verdict = "passed" | "failed" | "skipped";

export interface StageResult {
  stage: StageName;
  verdict: Verdict;
  /** Why — always populated, and shown to the user on a failure. */
  reason: string;
  output: string;
  filesChanged: string[];
  durationMs: number;
}

export interface PipelineResult {
  success: boolean;
  stages: StageResult[];
  /** The stage that stopped the run, when one did. */
  stoppedAt: StageName | null;
  reason: string;
  filesChanged: string[];
  output: string;
}

/** What the pipeline asks of the outside world. */
export interface StageRunner {
  /**
   * Runs one stage's prompt through a harness. Resolves with whatever the
   * harness produced; a non-zero exit is `success: false`, not a throw.
   */
  (input: { stage: StageName; prompt: string; attempt: number }): Promise<{
    success: boolean;
    output: string;
    filesChanged?: string[];
    stderr?: string;
  }>;
}

export interface PipelineOptions {
  /** The working tree. Test detection and git checks are relative to it. */
  cwd: string;
  /** How many times a failing test stage may send work back to implement. */
  maxRepairs?: number;
  /** Skip the plan stage for small, obviously-scoped work. */
  plan?: boolean;
  /**
   * Command that runs the project's tests. When omitted it is detected from
   * the working tree; when detection finds nothing, the test stage is
   * skipped rather than faked.
   */
  testCommand?: string | null;
  /** Runs a shell command in `cwd`. Injected so tests don't spawn anything. */
  exec?: (command: string, cwd: string) => { ok: boolean; output: string };
  /** Reports progress as stages start and finish. */
  onStage?: (
    stage: StageName,
    phase: "start" | "end",
    result?: StageResult,
  ) => void;
  /**
   * Optional second opinion on the diff. Returning `null` means "no view",
   * which is not a failure — the heuristic gate still applies.
   */
  judge?: (input: {
    prompt: string;
    diff: string;
    output: string;
  }) => Promise<{ approved: boolean; reason: string } | null>;
}

const DEFAULT_MAX_REPAIRS = 2;

/* ------------------------------------------------------------------ */
/* Test command detection                                              */
/* ------------------------------------------------------------------ */

/**
 * The project's own test command, or null when it has none.
 *
 * Guessing wrong is worse than not guessing: a made-up command fails for
 * reasons that have nothing to do with the change, and the pipeline would
 * blame the agent for it.
 */
export function detectTestCommand(cwd: string): string | null {
  const pkgPath = path.join(cwd, "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
        scripts?: Record<string, string>;
      };
      const script = pkg.scripts?.test;
      // `npm init` writes a placeholder test script that always fails.
      if (script && !/no test specified/i.test(script)) {
        const manager = fs.existsSync(path.join(cwd, "pnpm-lock.yaml"))
          ? "pnpm"
          : fs.existsSync(path.join(cwd, "yarn.lock"))
            ? "yarn"
            : "npm";
        return `${manager} test`;
      }
    } catch {
      // An unreadable package.json is not a test command.
    }
  }
  if (fs.existsSync(path.join(cwd, "Cargo.toml"))) return "cargo test";
  if (fs.existsSync(path.join(cwd, "go.mod"))) return "go test ./...";
  if (
    fs.existsSync(path.join(cwd, "pytest.ini")) ||
    fs.existsSync(path.join(cwd, "pyproject.toml"))
  ) {
    return "pytest";
  }
  return null;
}

function defaultExec(
  command: string,
  cwd: string,
): { ok: boolean; output: string } {
  try {
    const output = execSync(command, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 10 * 60 * 1000,
    });
    return { ok: true, output };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return {
      ok: false,
      output: `${e.stdout ?? ""}${e.stderr ?? ""}` || e.message || "failed",
    };
  }
}

/* ------------------------------------------------------------------ */
/* Review heuristics                                                   */
/* ------------------------------------------------------------------ */

/**
 * Cheap, high-confidence checks on a diff. These catch the failures that
 * are unambiguous from the text alone — anything subtler is the judge's
 * job, or a human's.
 */
export function reviewDiff(diff: string): {
  approved: boolean;
  reason: string;
} {
  const added = diff
    .split(/\r?\n/)
    .filter((line) => line.startsWith("+") && !line.startsWith("+++"));

  const conflict = added.find((line) => /^\+(<{7}|={7}|>{7})(\s|$)/.test(line));
  if (conflict) {
    return {
      approved: false,
      reason: "The diff still contains merge conflict markers.",
    };
  }

  const marker = added.find((line) => /\b(FIXME|XXX)\b/.test(line));
  if (marker) {
    return {
      approved: false,
      reason: `A FIXME/XXX marker was left in the change: ${marker.trim().slice(0, 80)}`,
    };
  }

  const debugger_ = added.find((line) => /^\+\s*debugger\s*;?\s*$/.test(line));
  if (debugger_) {
    return {
      approved: false,
      reason: "A `debugger` statement was left in the change.",
    };
  }

  const skipped = added.find((line) =>
    /\b(it|test|describe)\.(skip|only)\s*\(/.test(line),
  );
  if (skipped) {
    return {
      approved: false,
      reason: `A test was left focused or skipped: ${skipped.trim().slice(0, 80)}`,
    };
  }

  return { approved: true, reason: "No blocking issues found in the diff." };
}

/* ------------------------------------------------------------------ */
/* Prompts                                                             */
/* ------------------------------------------------------------------ */

function planPrompt(task: string): string {
  return [
    "Plan this task before changing anything. Do not edit files yet.",
    "List the files you expect to touch and the steps, in at most 10 lines.",
    "",
    "Task:",
    task,
  ].join("\n");
}

function implementPrompt(task: string, plan: string): string {
  const parts = ["Implement this task. Make the edits."];
  if (plan.trim()) {
    parts.push("", "The plan you produced:", plan.trim());
  }
  parts.push("", "Task:", task);
  return parts.join("\n");
}

function repairPrompt(task: string, testOutput: string): string {
  return [
    "The tests fail after your change. Fix the cause, not the test.",
    "If the test itself is wrong, say so explicitly and explain why.",
    "",
    "Test output:",
    testOutput.slice(-4000),
    "",
    "Original task:",
    task,
  ].join("\n");
}

function reviewPrompt(task: string, diff: string): string {
  return [
    "Review the change you just made against the task. Do not edit files.",
    "Answer with APPROVE or REQUEST_CHANGES on the first line, then why.",
    "",
    "Task:",
    task,
    "",
    "Diff:",
    diff.slice(0, 8000),
  ].join("\n");
}

/* ------------------------------------------------------------------ */
/* The pipeline                                                        */
/* ------------------------------------------------------------------ */

export async function runPipeline(
  task: string,
  runStage: StageRunner,
  options: PipelineOptions,
): Promise<PipelineResult> {
  const exec = options.exec ?? defaultExec;
  const maxRepairs = options.maxRepairs ?? DEFAULT_MAX_REPAIRS;
  const stages: StageResult[] = [];
  const touched = new Set<string>();

  const record = (
    stage: StageName,
    verdict: Verdict,
    reason: string,
    output = "",
    filesChanged: string[] = [],
    startedAt = Date.now(),
  ): StageResult => {
    const result: StageResult = {
      stage,
      verdict,
      reason,
      output,
      filesChanged,
      durationMs: Date.now() - startedAt,
    };
    for (const file of filesChanged) touched.add(file);
    stages.push(result);
    options.onStage?.(stage, "end", result);
    return result;
  };

  const stop = (stage: StageName, reason: string): PipelineResult => ({
    success: false,
    stages,
    stoppedAt: stage,
    reason,
    filesChanged: [...touched],
    output: stages[stages.length - 1]?.output ?? "",
  });

  const gitDiff = (): string => {
    const result = exec("git diff HEAD", options.cwd);
    // No diff is a real answer; a git failure (no repo) is not, and is
    // reported as an empty diff so review falls back to its other checks.
    return result.output ?? "";
  };

  /* ---- plan ---- */
  let plan = "";
  if (options.plan !== false) {
    const startedAt = Date.now();
    options.onStage?.("plan", "start");
    const planRun = await runStage({
      stage: "plan",
      prompt: planPrompt(task),
      attempt: 1,
    });
    plan = planRun.output ?? "";
    if (!planRun.success) {
      record(
        "plan",
        "failed",
        planRun.stderr || "The planning step failed.",
        plan,
        [],
        startedAt,
      );
      return stop("plan", "The agent could not produce a plan.");
    }
    // A plan is useful, not mandatory: a one-line task rightly produces
    // almost nothing, and refusing to continue over that helps nobody.
    record(
      "plan",
      plan.trim() ? "passed" : "skipped",
      plan.trim()
        ? "Plan produced."
        : "The agent returned no plan; continuing without one.",
      plan,
      [],
      startedAt,
    );
  } else {
    record("plan", "skipped", "Planning was turned off for this run.");
  }

  /* ---- implement (+ repair loop) ---- */
  const testCommand =
    options.testCommand === undefined
      ? detectTestCommand(options.cwd)
      : options.testCommand;

  let attempt = 0;
  let lastImplementOutput = "";

  for (;;) {
    attempt++;
    const startedAt = Date.now();
    options.onStage?.("implement", "start");
    const prompt =
      attempt === 1
        ? implementPrompt(task, plan)
        : repairPrompt(task, stages[stages.length - 1]?.output ?? "");
    const run = await runStage({ stage: "implement", prompt, attempt });
    lastImplementOutput = run.output ?? "";
    const files = run.filesChanged ?? [];

    if (!run.success) {
      record(
        "implement",
        "failed",
        run.stderr?.slice(0, 400) || "The harness exited with an error.",
        lastImplementOutput,
        files,
        startedAt,
      );
      return stop("implement", "The implementation step failed.");
    }

    // The gate that matters: a run that touched nothing did not do the work,
    // however confident its summary sounds.
    if (files.length === 0 && touched.size === 0) {
      record(
        "implement",
        "failed",
        "The working tree is unchanged — nothing was implemented.",
        lastImplementOutput,
        files,
        startedAt,
      );
      return stop(
        "implement",
        "The agent reported success but changed no files.",
      );
    }

    record(
      "implement",
      "passed",
      `${files.length} file(s) changed.`,
      lastImplementOutput,
      files,
      startedAt,
    );

    /* ---- test ---- */
    if (!testCommand) {
      record("test", "skipped", "This project has no test command to run.");
      break;
    }

    const testStart = Date.now();
    options.onStage?.("test", "start");
    const testRun = exec(testCommand, options.cwd);
    if (testRun.ok) {
      record(
        "test",
        "passed",
        `${testCommand} passed.`,
        testRun.output,
        [],
        testStart,
      );
      break;
    }

    const repairsLeft = maxRepairs - (attempt - 1);
    record(
      "test",
      "failed",
      repairsLeft > 0
        ? `${testCommand} failed — sending it back to fix (${repairsLeft} attempt(s) left).`
        : `${testCommand} still fails after ${maxRepairs} repair attempt(s).`,
      testRun.output,
      [],
      testStart,
    );

    if (repairsLeft <= 0) {
      return stop(
        "test",
        `Tests still fail after ${maxRepairs} repair attempt(s).`,
      );
    }
  }

  /* ---- review ---- */
  const reviewStart = Date.now();
  options.onStage?.("review", "start");
  const diff = gitDiff();
  const heuristic = reviewDiff(diff);
  if (!heuristic.approved) {
    record(
      "review",
      "failed",
      heuristic.reason,
      diff.slice(0, 2000),
      [],
      reviewStart,
    );
    return stop("review", heuristic.reason);
  }

  let reviewReason = heuristic.reason;
  if (options.judge) {
    const verdict = await options.judge({
      prompt: task,
      diff,
      output: lastImplementOutput,
    });
    // A judge that cannot answer leaves the heuristic verdict standing,
    // rather than blocking work on an unavailable model.
    if (verdict && !verdict.approved) {
      record(
        "review",
        "failed",
        verdict.reason,
        lastImplementOutput,
        [],
        reviewStart,
      );
      return stop("review", verdict.reason);
    }
    if (verdict) reviewReason = verdict.reason;
  } else {
    // No judge configured: ask the harness itself to review its own diff.
    const selfReview = await runStage({
      stage: "review",
      prompt: reviewPrompt(task, diff),
      attempt: 1,
    });
    const text = selfReview.output ?? "";
    if (/^\s*REQUEST_CHANGES/im.test(text)) {
      record("review", "failed", text.slice(0, 400), text, [], reviewStart);
      return stop("review", "The review pass asked for changes.");
    }
    if (text.trim()) reviewReason = text.slice(0, 400);
  }
  record(
    "review",
    "passed",
    reviewReason,
    lastImplementOutput,
    [],
    reviewStart,
  );

  /* ---- ship ---- */
  const shipStart = Date.now();
  options.onStage?.("ship", "start");
  record(
    "ship",
    "passed",
    `${touched.size} file(s) ready on the working tree.`,
    lastImplementOutput,
    [],
    shipStart,
  );

  return {
    success: true,
    stages,
    stoppedAt: null,
    reason: "All stages passed.",
    filesChanged: [...touched],
    output: lastImplementOutput,
  };
}
