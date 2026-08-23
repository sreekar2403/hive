import { LoopEngine, LoopCallback } from "./loopEngine";
import { Router } from "./router";
import { PermissionManager } from "./permissions";
import { ResourceManager } from "./resourceManager";
import { SharedMemory } from "./sharedMemory";
import { Config } from "./config";
import { Harness } from "@hive/shared/harness";
import { execSync } from "child_process";
import { broadcast } from "./routes/events";

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

    const needsPermission = await this.permissionManager.checkPermission(
      task.sessionId,
      task.prompt,
      task.prompt,
    );

    if (!needsPermission) {
      task.status = "failed";
      task.output = "Permission denied for destructive action";
      // The request was resolved — denied, or timed out with nobody there
      // to approve it — so the agent isn't waiting on anything anymore.
      this.setPhase(task, "break-room");
      return task;
    }

    // Route to harness
    const decision = this.router.route(task.prompt);
    task.harness = decision.harness;

    // Which zone the work itself belongs in — see classifyWorkPhase.
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
        phase: task.phase,
        harness: task.harness,
      });

      if (onIteration) {
        await onIteration(iteration, output, success, filesChanged);
      }
    };

    const result = await this.loopEngine.run(callback);

    task.status = result.success ? "completed" : "failed";
    task.completedAt = Date.now();

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
    broadcast("agent:update", { taskId: task.id, phase, harness: task.harness });
  }

  private generateId(): string {
    return `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }
}
