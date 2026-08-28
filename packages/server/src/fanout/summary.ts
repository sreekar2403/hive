import type { SubTask } from "./planner";

/**
 * Turning several agents' runs back into one answer.
 *
 * Composed rather than generated. The obvious alternative — hand every
 * sub-result to a model and ask for a summary — costs another full agent
 * run at the end of a fan-out that already spent N of them, and it can
 * quietly drop the one result the user cared about or invent agreement
 * between agents that disagreed. Composition cannot do either: what each
 * agent produced is what gets reported, including the ones that failed.
 */

export interface SubResult {
  taskId: string;
  title: string;
  harness: string;
  branch: string;
  success: boolean;
  output: string;
  filesChanged: string[];
  error?: string | null;
}

export interface MergeReport {
  merged: string[];
  conflicted: { branch: string; files: string[] } | null;
  skipped: string[];
  /** Branch the work was merged into. */
  target: string;
}

/** How much of each agent's answer is quoted before it is cut. */
const EXCERPT_LIMIT = 1200;

export function composeFanoutAnswer(
  results: SubResult[],
  merge: MergeReport | null,
  reasoning?: string,
): string {
  const lines: string[] = [];
  const succeeded = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);

  lines.push(
    `Ran ${results.length} agents in parallel — ${succeeded.length} finished, ${failed.length} did not.`,
  );
  if (reasoning) lines.push("", `Why it was split: ${reasoning}`);

  for (const result of results) {
    lines.push("", `## ${result.title}`);
    lines.push(
      `${result.success ? "Done" : "Failed"} · ${result.harness} · \`${result.branch}\``,
    );

    if (result.filesChanged.length) {
      lines.push(
        "",
        `Files: ${result.filesChanged.map((f) => `\`${f}\``).join(", ")}`,
      );
    } else if (result.success) {
      // Worth saying out loud: a "successful" agent that wrote nothing is
      // usually the interesting result, not the boring one.
      lines.push("", "No files changed.");
    }

    if (!result.success && result.error) {
      lines.push("", `Error: ${result.error}`);
    }

    const excerpt = (result.output ?? "").trim();
    if (excerpt) {
      lines.push("", truncate(excerpt, EXCERPT_LIMIT));
    }
  }

  if (merge) lines.push("", ...mergeLines(merge));

  return lines.join("\n");
}

function mergeLines(merge: MergeReport): string[] {
  const lines: string[] = ["## Merge"];

  if (merge.merged.length) {
    lines.push(
      `Merged into \`${merge.target}\`: ${merge.merged.map((b) => `\`${b}\``).join(", ")}`,
    );
  }

  if (merge.conflicted) {
    // The branch is deliberately still on disk here — see
    // collectParallelBranches — so naming it is actionable, not just bad news.
    lines.push(
      `\`${merge.conflicted.branch}\` conflicts in ${merge.conflicted.files.length} file(s) and was left unmerged: ${merge.conflicted.files
        .map((f) => `\`${f}\``)
        .join(", ")}`,
    );
  }

  if (merge.skipped.length) {
    lines.push(`${merge.skipped.length} agent(s) had nothing to merge.`);
  }

  if (lines.length === 1) lines.push("Nothing to merge.");
  return lines;
}

function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit).trimEnd()}\n\n_(truncated)_`;
}

/**
 * The instruction a sub-agent actually receives.
 *
 * Sub-agents run in separate worktrees and cannot see each other, so each
 * one is told what the others are doing. Without that, two agents asked for
 * "the frontend PRD" and "the backend PRD" both write the shared sections
 * and the merge conflicts on every one of them.
 */
export function briefSubAgent(
  task: SubTask,
  siblings: SubTask[],
  originalRequest: string,
): string {
  const others = siblings.filter((s) => s !== task);
  const sections: string[] = [];

  sections.push(task.prompt);

  if (others.length) {
    sections.push(
      "",
      "=== Other agents on this request ===",
      "You are one of several agents working at the same time, each in its own checkout. Do only your own piece. Do not write the files listed below — another agent is writing them, and duplicating the work will conflict at merge time.",
      ...others.map((other) => `- ${other.title}: ${other.prompt}`),
      "=== End other agents ===",
    );
  }

  sections.push(
    "",
    "=== The original request ===",
    originalRequest,
    "=== End original request ===",
  );

  return sections.join("\n");
}
