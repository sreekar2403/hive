import { Config } from "./config";

/**
 * Per-task bookkeeping: which branch a task owns and where it is in its
 * lifecycle.
 *
 * There used to be a file-lock API here (acquireLock/releaseLock/
 * getFileLocks) that nothing ever called. Concurrency safety comes from
 * git worktree isolation instead — see branches.ts — and the lock key was
 * `${sessionId}:${filePath}`, so two different sessions locking the same
 * file got different keys and both succeeded. A lock that cannot catch
 * cross-actor conflicts is worse than no lock, because the next person to
 * find it assumes it works; it has been removed rather than repaired.
 */

export interface TaskContext {
  taskId: string;
  branchName: string;
  files: string[];
  status: "pending" | "running" | "completed" | "cancelled";
  startedAt: number;
  completedAt: number | null;
}

export class ResourceManager {
  private config: Config;
  private tasks: Map<string, TaskContext>;

  constructor(config: Config) {
    this.config = config;
    this.tasks = new Map();
  }

  async createTask(
    taskId: string,
    branchName: string,
    files: string[],
  ): Promise<TaskContext> {
    const task: TaskContext = {
      taskId,
      branchName,
      files,
      status: "pending",
      startedAt: Date.now(),
      completedAt: null,
    };
    this.tasks.set(taskId, task);
    return task;
  }

  async updateTaskStatus(
    taskId: string,
    status: TaskContext["status"],
  ): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) return;

    task.status = status;
    if (status === "completed") {
      task.completedAt = Date.now();
    }
  }

  async getTask(taskId: string): Promise<TaskContext | null> {
    return this.tasks.get(taskId) || null;
  }

  async getSessionTasks(_sessionId: string): Promise<TaskContext[]> {
    const tasks: TaskContext[] = [];
    for (const task of this.tasks.values()) {
      // Session tasks are tracked separately, return all for now
      tasks.push(task);
    }
    return tasks;
  }

  async cleanup(): Promise<void> {
    const now = Date.now();

    // Clean completed tasks older than 1 hour
    for (const [key, task] of this.tasks) {
      if (
        task.status === "completed" &&
        task.completedAt &&
        now - task.completedAt > 3600000
      ) {
        this.tasks.delete(key);
      }
    }
  }

  // Check if files overlap between tasks
  hasFileOverlap(taskId1: string, taskId2: string): boolean {
    const task1 = this.tasks.get(taskId1);
    const task2 = this.tasks.get(taskId2);

    if (!task1 || !task2) return false;

    const files1 = new Set(task1.files);
    const files2 = new Set(task2.files);

    for (const file of files2) {
      if (files1.has(file)) return true;
    }

    return false;
  }

}
