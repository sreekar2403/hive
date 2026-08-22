import { LoopEngine, LoopCallback } from './loopEngine';
import { Router } from './router';
import { PermissionManager } from './permissions';
import { ResourceManager } from './resourceManager';
import { SharedMemory } from './sharedMemory';
import { Config } from './config';
import { Harness } from '@hive/shared/harness';
import { execSync } from 'child_process';

export interface AgentTask {
  id: string;
  sessionId: string;
  prompt: string;
  harness: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  branchName: string;
  startedAt: number;
  completedAt: number | null;
  output: string;
}

export class Orchestrator {
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
    this.loopEngine = new LoopEngine(config, harnesses);
    this.router = new Router(config, harnesses);
    this.permissionManager = new PermissionManager(config);
    this.resourceManager = new ResourceManager(config);
    this.sharedMemory = new SharedMemory(config);
    this.tasks = new Map();
  }

  async createTask(sessionId: string, prompt: string, harness?: string): Promise<AgentTask> {
    const taskId = this.generateId();
    const branchName = `hive/${sessionId}/${taskId}`;

    const task: AgentTask = {
      id: taskId,
      sessionId,
      prompt,
      harness: harness || this.config.routing.default,
      status: 'pending',
      branchName,
      startedAt: Date.now(),
      completedAt: null,
      output: '',
    };

    this.tasks.set(taskId, task);
    this.resourceManager.createTask(taskId, branchName, []);
    return task;
  }

  async executeTask(taskId: string, onIteration?: LoopCallback): Promise<AgentTask> {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);

    task.status = 'running';

    // Check permissions for destructive actions
    const needsPermission = await this.permissionManager.checkPermission(
      task.sessionId,
      'execute',
      task.prompt
    );

    if (!needsPermission) {
      task.status = 'failed';
      task.output = 'Permission denied for destructive action';
      return task;
    }

    // Route to harness
    const decision = this.router.route(task.prompt);
    task.harness = decision.harness;

    // Initialize loop engine with the prompt
    this.loopEngine.start(task.prompt);

    // Execute with loop
    const callback: LoopCallback = async (iteration, output, success, filesChanged) => {
      task.output = output;

      // Update resource manager with files
      if (filesChanged?.length) {
        const existingTask = await this.resourceManager.getTask(taskId);
        if (existingTask) {
          await this.resourceManager.updateTaskStatus(taskId, 'running');
        }
      }

      if (onIteration) {
        await onIteration(iteration, output, success, filesChanged);
      }
    };

    const result = await this.loopEngine.run(callback);

    task.status = result.success ? 'completed' : 'failed';
    task.completedAt = Date.now();

    return task;
  }

  async createParallelBranches(
    sessionId: string,
    tasks: Array<{ prompt: string; harness?: string }>
  ): Promise<AgentTask[]> {
    // Create a shared branch for parallel tasks
    const branchName = `hive/${sessionId}/parallel`;

    const createdTasks: AgentTask[] = [];
    for (const taskDef of tasks) {
      const task = await this.createTask(sessionId, taskDef.prompt, taskDef.harness);
      task.branchName = branchName;
      this.tasks.set(task.id, task);
      createdTasks.push(task);
    }

    return createdTasks;
  }

  async createSequentialBranches(
    sessionId: string,
    tasks: Array<{ prompt: string; harness?: string }>
  ): Promise<AgentTask[]> {
    const createdTasks: AgentTask[] = [];
    for (const taskDef of tasks) {
      const task = await this.createTask(sessionId, taskDef.prompt, taskDef.harness);
      createdTasks.push(task);
    }
    return createdTasks;
  }

  async mergeToPR(sessionId: string, branchName: string, targetBranch: string = 'main'): Promise<string | null> {
    try {
      // Check if branch exists
      const branches = execSync('git branch --list', { encoding: 'utf-8' });
      if (!branches.includes(branchName)) {
        console.warn(`Branch ${branchName} does not exist`);
        return null;
      }

      // Push branch
      execSync(`git push origin ${branchName}`, { stdio: 'pipe' });

      // Create PR
      const prUrl = await this.createPullRequest(branchName, targetBranch);
      return prUrl;
    } catch (err) {
      console.error('Failed to create PR:', err);
      return null;
    }
  }

  private async createPullRequest(sourceBranch: string, targetBranch: string): Promise<string | null> {
    // Try GitHub CLI first
    try {
      const url = execSync(
        `gh pr create --base ${targetBranch} --head ${sourceBranch} --title "Hive: Auto PR" --body "Auto-generated PR from Hive"`,
        { encoding: 'utf-8' }
      );
      // Extract URL from output
      const match = url.match(/https?:\/\/\S+/);
      return match?.[0] || null;
    } catch {
      // Fallback: return a placeholder URL
      return `https://github.com/placeholder/repo/pull/${sourceBranch}`;
    }
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

  private generateId(): string {
    return `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }
}
