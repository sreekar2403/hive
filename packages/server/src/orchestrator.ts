import { LoopEngine, LoopCallback } from "./loopEngine";
import { Router, type RoutingResult } from "./router";
import { PermissionManager } from "./permissions";
import { ResourceManager } from "./resourceManager";
import { SharedMemory } from "./sharedMemory";
import { Config } from "./config";
import { Harness, HarnessEvent } from "@hive/shared/harness";
import { execSync } from "child_process";
import * as fs from "fs";
import { getDb } from "./db/database";
import { broadcast } from "./routes/events";
import { endSpan, log, recordSpan, startSpan } from "./telemetry";
import { ensureRootDirectory, isGeneralProject } from "./generalWorkspace";

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
}

/** A long run can emit thousands of events; the trail keeps the newest. */
const MAX_TASK_EVENTS = 300;

/**
 * How long an agent lingers in Intake before moving to the zone its work
 * belongs in. The Office floor animates a character walking between
 * zones; without a beat here the two phase changes land in the same tick
 * and the walk is never seen.
 */
const INTAKE_DWELL_MS = 900;

function dwell(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Which zone a task's work belongs in, inferred from the prompt itself —
 * the same kind of keyword heuristic Router uses to pick a harness. This
 * keeps the Office floor honest: an agent standing in the QA Lab means the
 * prompt actually mentioned tests, not that a dice roll put them there.
 */
function classifyWorkPhase(prompt: string): TaskPhase {
  const p = prompt.toLowerCase();
  if (/\b(test|spec|assert|expect|qa|verify|validate|jest|vitest|mocha)\b/.test(p)) {
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
  private loopEngine: LoopEngine;
  private router: Router;
  private permissionManager: PermissionManager;
  private resourceManager: ResourceManager;
  private sharedMemory: SharedMemory;
  private tasks: Map<string, AgentTask>;

  constructor(config: Config, harnesses: Map<string, Harness>) {
    this.config = config;
    this.harnesses = harnesses;
    this.router = new Router(config, harnesses);
    this.loopEngine = new LoopEngine(config, harnesses, this.router);
    this.permissionManager = new PermissionManager(config);
    this.resourceManager = new ResourceManager(config);
    this.sharedMemory = new SharedMemory(config);
    this.tasks = new Map();
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
    selection?: { model?: string | null; agent?: string | null },
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

    // Check permissions for destructive actions. The prompt itself is what's
    // scanned for destructive keywords, not a fixed action label. When it's
    // genuinely going to wait on a human, surface that as the Conference
    // Room rather than leaving the agent parked in Intake.
    const awaitingApproval =
      this.config.permission.enabled &&
      this.permissionManager.isDestructive(task.prompt);
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

    // Route to harness. A harness pinned by the caller wins outright —
    // the Chat composer's "Harness" control used to be quietly ignored.
    const routeStart = Date.now();
    const pinned =
      task.requestedHarness && this.harnesses.has(task.requestedHarness)
        ? task.requestedHarness
        : null;
    const decision: RoutingResult = pinned
      ? { harness: pinned, model: "", reasoning: "Pinned by the caller" }
      : this.router.route(task.prompt);
    task.harness = decision.harness;
    recordSpan(
      task.id,
      pinned ? `Pinned to ${decision.harness}` : `Routed to ${decision.harness}`,
      "route",
      rootSpan,
      routeStart,
      "ok",
      {
        harness: decision.harness,
        model: decision.model,
        reasoning: decision.reasoning,
      },
    );
    log("info", "router", `Routed to ${decision.harness}: ${decision.reasoning}`, {
      taskId: task.id,
      projectId: task.projectId,
    });

    // Which zone the work itself belongs in — see classifyWorkPhase. The
    // pause lets the floor show the walk out of Intake rather than
    // teleporting the character mid-frame.
    await dwell(INTAKE_DWELL_MS);
    this.setPhase(task, classifyWorkPhase(task.prompt));

    // Initialize loop engine with the prompt
    this.loopEngine.start(task.prompt);

    // Execute with loop
    const callback: LoopCallback = async (
      iteration,
      output,
      success,
      filesChanged,
    ) => {
      task.output = output;

      // Update resource manager with files
      if (filesChanged?.length) {
        task.filesChanged = filesChanged;
        const existingTask = await this.resourceManager.getTask(taskId);
        if (existingTask) {
          await this.resourceManager.updateTaskStatus(taskId, "running");
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

    const result = await this.loopEngine.run(
      callback,
      task.id,
      rootSpan,
      task.projectId,
      {
        cwd: this.workingTreeFor(task.projectId),
        harness: pinned ?? undefined,
        model: task.model ?? undefined,
        agent: task.agent ?? undefined,
        // Tool calls and thinking reach the chat window through here.
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

    task.status = result.success ? "completed" : "failed";
    task.completedAt = Date.now();

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

  async createParallelBranches(
    sessionId: string,
    tasks: Array<{ prompt: string; harness?: string }>,
  ): Promise<AgentTask[]> {
    // Create a shared branch for parallel tasks
    const branchName = `hive/${sessionId}/parallel`;

    const createdTasks: AgentTask[] = [];
    for (const taskDef of tasks) {
      const task = await this.createTask(
        sessionId,
        taskDef.prompt,
        taskDef.harness,
      );
      task.branchName = branchName;
      this.tasks.set(task.id, task);
      createdTasks.push(task);
    }

    return createdTasks;
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

  async mergeToPR(
    sessionId: string,
    branchName: string,
    targetBranch: string = "main",
  ): Promise<string | null> {
    try {
      // Check if branch exists
      const branches = execSync("git branch --list", { encoding: "utf-8" });
      if (!branches.includes(branchName)) {
        console.warn(`Branch ${branchName} does not exist`);
        return null;
      }

      // Push branch
      execSync(`git push origin ${branchName}`, { stdio: "pipe" });

      // Create PR
      const prUrl = await this.createPullRequest(branchName, targetBranch);
      return prUrl;
    } catch (err) {
      console.error("Failed to create PR:", err);
      return null;
    }
  }

  private async createPullRequest(
    sourceBranch: string,
    targetBranch: string,
  ): Promise<string | null> {
    // Try GitHub CLI first
    try {
      const url = execSync(
        `gh pr create --base ${targetBranch} --head ${sourceBranch} --title "Hive: Auto PR" --body "Auto-generated PR from Hive"`,
        { encoding: "utf-8" },
      );
      // Extract URL from output
      const match = url.match(/https?:\/\/\S+/);
      return match?.[0] || null;
    } catch {
      // Fallback: return a placeholder URL
      return `https://github.com/placeholder/repo/pull/${sourceBranch}`;
    }
  }

  getPermissionManager(): PermissionManager {
    return this.permissionManager;
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
