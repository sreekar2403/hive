import { LoopEngine, LoopCallback } from "./loopEngine";
import { Router, type RoutingResult } from "./router";
import { PermissionManager } from "./permissions";
import { ResourceManager } from "./resourceManager";
import { RuntimeGuard } from "./runtimeGuard";
import { SharedMemory } from "./sharedMemory";
import { Config } from "./config";
import { Harness, HarnessEvent } from "@hive/shared/harness";
import type { HarnessAttachment } from "@hive/shared/harness";
import { describeImagesFor } from "./visionBridge";
import { execFileSync } from "child_process";
import * as fs from "fs";
import { getDb } from "./db/database";
import { createKanbanCard, finishKanbanCard } from "./kanban";
import { broadcast } from "./routes/events";
import { endSpan, log, recordSpan, startSpan } from "./telemetry";
import { ensureRootDirectory, isGeneralProject } from "./generalWorkspace";
import { SecondBrain } from "./secondBrain";
import { keywords } from "./secondBrain/categorize";
import { createHarnessSynthesizer } from "./secondBrain/synthesizer";
import { effectiveAgentLimit } from "./capacity";
import { runPipeline, type StageName } from "./pipeline";
import { runGit } from "./branches";
import { briefingFor as mailBriefingFor } from "./agentMail";
import { currentBranch } from "./gitUtils";
import { asksForFanout, planFanout, type FanoutPlan } from "./fanout/planner";
import {
  briefSubAgent,
  composeFanoutAnswer,
  type MergeReport,
  type SubResult,
} from "./fanout/summary";
import {
  branchNameFor,
  commitAll,
  createWorktree,
  mergeAll,
  removeWorktree,
  type Worktree,
} from "./branches";

/**
 * Where a task's agent currently stands on the Office floor. Each phase is
 * a real pipeline stage, not decoration — see Orchestrator.setPhase() and
 * classifyWorkPhase() for how a task moves between them.
 */
export type TaskPhase =
  | "intake"
  | "bullpen"
  | "qa"
  | "conference"
  | "shipping"
  | "server-room"
  | "break-room";

export interface AgentTask {
  id: string;
  sessionId: string;
  prompt: string;
  harness: string;
  status: "pending" | "running" | "completed" | "failed";
  branchName: string;
  startedAt: number;
  completedAt: number | null;
  output: string;
  phase: TaskPhase;
  filesChanged: string[];
  /** The project this task runs against, when the caller knows it. */
  projectId: string | null;
  /** Harness the caller pinned, if any — overrides routing for the whole run. */
  requestedHarness: string | null;
  /** Model in the CLI's own notation, when the caller picked one. */
  model: string | null;
  /** Agent/persona to run under, where the harness supports one. */
  agent: string | null;
  /** Tool calls, thinking and status from the harness, in order. */
  events: HarnessEvent[];
  /** Previous messages in this conversation for context. */
  conversationHistory?: Array<{ role: string; content: string }>;
  /** Files the person attached to the message that started this run. */
  attachments?: HarnessAttachment[];
  /** Iterations the loop actually used, mirrored from LoopEngine state. */
  iteration?: number;
  /** Why the loop gave up, when it did. */
  error?: string | null;
  /**
   * Set on a sub-agent to the task it was split out of. Its presence is
   * also what stops fan-out recursing: a sub-task is never re-planned.
   */
  parentTaskId?: string | null;
  /**
   * The board card this run reports into, when it has one.
   *
   * Set by whoever opened the card — server.ts for a chat request, the
   * fan-out below for a sub-agent. The Orchestrator needs it so a
   * sub-agent's card can point at the request it was split out of.
   */
  kanbanCardId?: string | null;
  /**
   * Short label for the UI. A sub-agent's `prompt` is the full briefing —
   * its own instruction plus what its siblings are doing plus the original
   * request — which is correct to run and useless to read in a task list.
   * Overwriting `prompt` with the label instead was worse than useless: it
   * threw away the briefing the agent needed.
   */
  title?: string | null;
}

/** A long run can emit thousands of events; the trail keeps the newest. */
const MAX_TASK_EVENTS = 300;

/** How many times one task may be halted, approved and resumed. */
const MAX_GUARD_ATTEMPTS = 3;

/**
 * How long an agent lingers in Intake before moving to the zone its work
 * belongs in. The Office floor animates a character walking between
 * zones; without a beat here the two phase changes land in the same tick
 * and the walk is never seen.
 */
const INTAKE_DWELL_MS = 900;

/**
 * How soon a follow-up prompt in the same session counts as a correction
 * rather than as the next piece of work. Two minutes is long enough to
 * catch "no, do it the other way" and short enough that returning after
 * lunch to ask something unrelated isn't misread as dissatisfaction.
 */
const CORRECTION_WINDOW_MS = 2 * 60 * 1000;

function dwell(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Which zone a task's work belongs in, inferred from the prompt itself —
 * the same kind of keyword heuristic Router uses to pick a harness. This
 * keeps the Office floor honest: an agent standing in the QA Lab means the
 * prompt actually mentioned tests, not that a dice roll put them there.
 */
/**
 * Whether the second prompt reads as a correction of the first rather than
 * as the next step after it.
 *
 * Two signals, either of which is enough:
 *   - it opens with an explicit reversal ("no,", "actually", "instead", …)
 *   - it re-treads the same subject matter, which a genuinely new task
 *     would not
 *
 * Getting this wrong in the permissive direction is the expensive one: it
 * would teach the brain that satisfied users are dissatisfied. So the
 * overlap bar is set high enough that only a real re-statement clears it.
 */
export function looksLikeCorrection(previous: string, next: string): boolean {
  const reversal =
    /^\s*(no|nope|not|actually|instead|rather|wrong|undo|revert|that'?s not|don'?t|stop)/i;
  if (reversal.test(next)) return true;

  const previousTerms = new Set(keywords(previous, 12));
  const nextTerms = keywords(next, 12);
  if (previousTerms.size === 0 || nextTerms.length === 0) return false;

  const shared = nextTerms.filter((t) => previousTerms.has(t)).length;
  return shared / nextTerms.length >= 0.5;
}

function classifyWorkPhase(prompt: string): TaskPhase {
  const p = prompt.toLowerCase();
  if (
    /\b(test|spec|assert|expect|qa|verify|validate|jest|vitest|mocha)\b/.test(p)
  ) {
    return "qa";
  }
  if (
    /\b(deploy|build|install|docker|kubernetes|infra|ci|cd|migrate|migration|pipeline)\b/.test(
      p,
    )
  ) {
    return "server-room";
  }
  if (/\b(commit|merge|pull request|\bpr\b|publish|release|ship)\b/.test(p)) {
    return "shipping";
  }
  return "bullpen";
}

/**
 * Admission control for harness runs.
 *
 * `loop.maxConcurrentAgents` was configuration nobody enforced: every
 * request spawned its CLI immediately, so ten chats at once meant ten model
 * processes fighting over the same machine. Runs past the limit now wait
 * here in arrival order instead of being rejected — a queued task is still
 * going to happen, it is just not happening yet.
 */
export class ConcurrencyGate {
  private running = 0;
  private waiting: Array<() => void> = [];

  constructor(private limitFn: () => number) {}

  get active(): number {
    return this.running;
  }

  get queued(): number {
    return this.waiting.length;
  }

  get limit(): number {
    return Math.max(1, this.limitFn());
  }

  async acquire(): Promise<void> {
    if (this.running < this.limit) {
      this.running++;
      return;
    }
    await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.running++;
  }

  release(): void {
    this.running = Math.max(0, this.running - 1);
    // The limit can drop while runs are in flight (Settings changed); only
    // admit the next one once we are back under it.
    if (this.running < this.limit) {
      this.waiting.shift()?.();
    }
  }
}

export class Orchestrator {
  // The Office floor (routes/agents.ts) needs a live view of whichever
  // Orchestrator HiveServer constructed, but doesn't own a reference to
  // it — server.ts wires each route module up individually and isn't part
  // of this ticket's surface. Tracking the most recently constructed
  // instance here avoids adding that wiring: there is only ever one
  // Orchestrator per process today.
  private static active: Orchestrator | null = null;

  private config: Config;
  private harnesses: Map<string, Harness>;
  private router: Router;
  private permissionManager: PermissionManager;
  private resourceManager: ResourceManager;
  private sharedMemory: SharedMemory;
  private tasks: Map<string, AgentTask>;
  /**
   * One Second Brain per working tree, cached because the store roots are
   * derived from the project path and a task shouldn't pay to re-resolve
   * them. Keyed by resolved cwd; the unscoped case keys on "".
   */
  private brains: Map<string, SecondBrain>;
  /** Caps how many harness runs execute at once. See ConcurrencyGate. */
  private gate: ConcurrencyGate;
  /** Isolated checkouts held by parallel tasks, keyed by task id. */
  private worktrees: Map<string, Worktree> = new Map();

  constructor(config: Config, harnesses: Map<string, Harness>) {
    this.config = config;
    this.harnesses = harnesses;
    this.router = new Router(config, harnesses);
    this.permissionManager = new PermissionManager(config);
    this.resourceManager = new ResourceManager(config);
    // Read through a function so a Settings change takes effect on the next
    // admission rather than needing a restart.
    this.gate = new ConcurrencyGate(() =>
      effectiveAgentLimit(this.config.loop?.maxConcurrentAgents),
    );
    this.sharedMemory = new SharedMemory(config);
    this.tasks = new Map();
    this.brains = new Map();
    Orchestrator.active = this;
  }

  /** The most recently constructed Orchestrator, if any. See the `active` field comment above. */
  static getActive(): Orchestrator | null {
    return Orchestrator.active;
  }

  /** Harness ids registered at startup, in registration order. */
  getHarnessNames(): string[] {
    return Array.from(this.harnesses.keys());
  }

  async createTask(
    sessionId: string,
    prompt: string,
    harness?: string,
    projectId?: string | null,
    selection?: {
      model?: string | null;
      agent?: string | null;
      conversationHistory?: Array<{ role: string; content: string }>;
      attachments?: HarnessAttachment[];
    },
  ): Promise<AgentTask> {
    const taskId = this.generateId();
    const branchName = `hive/${sessionId}/${taskId}`;

    const task: AgentTask = {
      id: taskId,
      sessionId,
      prompt,
      harness: harness || this.config.routing.default,
      status: "pending",
      branchName,
      startedAt: Date.now(),
      completedAt: null,
      output: "",
      phase: "intake",
      filesChanged: [],
      projectId: projectId ?? null,
      requestedHarness: harness ?? null,
      model: selection?.model ?? null,
      agent: selection?.agent ?? null,
      events: [],
      conversationHistory: selection?.conversationHistory ?? [],
      attachments: selection?.attachments ?? [],
    };

    this.tasks.set(taskId, task);
    this.resourceManager.createTask(taskId, branchName, []);
    this.setPhase(task, "intake");
    return task;
  }

  async executeTask(
    taskId: string,
    onIteration?: LoopCallback,
  ): Promise<AgentTask> {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);

    // Is this one piece of work, or several?
    //
    // Asked *before* a slot is taken, and that ordering is load-bearing: a
    // parent holding a slot while its children queue for slots of their own
    // is a deadlock, and with `maxConcurrentAgents: 1` it is a guaranteed
    // one. The parent never runs a harness itself, so it never needs a slot.
    const plan = await this.planFanoutFor(task);
    if (plan) return await this.runFanout(task, plan, onIteration);

    // Wait for a slot before anything else happens. A task holding one is
    // "running"; until then it is queued in Intake, which is exactly what
    // the Office floor already shows.
    if (this.gate.active >= this.gate.limit) {
      const waitStart = Date.now();
      log(
        "info",
        "orchestrator",
        `Queued behind ${this.gate.active} running agents (limit ${this.gate.limit})`,
        { taskId: task.id, projectId: task.projectId },
      );
      await this.gate.acquire();
      recordSpan(
        task.id,
        "Waited for a free agent slot",
        "task",
        null,
        waitStart,
        "ok",
        { limit: this.gate.limit },
      );
    } else {
      await this.gate.acquire();
    }

    try {
      return await this.runTask(task, onIteration);
    } finally {
      // Whatever happened — success, failure, a throw from a harness — the
      // slot goes back so the next queued run can start.
      this.gate.release();
    }
  }

  /**
   * Whether this task should be split, and into what.
   *
   * Returns null far more often than not — see fanout/planner.ts. The
   * cheap guards run first so the common case never pays for a model call:
   * a sub-agent is never re-split (that would recurse), and a short request
   * with no explicit ask is taken at face value.
   */
  private async planFanoutFor(task: AgentTask): Promise<FanoutPlan | null> {
    const settings = this.config.loop?.fanout;
    if (!settings?.enabled) return null;
    if (task.parentTaskId) return null;

    const explicit = asksForFanout(task.prompt);
    // A one-line request is a question, not a programme of work. Asking a
    // model to confirm that costs a round trip to reach the answer the
    // length already gave us.
    if (!explicit && task.prompt.trim().length < 80) return null;

    const harnessId =
      task.requestedHarness && this.harnesses.has(task.requestedHarness)
        ? task.requestedHarness
        : task.harness;
    const harness = this.harnesses.get(harnessId);
    if (!harness) return null;

    const planStart = Date.now();
    const plan = await planFanout(task.prompt, {
      harness,
      model: task.model ?? undefined,
      available: Array.from(this.harnesses.keys()),
      conversationHistory: task.conversationHistory,
      maxSubtasks: settings.maxSubtasks,
      timeoutMs: settings.plannerTimeoutMs,
    });

    recordSpan(
      task.id,
      plan ? `Split into ${plan.subtasks.length} agents` : "Ran as one task",
      "route",
      null,
      planStart,
      "ok",
      plan ? { subtasks: plan.subtasks.map((s) => s.title) } : undefined,
    );

    if (plan) {
      log(
        "info",
        "fanout",
        `Split into ${plan.subtasks.length}: ${plan.subtasks.map((s) => s.title).join(", ")}`,
        { taskId: task.id, projectId: task.projectId },
      );
    }

    return plan;
  }

  /**
   * Runs a plan's sub-agents at the same time and folds their work back
   * into one answer.
   *
   * The parent task is a coordinator, not a worker: it spawns no harness of
   * its own, so it holds no concurrency slot and cannot starve its own
   * children. Each child takes a slot the normal way, which means
   * `maxConcurrentAgents` still governs how much actually runs at once —
   * a six-way split on a two-slot machine runs two at a time rather than
   * six, and that is the intended behaviour, not a limitation.
   */
  private async runFanout(
    parent: AgentTask,
    plan: FanoutPlan,
    onIteration?: LoopCallback,
  ): Promise<AgentTask> {
    parent.status = "running";
    this.setPhase(parent, "conference");

    const children = await this.createParallelBranches(
      parent.sessionId,
      plan.subtasks.map((subtask) => ({
        // Each agent is told what its siblings are doing; they run in
        // separate checkouts and would otherwise duplicate shared work and
        // conflict on every file of it.
        prompt: briefSubAgent(subtask, plan.subtasks, parent.prompt),
        harness: subtask.harness ?? parent.requestedHarness ?? undefined,
        // The model the user picked applies to the whole request, sub-agents
        // included — picking opencode/ornith in the composer and getting a
        // different model on the actual work would be a surprise.
        model: parent.model,
        agent: parent.agent,
        // Every sub-agent gets what was attached to the request. Which of
        // them needs the screenshot is not knowable here, and an agent that
        // does not need it simply does not open it.
        attachments: parent.attachments,
      })),
      parent.projectId,
    );

    for (const [index, child] of children.entries()) {
      child.parentTaskId = parent.id;
      child.title = plan.subtasks[index].title;

      // A card each. A four-agent request that showed one card was hiding
      // the part worth looking at: every sub-agent has its own branch,
      // worktree, files and outcome, and the request's own card can only
      // report a union of those with no attribution.
      if (child.projectId) {
        try {
          child.kanbanCardId = createKanbanCard({
            projectId: child.projectId,
            // The briefing is what runs; the label is what reads.
            prompt: plan.subtasks[index].prompt,
            title: plan.subtasks[index].title,
            parentId: parent.kanbanCardId ?? null,
            harness: child.harness,
            runTaskId: child.id,
            sessionId: child.sessionId,
            model: child.model,
            branchName: child.branchName,
          });
        } catch (err) {
          // The board is a view onto the run, never a reason to fail it.
          log("warn", "fanout", `Could not open a board card: ${String(err)}`, {
            taskId: child.id,
            projectId: child.projectId,
          });
        }
      }

      broadcast("task:started", {
        sessionId: child.sessionId,
        taskId: child.id,
        projectId: child.projectId,
        prompt: plan.subtasks[index].title,
        parentTaskId: parent.id,
      });
    }

    broadcast("fanout:planned", {
      sessionId: parent.sessionId,
      taskId: parent.id,
      projectId: parent.projectId,
      reasoning: plan.reasoning,
      subtasks: children.map((child, index) => ({
        taskId: child.id,
        title: plan.subtasks[index].title,
        branch: child.branchName,
      })),
    });

    // allSettled, not all: one agent throwing must not discard the work the
    // others finished, which is exactly the case a fan-out exists to handle.
    const settled = await Promise.allSettled(
      children.map((child) => this.executeTask(child.id, onIteration)),
    );

    const results: SubResult[] = children.map((child, index) => {
      const outcome = settled[index];
      const finished = outcome.status === "fulfilled" ? outcome.value : child;
      return {
        taskId: child.id,
        title: plan.subtasks[index].title,
        harness: finished.harness,
        branch: finished.branchName,
        success:
          outcome.status === "fulfilled" && finished.status === "completed",
        output: finished.output ?? "",
        filesChanged: finished.filesChanged ?? [],
        error:
          outcome.status === "rejected"
            ? String(outcome.reason)
            : (finished.error ?? null),
      };
    });

    // Close each sub-agent's card with what that agent actually did, before
    // the summary is composed — the board is how someone watching sees a
    // partial result while the rest is still merging.
    for (const [index, child] of children.entries()) {
      if (!child.kanbanCardId) continue;
      const outcome = results[index];
      try {
        finishKanbanCard(child.kanbanCardId, {
          status: outcome.success ? "done" : "failed",
          iterations: child.iteration ?? 0,
          files: outcome.filesChanged,
          output: outcome.output,
          error: outcome.error ?? null,
          branchName: outcome.branch,
        });
      } catch {
        // Same reasoning as opening it: never fail a run over the board.
      }
      broadcast(outcome.success ? "task:completed" : "task:failed", {
        sessionId: child.sessionId,
        taskId: child.id,
        projectId: child.projectId,
        harness: child.harness,
        parentTaskId: parent.id,
      });
    }

    const merge = await this.mergeFanout(parent, children);

    parent.output = composeFanoutAnswer(results, merge, plan.reasoning);
    parent.filesChanged = [
      ...new Set(results.flatMap((result) => result.filesChanged)),
    ];
    parent.completedAt = Date.now();
    // The coordinator runs no loop of its own, so its iteration count was
    // left undefined — and the board's `iterations` column is NOT NULL, so
    // writing the request's card threw *after* every agent had finished
    // and the whole response was lost with the work already on disk. The
    // sum is both non-null and the true answer to "how many attempts did
    // this request take".
    parent.iteration = children.reduce(
      (total, child) => total + (child.iteration ?? 0),
      0,
    );
    // The coordinator succeeded if any agent did; a fan-out where every
    // piece failed is a failed request, and one where some pieces landed is
    // a partial result the summary spells out agent by agent.
    parent.status = results.some((result) => result.success)
      ? "completed"
      : "failed";
    this.setPhase(
      parent,
      parent.status === "completed" ? "break-room" : "conference",
    );

    return parent;
  }

  /**
   * Commits and merges the sub-branches, when merging is turned on.
   *
   * Merges into whatever branch the repository is actually on, not `main`.
   * Landing an agent's work on a branch the user is not standing on is a
   * surprise they would find later, in a diff they did not ask for.
   */
  private async mergeFanout(
    parent: AgentTask,
    children: AgentTask[],
  ): Promise<MergeReport | null> {
    if (!this.config.loop?.fanout?.merge) return null;

    const repoPath = this.workingTreeFor(parent.projectId) ?? process.cwd();
    const target = currentBranch(repoPath);
    if (!target || target === "HEAD") {
      // Detached HEAD: there is no branch to merge into, and picking one
      // would be inventing an intent the user never expressed.
      log(
        "warn",
        "fanout",
        "No current branch to merge into; branches left as they are",
        {
          taskId: parent.id,
          projectId: parent.projectId,
        },
      );
      return null;
    }

    const collected = await this.collectParallelBranches(
      children.map((child) => child.id),
      target,
      parent.projectId,
    );

    return { ...collected, target };
  }

  /** How much work is in flight, for the Settings and Office screens. */
  loadSnapshot(): { running: number; queued: number; limit: number } {
    return {
      running: this.gate.active,
      queued: this.gate.queued,
      limit: this.gate.limit,
    };
  }

  private async runTask(
    task: AgentTask,
    onIteration?: LoopCallback,
  ): Promise<AgentTask> {
    task.status = "running";

    // One root span per run; everything below nests under it so the Logs
    // screen can draw the whole flow as a waterfall.
    const rootSpan = startSpan(task.id, task.prompt, "task", null, {
      sessionId: task.sessionId,
      projectId: task.projectId,
    });
    log("info", "orchestrator", `Task started: ${task.prompt}`, {
      taskId: task.id,
      projectId: task.projectId,
    });

    // The up-front gate, which only reads the user's prompt.
    //
    // It is off by default now (`permission.gateOn` defaults to
    // "commands"): a prompt is a statement of intent, and scanning it for
    // destructive verbs blocked "reset the onboarding copy" while missing
    // an agent that decided on `git reset --hard` by itself. The live gate
    // on the agent's actual shell calls is below, in runTaskGuarded.
    const gateOn = this.config.permission.gateOn ?? "prompt";
    if (this.config.permission.enabled && gateOn !== "commands") {
      const awaitingApproval = this.permissionManager.isDestructive(
        task.prompt,
      );
      if (awaitingApproval) {
        this.setPhase(task, "conference");
      }

      const permStart = Date.now();
      const needsPermission = await this.permissionManager.checkPermission(
        task.sessionId,
        task.prompt,
        task.prompt,
      );
      recordSpan(
        task.id,
        awaitingApproval ? "Waited for approval" : "Permission check",
        "permission",
        rootSpan,
        permStart,
        needsPermission ? "ok" : "failed",
        { gated: awaitingApproval, approved: needsPermission },
      );

      if (!needsPermission) {
        task.status = "failed";
        task.output = "Permission denied for destructive action";
        log("warn", "permissions", "Task denied at the approval gate", {
          taskId: task.id,
          projectId: task.projectId,
        });
        endSpan(rootSpan, "failed", { reason: "permission denied" });
        // The request was resolved — denied, or timed out with nobody there
        // to approve it — so the agent isn't waiting on anything anymore.
        this.setPhase(task, "break-room");
        return task;
      }
    }

    // The working tree this task runs against — resolved once, because the
    // Second Brain's store roots hang off it as well as the harness's cwd.
    //
    // A task holding a worktree runs *in* it. createParallelBranches has
    // always created one per parallel task, but execution resolved the cwd
    // from the project alone and so ran every one of them in the shared
    // checkout — the isolation existed on disk and did nothing. That is the
    // whole point of fanning out, so the worktree wins where there is one.
    const projectTree = this.workingTreeFor(task.projectId);
    const isolated = this.worktrees.get(task.id);
    const cwd = isolated?.path ?? projectTree;

    // The brain stays keyed to the project, not to the throwaway checkout:
    // lessons learned in a worktree that is about to be deleted belong to
    // the project the work was for.
    const brain = this.brainFor(projectTree);
    const category = brain.categorize(task.prompt);
    brain.learning.taskStarted(task.id);
    this.recordCorrectionOfPrevious(task, brain);

    // Route to harness. A harness pinned by the caller wins outright —
    // the Chat composer's "Harness" control used to be quietly ignored.
    // Otherwise the Router gets whatever the brain has learned about which
    // harness actually finishes this category of work; see Router.applyHints
    // for why that is advice rather than an instruction.
    const routeStart = Date.now();
    const pinned =
      task.requestedHarness && this.harnesses.has(task.requestedHarness)
        ? task.requestedHarness
        : null;
    const decision: RoutingResult = pinned
      ? { harness: pinned, model: "", reasoning: "Pinned by the caller" }
      : await this.router.route(task.prompt, {
          hints: brain.getRoutingHints(task.prompt),
          // What the user wrote down in soul.md. This outranks both the
          // keyword rules and the router's own judgement — see Router.route.
          soul: brain.getRoutingGuidance(),
        });
    task.harness = decision.harness;
    recordSpan(
      task.id,
      pinned
        ? `Pinned to ${decision.harness}`
        : `Routed to ${decision.harness}`,
      "route",
      rootSpan,
      routeStart,
      "ok",
      {
        harness: decision.harness,
        model: decision.model,
        reasoning: decision.reasoning,
        strategy: decision.strategy,
        category: decision.category ?? category,
      },
    );
    log(
      "info",
      "router",
      `Routed to ${decision.harness}: ${decision.reasoning}`,
      {
        taskId: task.id,
        projectId: task.projectId,
      },
    );

    // Which zone the work itself belongs in — see classifyWorkPhase. The
    // pause lets the floor show the walk out of Intake rather than
    // teleporting the character mid-frame.
    await dwell(INTAKE_DWELL_MS);
    this.setPhase(task, classifyWorkPhase(task.prompt));

    // What Hive already knows about this user and this kind of task. The
    // brain is asked explicitly here (ticket 039-05 chose explicit calls
    // over silent injection) and the result is passed to the loop as a
    // preamble, kept out of the prompt that drives routing and retries.
    const briefingStart = Date.now();
    const briefing = brain.getBriefing({
      taskId: task.id,
      prompt: task.prompt,
      category,
      harness: decision.harness,
      model: task.model,
      projectId: task.projectId,
      sessionId: task.sessionId,
    });
    if (briefing.text) {
      recordSpan(
        task.id,
        "Recalled from memory",
        "memory",
        rootSpan,
        briefingStart,
        "ok",
        {
          preferences: briefing.preferences.length,
          lessons: briefing.lessons.length,
          soulEntries: briefing.soul.length,
          chars: briefing.text.length,
        },
      );
      log(
        "info",
        "second-brain",
        `Recalled ${briefing.preferences.length} preference(s) and ${briefing.lessons.length} lesson(s)`,
        { taskId: task.id, projectId: task.projectId },
      );
    }

    // Anything a peer agent said about this session, read once and folded
    // into the same preamble the Second Brain briefing uses. Parallel
    // agents cannot see each other's worktrees, so this is the only way
    // one hears what another already did.
    let mail = "";
    try {
      mail = mailBriefingFor(task.sessionId, task.id);
    } catch {
      // The mailbox is a convenience; a task must not fail over it.
    }
    if (mail) {
      briefing.text = briefing.text
        ? `${briefing.text}

${mail}`
        : mail;
      log("info", "orchestrator", "Read messages from other agents", {
        taskId: task.id,
        projectId: task.projectId,
      });
    }

    // The staged loop, when it is turned on: plan → implement → test →
    // review → ship, each with a gate that can send the work back. It
    // drives the same phases the Office floor already draws, so the stage a
    // task is in is literally the room its character is standing in.
    if (this.config.loop?.pipeline?.enabled) {
      return await this.runStagedTask(task, {
        cwd,
        rootSpan,
        category,
        brain,
        briefing,
        pinned,
        onIteration,
      });
    }

    // One engine per task, never a shared one.
    //
    // LoopEngine carries the whole run on itself — iteration counter,
    // current prompt, previous output, the conversation history. A single
    // instance shared across tasks was fine only while exactly one task
    // could ever be in flight; ConcurrencyGate admits `maxConcurrentAgents`
    // of them, and sub-agent fan-out runs several by design. Sharing it
    // meant two agents overwriting each other's prompt and iteration count
    // mid-run, which surfaces as a task retrying against another task's
    // error.
    const loopEngine = new LoopEngine(this.config, this.harnesses, this.router);
    loopEngine.start(task.prompt);

    // Execute with loop
    const callback: LoopCallback = async (
      iteration,
      output,
      success,
      filesChanged,
    ) => {
      task.output = output;
      // Live budget: the office floor draws pips from the snapshot, so the
      // count has to move while the loop runs, not only once it settles.
      task.iteration = iteration;

      // Update resource manager with files
      if (filesChanged?.length) {
        task.filesChanged = filesChanged;
        const existingTask = await this.resourceManager.getTask(task.id);
        if (existingTask) {
          await this.resourceManager.updateTaskStatus(task.id, "running");
        }
      }

      // A visible pulse per iteration even when the zone itself hasn't
      // changed — output/files just moved.
      broadcast("agent:update", {
        taskId: task.id,
        sessionId: task.sessionId,
        projectId: task.projectId,
        phase: task.phase,
        harness: task.harness,
        iteration,
      });

      if (onIteration) {
        await onIteration(iteration, output, success, filesChanged);
      }
    };

    // ---- The live permission gate -------------------------------------
    //
    // The prompt-scanning gate above cannot see what the agent actually
    // does. This one watches the harness's tool-call stream and kills the
    // run the moment a destructive shell command appears, then asks a
    // human. Approving re-runs the task with that exact command allowed,
    // so the agent can finish the job it was stopped in the middle of.
    const guardEnabled = this.config.permission.enabled && gateOn !== "prompt";
    const approvedCommands = new Set<string>();

    // An image attached to a task running on a model that cannot see one is
    // described in words first, by a model that can. What comes back joins
    // the briefing, and the images it covered are dropped from the
    // attachment list — sending both would hand a blind model a file it
    // still cannot open, next to a description of it.
    const seen = await describeImagesFor(task.attachments, {
      harnesses: this.harnesses,
      harness: decision.harness,
      model: task.model,
      preferred: this.config.vision?.model,
      always: this.config.vision?.always,
    });
    const attachments = (task.attachments ?? []).filter(
      (attachment) => !seen.described.includes(attachment),
    );
    const preamble = seen.preamble
      ? `${seen.preamble}
${briefing.text}`
      : briefing.text;

    const runOptions = {
      cwd,
      harness: pinned ?? undefined,
      model: task.model ?? undefined,
      agent: task.agent ?? undefined,
      preamble,
      hints: brain.getRoutingHints(task.prompt),
      soul: brain.getRoutingGuidance(),
      conversationHistory: task.conversationHistory,
      attachments,
    };

    let result!: Awaited<ReturnType<typeof loopEngine.run>>;
    let guardAttempt = 0;

    for (;;) {
      guardAttempt++;
      const controller = new AbortController();
      const guard = guardEnabled
        ? new RuntimeGuard(this.permissionManager, approvedCommands)
        : null;

      result = await loopEngine.run(
        callback,
        task.id,
        rootSpan,
        task.projectId,
        {
          ...runOptions,
          signal: controller.signal,
          // Tool calls and thinking reach the chat window through here —
          // and the guard reads the same stream on its way past.
          onEvent: (harnessEvent) => {
            task.events.push(harnessEvent);
            if (task.events.length > MAX_TASK_EVENTS) {
              task.events.splice(0, task.events.length - MAX_TASK_EVENTS);
            }
            broadcast("agent:activity", {
              taskId: task.id,
              sessionId: task.sessionId,
              projectId: task.projectId,
              harness: task.harness,
              event: harnessEvent,
            });

            const trip = guard?.inspect(harnessEvent);
            if (trip) {
              log(
                "warn",
                "permissions",
                `Halting the run: the agent tried to run \`${trip.command}\``,
                {
                  taskId: task.id,
                  projectId: task.projectId,
                  context: { patterns: trip.patterns },
                },
              );
              controller.abort();
            }
          },
        },
      );

      const trip = guard?.tripped();
      if (!trip) break;

      // Somebody has to decide. Until they do, the agent sits in the
      // Conference Room rather than looking like it is still working.
      this.setPhase(task, "conference");
      const permStart = Date.now();
      const approved = await this.permissionManager.checkPermission(
        task.sessionId,
        trip.command,
        `The agent stopped mid-task trying to run \`${trip.command}\` ` +
          `(matched ${trip.patterns.join(", ")}). Approving re-runs the ` +
          `task with that command allowed.`,
        trip.command,
        task.filesChanged,
      );
      recordSpan(
        task.id,
        `Halted on \`${trip.command}\``,
        "permission",
        rootSpan,
        permStart,
        approved ? "ok" : "failed",
        { command: trip.command, patterns: trip.patterns, approved },
      );

      if (!approved) {
        task.status = "failed";
        task.output =
          `Stopped: the agent tried to run \`${trip.command}\`, which needs ` +
          `approval, and it was denied (or nobody answered in time).`;
        task.error = "Destructive command denied";
        task.completedAt = Date.now();
        log("warn", "permissions", "Destructive command denied mid-run", {
          taskId: task.id,
          projectId: task.projectId,
          context: { command: trip.command },
        });
        endSpan(rootSpan, "failed", { reason: "destructive command denied" });
        this.setPhase(task, "break-room");
        return task;
      }

      approvedCommands.add(trip.command);

      // Bounded: an agent that keeps finding new destructive commands would
      // otherwise ping-pong through the approval dialog forever.
      if (guardAttempt >= MAX_GUARD_ATTEMPTS) {
        log("warn", "permissions", "Giving up after repeated halts", {
          taskId: task.id,
          projectId: task.projectId,
        });
        break;
      }
      this.setPhase(task, classifyWorkPhase(task.prompt));
    }

    task.status = result.success ? "completed" : "failed";
    task.completedAt = Date.now();
    task.iteration = result.iteration;
    task.error = result.error;

    log(
      result.success ? "info" : "error",
      "orchestrator",
      result.success
        ? `Task completed after ${result.iteration} iteration(s)`
        : `Task failed: ${result.error ?? "unknown error"}`,
      {
        taskId: task.id,
        projectId: task.projectId,
        context: { filesChanged: task.filesChanged },
      },
    );
    endSpan(rootSpan, result.success ? "ok" : "failed", {
      iterations: result.iteration,
      filesChanged: task.filesChanged.length,
    });

    // Close the learning loop. This is the event-driven half of ticket
    // 039-03: cheap, synchronous bookkeeping, no model call. It is wrapped
    // because a memory layer that can fail a task it only observes would be
    // strictly worse than not having one.
    brain.learning.taskFinished(task.id);
    try {
      brain.recordFeedback(
        {
          taskId: task.id,
          prompt: task.prompt,
          category,
          harness: task.harness,
          model: task.model,
          projectId: task.projectId,
          sessionId: task.sessionId,
        },
        {
          success: result.success,
          iterations: result.iteration,
          durationMs: (task.completedAt ?? Date.now()) - task.startedAt,
          filesChanged: task.filesChanged.length,
          error: result.error ?? null,
          // Not known yet — a correction is only visible once the *next*
          // prompt arrives, so it is recorded by that task. See
          // recordCorrectionOfPrevious().
          correction: null,
        },
      );
    } catch (err) {
      log("warn", "second-brain", "Could not record what happened", {
        taskId: task.id,
        projectId: task.projectId,
        context: { error: err instanceof Error ? err.message : String(err) },
      });
    }

    // The deep pass runs on its own schedule and declines while anything is
    // still executing, so this is a nudge rather than a call — see
    // LearningAgent.runBatch.
    void brain
      .runLearningBatch()
      .then((queued) => {
        if (queued?.length) {
          log(
            "info",
            "second-brain",
            `Queued ${queued.length} soul.md suggestion(s) for your approval`,
            { taskId: task.id, projectId: task.projectId },
          );
        }
      })
      .catch(() => {
        // Already logged inside the agent; nothing here depends on it.
      });

    if (result.success) {
      // A real, if brief, stop in Shipping before the desk empties out —
      // long enough to see the walk, short enough not to block the caller.
      this.setPhase(task, "shipping");
      await new Promise((resolve) => setTimeout(resolve, 700));
      this.setPhase(task, "break-room");
    } else {
      // The loop gave up without a retryable error — this genuinely needs
      // a human. Nothing in this codebase currently supplies one (see
      // CLAUDE.md), so the agent realistically stays stuck here.
      this.setPhase(task, "conference");
    }

    return task;
  }

  /** Which room a pipeline stage puts the agent in. */
  private static readonly STAGE_PHASES: Record<StageName, TaskPhase> = {
    plan: "intake",
    implement: "bullpen",
    test: "qa",
    review: "conference",
    ship: "shipping",
  };

  /**
   * Runs a task through the staged pipeline.
   *
   * Each stage is one harness run through the same LoopEngine the direct
   * path uses, so retries, routing, telemetry and the live event stream all
   * behave identically — the pipeline decides *what to ask for next* and
   * whether the answer was good enough, not how to ask.
   */
  private async runStagedTask(
    task: AgentTask,
    context: {
      /** Undefined when no project is scoped; falls back to the server's cwd. */
      cwd: string | undefined;
      rootSpan: string;
      category: string;
      brain: SecondBrain;
      briefing: { text: string };
      pinned: string | null;
      onIteration?: LoopCallback;
    },
  ): Promise<AgentTask> {
    const { rootSpan, brain, briefing, pinned, onIteration } = context;
    const cwd = context.cwd ?? process.cwd();
    const pipelineConfig = this.config.loop.pipeline;

    const runStage = async (input: {
      stage: StageName;
      prompt: string;
      attempt: number;
    }) => {
      this.setPhase(task, Orchestrator.STAGE_PHASES[input.stage]);
      const stageSpan = startSpan(
        task.id,
        `Stage: ${input.stage}${input.attempt > 1 ? ` (attempt ${input.attempt})` : ""}`,
        "iteration",
        rootSpan,
        { stage: input.stage },
      );

      // A fresh engine per stage: LoopEngine carries per-run state, and a
      // stage is a run.
      const engine = new LoopEngine(this.config, this.harnesses, this.router);
      engine.start(input.prompt);

      let lastOutput = "";
      let lastFiles: string[] = [];
      const state = await engine.run(
        async (iteration, output, success, filesChanged) => {
          lastOutput = output;
          if (filesChanged?.length) {
            lastFiles = filesChanged;
            task.filesChanged = filesChanged;
          }
          task.output = output;
          task.iteration = iteration;
          broadcast("agent:update", {
            taskId: task.id,
            sessionId: task.sessionId,
            projectId: task.projectId,
            phase: task.phase,
            harness: task.harness,
            iteration,
            stage: input.stage,
          });
          if (onIteration)
            await onIteration(iteration, output, success, filesChanged);
        },
        task.id,
        stageSpan,
        task.projectId,
        {
          cwd,
          harness: pinned ?? undefined,
          model: task.model ?? undefined,
          agent: task.agent ?? undefined,
          preamble: briefing.text,
          hints: brain.getRoutingHints(task.prompt),
          soul: brain.getRoutingGuidance(),
          conversationHistory: task.conversationHistory,
          onEvent: (harnessEvent) => {
            task.events.push(harnessEvent);
            if (task.events.length > MAX_TASK_EVENTS) {
              task.events.splice(0, task.events.length - MAX_TASK_EVENTS);
            }
            broadcast("agent:activity", {
              taskId: task.id,
              sessionId: task.sessionId,
              projectId: task.projectId,
              harness: task.harness,
              event: harnessEvent,
            });
          },
        },
      );

      endSpan(stageSpan, state.success ? "ok" : "failed");
      return {
        success: state.success,
        output: lastOutput,
        filesChanged: lastFiles,
        stderr: state.error ?? undefined,
      };
    };

    const result = await runPipeline(task.prompt, runStage, {
      cwd,
      plan: pipelineConfig.plan,
      maxRepairs: pipelineConfig.maxRepairs,
      testCommand: pipelineConfig.testCommand || undefined,
      onStage: (stage, phase, stageResult) => {
        if (phase !== "end" || !stageResult) return;
        log(
          stageResult.verdict === "failed" ? "warn" : "info",
          "pipeline",
          `${stage}: ${stageResult.reason}`,
          { taskId: task.id, projectId: task.projectId },
        );
      },
    });

    task.status = result.success ? "completed" : "failed";
    task.completedAt = Date.now();
    task.filesChanged = result.filesChanged;
    // The reason a stage stopped is the useful answer here; the harness's
    // own last words are usually about the sub-task, not the outcome.
    task.output = result.success
      ? result.output
      : `${result.reason}\n\n${result.output}`;
    task.error = result.success ? null : result.reason;

    endSpan(rootSpan, result.success ? "ok" : "failed", {
      stages: result.stages.map((stage) => ({
        stage: stage.stage,
        verdict: stage.verdict,
        reason: stage.reason,
      })),
      filesChanged: result.filesChanged.length,
    });

    brain.learning.taskFinished(task.id);

    // A run that made it to ship is done; one that did not needs a human,
    // and the Conference Room is where that is said out loud.
    this.setPhase(task, result.success ? "break-room" : "conference");
    return task;
  }

  /**
   * Starts several tasks that can run at the same time without colliding.
   *
   * Each one gets its own branch *and* its own git worktree, so two agents
   * editing the same file are editing two different checkouts of it. They
   * previously shared a single branch name that was never created, which
   * meant parallel work landed on top of itself in one directory and
   * `git diff` attributed every change to whoever asked last.
   *
   * A task whose worktree cannot be created still runs — in the main
   * checkout, exactly as before — because refusing to work at all on a
   * non-git directory would be a worse answer than working unisolated.
   */
  async createParallelBranches(
    sessionId: string,
    tasks: Array<{
      prompt: string;
      harness?: string;
      /** Model in the CLI's own notation; see models/catalog.ts. */
      model?: string | null;
      agent?: string | null;
      attachments?: HarnessAttachment[];
    }>,
    projectId: string | null = null,
  ): Promise<AgentTask[]> {
    const repoPath = this.workingTreeFor(projectId) ?? process.cwd();
    const createdTasks: AgentTask[] = [];
    // Branch names are derived from the prompt, and sub-agents from one
    // fan-out have prompts that open identically. `branchNameFor` keeps
    // them apart by task id, but a tie here would cost an agent its
    // isolation, so the batch also refuses to hand out a name twice.
    const taken = new Set<string>();

    for (const taskDef of tasks) {
      const task = await this.createTask(
        sessionId,
        taskDef.prompt,
        taskDef.harness,
        projectId,
        {
          model: taskDef.model ?? null,
          agent: taskDef.agent ?? null,
          attachments: taskDef.attachments,
        },
      );

      let branch = branchNameFor(task.id, taskDef.prompt);
      for (let suffix = 2; taken.has(branch); suffix++) {
        branch = `${branchNameFor(task.id, taskDef.prompt)}-${suffix}`;
      }
      taken.add(branch);

      const created = createWorktree(repoPath, branch);
      if (created.ok && created.worktree) {
        task.branchName = branch;
        this.worktrees.set(task.id, created.worktree);
        log(
          "info",
          "orchestrator",
          `Isolated ${branch} at ${created.worktree.path}`,
          {
            taskId: task.id,
            projectId,
          },
        );
      } else {
        // Say so rather than quietly sharing a tree: the caller's whole
        // reason for asking was that these run at once.
        task.branchName = branch;
        log(
          "warn",
          "orchestrator",
          `Could not isolate ${branch} (${created.error}); running in the main checkout`,
          { taskId: task.id, projectId },
        );
      }

      this.tasks.set(task.id, task);
      createdTasks.push(task);
    }

    return createdTasks;
  }

  /**
   * Commits each finished parallel task on its own branch and merges them
   * back one at a time, stopping at the first conflict.
   *
   * Worktrees are only removed for branches that actually landed; a
   * conflicted one is left on disk so its changes can still be looked at.
   */
  async collectParallelBranches(
    taskIds: string[],
    targetBranch = "main",
    projectId: string | null = null,
  ): Promise<{
    merged: string[];
    conflicted: { branch: string; files: string[] } | null;
    skipped: string[];
  }> {
    const repoPath = this.workingTreeFor(projectId) ?? process.cwd();
    const branches: string[] = [];
    const skipped: string[] = [];

    for (const taskId of taskIds) {
      const worktree = this.worktrees.get(taskId);
      if (!worktree) {
        skipped.push(taskId);
        continue;
      }
      const task = this.tasks.get(taskId);
      const commit = commitAll(
        worktree.path,
        `hive: ${task?.prompt?.slice(0, 60) ?? taskId}`,
      );
      // An agent that changed nothing has nothing to merge — that is an
      // outcome, not a failure.
      if (!commit.ok || !commit.committed) {
        skipped.push(taskId);
        continue;
      }
      branches.push(worktree.branch);
    }

    const result = mergeAll(repoPath, branches, targetBranch);

    for (const [taskId, worktree] of this.worktrees) {
      if (!result.merged.includes(worktree.branch)) continue;
      removeWorktree(repoPath, worktree.path);
      this.worktrees.delete(taskId);
    }

    return {
      merged: result.merged,
      conflicted: result.failed
        ? {
            branch: result.failed.branch,
            files: result.failed.outcome.conflicts,
          }
        : null,
      skipped,
    };
  }

  /** The isolated checkout a parallel task runs in, if it has one. */
  worktreeFor(taskId: string): Worktree | null {
    return this.worktrees.get(taskId) ?? null;
  }

  async createSequentialBranches(
    sessionId: string,
    tasks: Array<{ prompt: string; harness?: string }>,
  ): Promise<AgentTask[]> {
    const createdTasks: AgentTask[] = [];
    for (const taskDef of tasks) {
      const task = await this.createTask(
        sessionId,
        taskDef.prompt,
        taskDef.harness,
      );
      createdTasks.push(task);
    }
    return createdTasks;
  }

  /**
   * Pushes a task branch and opens a pull request for it.
   *
   * Runs in the project's own repository rather than wherever the server
   * happens to have been started, and reports what actually went wrong —
   * "no branch", "push rejected", "gh not installed" are different
   * problems with different fixes.
   */
  async mergeToPR(
    sessionId: string,
    branchName: string,
    targetBranch: string = "main",
    projectId: string | null = null,
  ): Promise<{ url: string | null; error: string | null }> {
    const repoPath = this.workingTreeFor(projectId) ?? process.cwd();

    const exists = runGit(
      ["rev-parse", "--verify", `refs/heads/${branchName}`],
      repoPath,
    );
    if (!exists.ok) {
      return { url: null, error: `Branch ${branchName} does not exist.` };
    }

    const push = runGit(["push", "-u", "origin", branchName], repoPath);
    if (!push.ok) {
      return {
        url: null,
        error: `Could not push ${branchName}: ${push.output}`,
      };
    }

    return this.createPullRequest(
      branchName,
      targetBranch,
      repoPath,
      sessionId,
    );
  }

  private async createPullRequest(
    sourceBranch: string,
    targetBranch: string,
    repoPath: string,
    sessionId: string,
  ): Promise<{ url: string | null; error: string | null }> {
    try {
      const output = execFileSync(
        "gh",
        [
          "pr",
          "create",
          "--base",
          targetBranch,
          "--head",
          sourceBranch,
          "--title",
          `Hive: ${sourceBranch}`,
          "--body",
          `Opened by Hive from session ${sessionId}.`,
        ],
        { cwd: repoPath, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      );
      const match = output.match(/https?:\/\/\S+/);
      // A previous version invented a placeholder github.com URL here. A
      // link that goes nowhere is worse than no link: it reads as success.
      return match?.[0]
        ? { url: match[0], error: null }
        : { url: null, error: "gh created the PR but printed no URL." };
    } catch (err) {
      const e = err as { stderr?: string; message?: string };
      return {
        url: null,
        error: `gh pr create failed: ${(e.stderr ?? e.message ?? "").trim().slice(0, 300)}`,
      };
    }
  }

  /**
   * The Second Brain for a working tree, created on first use. The
   * synthesizer is attached only when a model is configured for learning;
   * with none, the layer runs on heuristics alone and still works.
   */
  brainFor(cwd: string | undefined): SecondBrain {
    const key = cwd ?? "";
    const existing = this.brains.get(key);
    if (existing) {
      // hive.config.json is a live singleton the Settings screen mutates in
      // place, so a cached brain has to re-read it rather than hold a copy.
      existing.reload();
      return existing;
    }

    const brain = new SecondBrain(this.config, cwd ?? null);
    const modelId = brain.settings.learning.model;
    if (modelId) {
      brain.learning.setSynthesizer(
        createHarnessSynthesizer(this.harnesses, modelId, cwd),
      );
    }
    this.brains.set(key, brain);
    return brain;
  }

  /** The brain for a project id, for callers that only have that. */
  brainForProject(projectId: string | null): SecondBrain {
    return this.brainFor(this.workingTreeFor(projectId));
  }

  /**
   * Detects that the task now starting is a *correction* of the previous one
   * in the same session, and records it against that earlier task.
   *
   * A correction is the strongest signal the layer gets (ticket 039-03), and
   * it can only be seen in hindsight: nothing about a finished task says the
   * user was unhappy with it — the next prompt does. So it is attributed
   * backwards, from here.
   *
   * Two guards keep this from labelling ordinary follow-up work as
   * dissatisfaction: the prompts must arrive close together, and they must
   * actually overlap in subject. "Now add the tests" is the next task;
   * "no, use a map instead" is a correction.
   */
  private recordCorrectionOfPrevious(
    task: AgentTask,
    brain: SecondBrain,
  ): void {
    const previous = this.getSessionTasks(task.sessionId)
      .filter((t) => t.id !== task.id && t.completedAt !== null)
      .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))[0];

    if (!previous) return;
    if (task.startedAt - (previous.completedAt ?? 0) > CORRECTION_WINDOW_MS)
      return;
    if (!looksLikeCorrection(previous.prompt, task.prompt)) return;

    try {
      brain.recordFeedback(
        {
          taskId: previous.id,
          prompt: previous.prompt,
          category: brain.categorize(previous.prompt),
          harness: previous.harness,
          model: previous.model,
          projectId: previous.projectId,
          sessionId: previous.sessionId,
        },
        {
          success: previous.status === "completed",
          iterations: 1,
          durationMs: (previous.completedAt ?? 0) - previous.startedAt,
          filesChanged: previous.filesChanged.length,
          error: null,
          correction: task.prompt,
        },
      );
    } catch {
      // Observation only — never allowed to affect the task being started.
    }
  }

  getPermissionManager(): PermissionManager {
    return this.permissionManager;
  }

  /** The loop's iteration ceiling, so the Office floor can draw budget pips. */
  getLoopBudget(): number {
    return this.config.loop.maxIterations;
  }

  getTask(taskId: string): AgentTask | null {
    return this.tasks.get(taskId) || null;
  }

  getSessionTasks(sessionId: string): AgentTask[] {
    const tasks: AgentTask[] = [];
    for (const task of this.tasks.values()) {
      if (task.sessionId === sessionId) {
        tasks.push(task);
      }
    }
    return tasks;
  }

  /** Every task Hive knows about, live and historical — the Office floor's roster is built from this. */
  getAllTasks(): AgentTask[] {
    return Array.from(this.tasks.values());
  }

  private setPhase(task: AgentTask, phase: TaskPhase): void {
    task.phase = phase;
    // sessionId travels with the event so Chat can attribute progress to
    // the conversation that asked for it, even from another page.
    broadcast("agent:update", {
      taskId: task.id,
      sessionId: task.sessionId,
      projectId: task.projectId,
      phase,
      harness: task.harness,
    });
  }

  /**
   * The directory a task's harness should run in. Tasks used to run in
   * the server's own working directory regardless of which project was
   * selected, so `filesChanged` described the wrong repository.
   */
  private workingTreeFor(projectId: string | null): string | undefined {
    if (!projectId) return undefined;
    // The general workspace is synthesised rather than stored, so it is
    // resolved before the table is consulted — and created on demand,
    // since a task may well be the first thing that ever touches it.
    if (isGeneralProject(projectId)) return ensureRootDirectory();
    try {
      const row = getDb()
        .prepare("SELECT path FROM projects WHERE id = ?")
        .get(projectId) as { path: string } | undefined;
      if (row?.path && fs.existsSync(row.path)) return row.path;
    } catch {
      // No database yet (or the row is gone) — fall back to the default.
    }
    return undefined;
  }

  private generateId(): string {
    return `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }
}
