import * as fs from 'fs';
import * as path from 'path';
import { Config } from './config';

export interface FileLock {
  sessionId: string;
  filePath: string;
  acquiredAt: number;
  expiresAt: number;
  mode: 'read' | 'write';
}

export interface TaskContext {
  taskId: string;
  branchName: string;
  files: string[];
  status: 'pending' | 'running' | 'completed' | 'cancelled';
  startedAt: number;
  completedAt: number | null;
}

export class ResourceManager {
  private config: Config;
  private locks: Map<string, FileLock>;
  private tasks: Map<string, TaskContext>;

  constructor(config: Config) {
    this.config = config;
    this.locks = new Map();
    this.tasks = new Map();
  }

  async acquireLock(
    sessionId: string,
    filePath: string,
    mode: 'read' | 'write' = 'read'
  ): Promise<boolean> {
    const lockKey = `${sessionId}:${filePath}`;

    // Check if lock exists and is valid
    const existing = this.locks.get(lockKey);
    if (existing) {
      // Write locks are exclusive
      if (existing.mode === 'write' || existing.sessionId === sessionId) {
        return true;
      }
      return false;
    }

    // Acquire lock
    this.locks.set(lockKey, {
      sessionId,
      filePath,
      acquiredAt: Date.now(),
      expiresAt: Date.now() + 60000, // 1 minute timeout
      mode,
    });

    return true;
  }

  async releaseLock(sessionId: string, filePath: string): Promise<void> {
    const lockKey = `${sessionId}:${filePath}`;
    this.locks.delete(lockKey);
  }

  async createTask(
    taskId: string,
    branchName: string,
    files: string[]
  ): Promise<TaskContext> {
    const task: TaskContext = {
      taskId,
      branchName,
      files,
      status: 'pending',
      startedAt: Date.now(),
      completedAt: null,
    };
    this.tasks.set(taskId, task);
    return task;
  }

  async updateTaskStatus(taskId: string, status: TaskContext['status']): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) return;

    task.status = status;
    if (status === 'completed') {
      task.completedAt = Date.now();
    }
  }

  async getTask(taskId: string): Promise<TaskContext | null> {
    return this.tasks.get(taskId) || null;
  }

  async getSessionTasks(sessionId: string): Promise<TaskContext[]> {
    const tasks: TaskContext[] = [];
    for (const task of this.tasks.values()) {
      // Session tasks are tracked separately, return all for now
      tasks.push(task);
    }
    return tasks;
  }

  async cleanup(): Promise<void> {
    const now = Date.now();

    // Clean expired locks
    for (const [key, lock] of this.locks) {
      if (now > lock.expiresAt) {
        this.locks.delete(key);
      }
    }

    // Clean completed tasks older than 1 hour
    for (const [key, task] of this.tasks) {
      if (
        task.status === 'completed' &&
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

  // Get all active locks for a file
  getFileLocks(filePath: string): FileLock[] {
    const locks: FileLock[] = [];
    for (const lock of this.locks.values()) {
      if (lock.filePath === filePath) {
        locks.push(lock);
      }
    }
    return locks;
  }
}
