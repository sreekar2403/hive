import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import type {
  Harness,
  HarnessExecutionResult,
  HarnessOptions,
} from "@hive/shared/harness";
import { Orchestrator } from "../orchestrator";
import { createDefaultConfig, type Config } from "../config";
import {
  createKanbanCard,
  ensureKanbanTable,
  finishKanbanCard,
} from "../kanban";
import { getDb } from "../db/database";

/**
 * The fan-out path end to end, with scripted harnesses instead of real CLIs.
 *
 * The three things pinned here are the ones that were either broken or
 * absent, and that no unit test of the planner can catch: a coordinator
 * must not hold a concurrency slot while its own children queue for one,
 * sub-agents must run in their own checkouts, and a sub-agent must never be
 * split again.
 */

/** A harness that answers the planner with a plan and does work otherwise. */
function scriptedHarness(options: {
  plan?: unknown;
  onWork?: (prompt: string, opts?: HarnessOptions) => void;
  workOutput?: (prompt: string) => string;
}): Harness & { workCwds: string[]; workPrompts: string[] } {
  const workCwds: string[] = [];
  const workPrompts: string[] = [];

  return {
    name: "scripted",
    workCwds,
    workPrompts,
    isAvailable: async () => true,
    isCompatible: () => true,
    async execute(
      prompt: string,
      opts?: HarnessOptions,
    ): Promise<HarnessExecutionResult> {
      const planning = prompt.includes("You are a dispatcher");

      if (!planning) {
        workCwds.push(opts?.cwd ?? "");
        workPrompts.push(prompt);
        options.onWork?.(prompt, opts);
      }

      return {
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
        output: planning
          ? JSON.stringify(options.plan ?? { parallel: false })
          : (options.workOutput?.(prompt) ?? "done"),
        filesChanged: [],
        duration: 1,
        events: [],
      };
    },
  };
}

const TWO_WAY_PLAN = {
  parallel: true,
  reasoning: "Two independent documents.",
  subtasks: [
    {
      title: "Frontend PRD",
      prompt: "Write docs/frontend-prd.md covering screens, state and routing.",
    },
    {
      title: "Backend PRD",
      prompt: "Write docs/backend-prd.md covering the API, schema and jobs.",
    },
  ],
};

let repo: string;

function git(args: string[], cwd: string) {
  execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
}

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "hive-fanout-"));
  git(["init", "-b", "main"], repo);
  git(["config", "user.email", "test@example.com"], repo);
  git(["config", "user.name", "Test"], repo);
  fs.writeFileSync(path.join(repo, "README.md"), "# fixture\n");
  git(["add", "."], repo);
  git(["commit", "-m", "initial"], repo);
});

afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

function configFor(overrides: Partial<Config["loop"]> = {}): Config {
  const config = createDefaultConfig();
  config.loop = {
    ...config.loop,
    maxIterations: 1,
    ...overrides,
    fanout: { ...config.loop.fanout, ...(overrides.fanout ?? {}) },
  };
  config.permission = { ...config.permission, enabled: false };
  return config;
}

/** Points the orchestrator at the fixture repo rather than a real project. */
function orchestratorFor(config: Config, harness: Harness): Orchestrator {
  const orchestrator = new Orchestrator(
    config,
    new Map([["scripted", harness]]),
  );
  // workingTreeFor resolves a project id through the database; the fixture
  // has no project, so pin the tree directly.
  (
    orchestrator as unknown as {
      workingTreeFor: (id: string | null) => string | undefined;
    }
  ).workingTreeFor = () => repo;
  return orchestrator;
}

/**
 * A sub-agent's prompt is a briefing: its own instruction, then what its
 * siblings are doing, then the original request. Only the first part
 * identifies which agent this is — the rest mentions every agent.
 */
function ownInstruction(prompt: string): string {
  const body = prompt.split("=== Other agents on this request ===")[0];
  return body.split("=== End of memory context ===").pop() ?? body;
}

const REQUEST =
  "read this prd file and create a frontend and backend prd use appropriate subagents with respective subagents";

describe("sub-agent fan-out", () => {
  it("splits one request into agents that each run in their own worktree", async () => {
    const harness = scriptedHarness({ plan: TWO_WAY_PLAN });
    const orchestrator = orchestratorFor(
      configFor({ maxConcurrentAgents: 2, fanout: { merge: false } as never }),
      harness,
    );

    const parent = await orchestrator.createTask("s1", REQUEST, "scripted");
    const finished = await orchestrator.executeTask(parent.id);

    expect(finished.status).toBe("completed");
    expect(harness.workCwds).toHaveLength(2);

    // Two different checkouts, and neither is the repo itself.
    const unique = new Set(harness.workCwds);
    expect(unique.size).toBe(2);
    for (const cwd of unique) {
      expect(cwd.startsWith(path.join(repo, ".hive-worktrees"))).toBe(true);
    }
  });

  it("does not deadlock when only one agent may run at a time", async () => {
    // The regression this guards: the coordinator used to take a slot of
    // its own, so with a limit of 1 its children waited on a slot it would
    // not release until they finished.
    const harness = scriptedHarness({ plan: TWO_WAY_PLAN });
    const orchestrator = orchestratorFor(
      configFor({ maxConcurrentAgents: 1, fanout: { merge: false } as never }),
      harness,
    );

    const parent = await orchestrator.createTask("s2", REQUEST, "scripted");
    const finished = await Promise.race([
      orchestrator.executeTask(parent.id),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("deadlocked")), 10000),
      ),
    ]);

    expect(finished.status).toBe("completed");
    expect(harness.workCwds).toHaveLength(2);
  });

  it("never splits a sub-agent again", async () => {
    // The planner here would split *everything* it is asked about.
    const harness = scriptedHarness({ plan: TWO_WAY_PLAN });
    const orchestrator = orchestratorFor(
      configFor({ maxConcurrentAgents: 2, fanout: { merge: false } as never }),
      harness,
    );

    const parent = await orchestrator.createTask("s3", REQUEST, "scripted");
    await orchestrator.executeTask(parent.id);

    // Exactly two agents did work: 2 children, not 2 + 4 grandchildren.
    expect(harness.workCwds).toHaveLength(2);
  });

  it("tells each agent what the others are doing", async () => {
    const harness = scriptedHarness({ plan: TWO_WAY_PLAN });
    const orchestrator = orchestratorFor(
      configFor({ maxConcurrentAgents: 2, fanout: { merge: false } as never }),
      harness,
    );

    const parent = await orchestrator.createTask("s4", REQUEST, "scripted");
    await orchestrator.executeTask(parent.id);

    const frontendBrief = harness.workPrompts.find((p) =>
      ownInstruction(p).includes("docs/frontend-prd.md"),
    );
    expect(frontendBrief).toContain("Backend PRD");
    expect(frontendBrief).toContain(REQUEST);
  });

  it("merges each agent's work into the branch the repo is on", async () => {
    const harness = scriptedHarness({
      plan: TWO_WAY_PLAN,
      onWork: (prompt, opts) => {
        // Each agent writes only its own file, as it was briefed to. The
        // brief names the sibling's file too, so key off the agent's own
        // instruction — the first line — not the whole prompt.
        const file = ownInstruction(prompt).includes("frontend")
          ? "docs/frontend-prd.md"
          : "docs/backend-prd.md";
        const target = path.join(opts?.cwd ?? repo, file);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, `# ${file}\n`);
      },
    });

    git(["checkout", "-b", "feat/prd"], repo);
    const orchestrator = orchestratorFor(
      configFor({ maxConcurrentAgents: 2 }),
      harness,
    );

    const parent = await orchestrator.createTask("s5", REQUEST, "scripted");
    const finished = await orchestrator.executeTask(parent.id);

    expect(finished.output).toContain("Merged into `feat/prd`");
    expect(fs.existsSync(path.join(repo, "docs/frontend-prd.md"))).toBe(true);
    expect(fs.existsSync(path.join(repo, "docs/backend-prd.md"))).toBe(true);
  });

  it("runs normally when the planner declines to split", async () => {
    const harness = scriptedHarness({ plan: { parallel: false } });
    const orchestrator = orchestratorFor(
      configFor({ maxConcurrentAgents: 2 }),
      harness,
    );

    const parent = await orchestrator.createTask("s6", REQUEST, "scripted");
    const finished = await orchestrator.executeTask(parent.id);

    expect(harness.workCwds).toHaveLength(1);
    // The single agent runs in the project itself, not a worktree.
    expect(harness.workCwds[0]).toBe(repo);
    expect(finished.output).not.toContain("agents in parallel");
  });

  it("does not pay for a planning call when fan-out is off", async () => {
    const harness = scriptedHarness({ plan: TWO_WAY_PLAN });
    const execute = vi.spyOn(harness, "execute");
    const orchestrator = orchestratorFor(
      configFor({
        maxConcurrentAgents: 2,
        fanout: { enabled: false } as never,
      }),
      harness,
    );

    const parent = await orchestrator.createTask("s7", REQUEST, "scripted");
    await orchestrator.executeTask(parent.id);

    for (const call of execute.mock.calls) {
      expect(String(call[0])).not.toContain("You are a dispatcher");
    }
  });

  it("reports a partial result when one agent fails", async () => {
    const harness = scriptedHarness({ plan: TWO_WAY_PLAN });
    const original = harness.execute.bind(harness);
    harness.execute = async (prompt: string, opts?: HarnessOptions) => {
      if (ownInstruction(prompt).includes("docs/backend-prd.md")) {
        return {
          success: false,
          exitCode: 1,
          stdout: "",
          stderr: "model exploded",
          output: "",
          filesChanged: [],
          duration: 1,
          events: [],
        };
      }
      return original(prompt, opts);
    };

    const orchestrator = orchestratorFor(
      configFor({ maxConcurrentAgents: 2, fanout: { merge: false } as never }),
      harness,
    );

    const parent = await orchestrator.createTask("s8", REQUEST, "scripted");
    const finished = await orchestrator.executeTask(parent.id);

    expect(finished.status).toBe("completed");
    expect(finished.output).toMatch(/1 finished, 1 did not/);
  });
});

/**
 * The board is how someone watching a fan-out sees what each agent did.
 * One card for a four-agent request hid the only interesting part: every
 * sub-agent has its own branch, files and outcome, and the request's card
 * can report nothing but an unattributed union of them.
 */
describe("sub-agent board cards", () => {
  const PROJECT = "proj-fanout-test";

  function cards() {
    return getDb()
      .prepare(
        `SELECT id, title, prompt, parent_id, status, branch_name, harness,
                files, files_changed
           FROM kanban_tasks WHERE project_id = ? ORDER BY created_at`,
      )
      .all(PROJECT) as Array<{
      id: string;
      title: string | null;
      prompt: string;
      parent_id: string | null;
      status: string;
      branch_name: string | null;
      harness: string | null;
      files: string | null;
      files_changed: number;
    }>;
  }

  beforeEach(() => {
    ensureKanbanTable();
    getDb()
      .prepare(`DELETE FROM kanban_tasks WHERE project_id = ?`)
      .run(PROJECT);
  });

  async function runSplit(harness: Harness) {
    const orchestrator = orchestratorFor(
      configFor({ maxConcurrentAgents: 2, fanout: { merge: false } as never }),
      harness,
    );
    const parentCard = createKanbanCard({
      projectId: PROJECT,
      prompt: REQUEST,
      harness: "scripted",
      runTaskId: null,
      sessionId: "board",
      model: null,
      branchName: null,
    });

    const parent = await orchestrator.createTask(
      "board",
      REQUEST,
      "scripted",
      PROJECT,
    );
    parent.kanbanCardId = parentCard;
    await orchestrator.executeTask(parent.id);
    return parentCard;
  }

  it("opens a card for every sub-agent", async () => {
    await runSplit(scriptedHarness({ plan: TWO_WAY_PLAN }));
    expect(cards()).toHaveLength(3); // the request, plus one per agent
  });

  it("hangs each sub-card off the request it was split from", async () => {
    const parentCard = await runSplit(scriptedHarness({ plan: TWO_WAY_PLAN }));
    const children = cards().filter((c) => c.parent_id !== null);

    expect(children).toHaveLength(2);
    for (const child of children) expect(child.parent_id).toBe(parentCard);
  });

  it("titles a sub-card with the label, not the briefing", () => {
    return runSplit(scriptedHarness({ plan: TWO_WAY_PLAN })).then(() => {
      const children = cards().filter((c) => c.parent_id !== null);
      expect(children.map((c) => c.title).sort()).toEqual([
        "Backend PRD",
        "Frontend PRD",
      ]);
      // The briefing would be unreadable on a card, and is not the title.
      for (const child of children) {
        expect(child.title).not.toContain("Other agents on this request");
      }
    });
  });

  it("gives each sub-card its own branch", async () => {
    await runSplit(scriptedHarness({ plan: TWO_WAY_PLAN }));
    const branches = cards()
      .filter((c) => c.parent_id !== null)
      .map((c) => c.branch_name);

    expect(new Set(branches).size).toBe(2);
    for (const branch of branches) expect(branch).toMatch(/^hive\//);
  });

  it("closes each sub-card with that agent's own outcome", async () => {
    const harness = scriptedHarness({ plan: TWO_WAY_PLAN });
    const original = harness.execute.bind(harness);
    harness.execute = async (prompt: string, opts?: HarnessOptions) => {
      if (ownInstruction(prompt).includes("docs/backend-prd.md")) {
        return {
          success: false,
          exitCode: 1,
          stdout: "",
          stderr: "model exploded",
          output: "",
          filesChanged: [],
          duration: 1,
          events: [],
        };
      }
      return original(prompt, opts);
    };

    await runSplit(harness);
    const children = cards().filter((c) => c.parent_id !== null);
    const byTitle = new Map(children.map((c) => [c.title, c]));

    expect(byTitle.get("Frontend PRD")?.status).toBe("done");
    expect(byTitle.get("Backend PRD")?.status).toBe("failed");
  });

  /*
   * The regression: a coordinator runs no loop, so its `iteration` stayed
   * undefined, and `kanban_tasks.iterations` is NOT NULL. Closing the
   * request's card threw *after* every agent had finished — the files were
   * on disk and the whole response was lost to a 500.
   */
  it("reports an iteration count for the request itself", async () => {
    const harness = scriptedHarness({ plan: TWO_WAY_PLAN });
    const orchestrator = orchestratorFor(
      configFor({ maxConcurrentAgents: 2, fanout: { merge: false } as never }),
      harness,
    );

    const parent = await orchestrator.createTask("s9", REQUEST, "scripted");
    const finished = await orchestrator.executeTask(parent.id);

    expect(finished.iteration).toBeTypeOf("number");
    expect(finished.iteration).toBeGreaterThan(0);
  });

  it("closes a card even when the caller reports no iterations", async () => {
    // server.ts writes `result.iteration` straight into a NOT NULL column;
    // an undefined there is what turned a finished fan-out into a 500.
    const card = createKanbanCard({
      projectId: PROJECT,
      prompt: REQUEST,
      harness: "scripted",
      runTaskId: null,
      sessionId: "board",
      model: null,
      branchName: null,
    });

    expect(() =>
      finishKanbanCard(card, { status: "done", iterations: undefined }),
    ).not.toThrow();

    const row = getDb()
      .prepare(`SELECT iterations FROM kanban_tasks WHERE id = ?`)
      .get(card) as { iterations: number };
    expect(row.iterations).toBe(0);
  });

  it("opens no sub-cards when the request is not split", async () => {
    await runSplit(scriptedHarness({ plan: { parallel: false } }));
    expect(cards().filter((c) => c.parent_id !== null)).toHaveLength(0);
  });
});
