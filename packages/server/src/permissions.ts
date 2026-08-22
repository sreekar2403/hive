import { Config } from './config';

export interface PermissionRequest {
  id: string;
  sessionId: string;
  action: string;
  description: string;
  command?: string;
  files?: string[];
  timestamp: number;
  approved: boolean | null;
  timeoutAt: number;
}

export class PermissionManager {
  private config: Config;
  private pending: Map<string, PermissionRequest>;

  constructor(config: Config) {
    this.config = config;
    this.pending = new Map();
  }

  async checkPermission(
    sessionId: string,
    action: string,
    description: string,
    command?: string,
    files?: string[]
  ): Promise<boolean> {
    if (!this.config.permission.enabled) return true;

    // Check if this is a destructive action
    if (!this.isDestructive(action)) return true;

    // Create permission request
    const request: PermissionRequest = {
      id: this.generateId(),
      sessionId,
      action,
      description,
      command,
      files,
      timestamp: Date.now(),
      approved: null,
      timeoutAt: Date.now() + this.config.permission.timeout,
    };

    this.pending.set(request.id, request);

    // Wait for approval (with timeout)
    return new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => {
        this.pending.delete(request.id);
        resolve(false);
      }, this.config.permission.timeout);

      // Check if already approved (for testing)
      const existing = this.pending.get(request.id);
      if (existing && existing.approved !== null) {
        clearTimeout(timeout);
        this.pending.delete(request.id);
        resolve(existing.approved);
      }
    });
  }

  approve(requestId: string): boolean {
    const request = this.pending.get(requestId);
    if (!request) return false;

    request.approved = true;
    this.pending.delete(requestId);
    return true;
  }

  deny(requestId: string, reason?: string): boolean {
    const request = this.pending.get(requestId);
    if (!request) return false;

    request.approved = false;
    this.pending.delete(requestId);
    return true;
  }

  getPending(sessionId?: string): PermissionRequest[] {
    if (sessionId) {
      const request = this.pending.get(sessionId);
      return request ? [request] : [];
    }
    return Array.from(this.pending.values());
  }

  isDestructive(action: string): boolean {
    const lowerAction = action.toLowerCase();
    return this.config.permission.destructiveActions.some((pattern) =>
      lowerAction.includes(pattern.toLowerCase())
    );
  }

  private generateId(): string {
    return `perm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }
}
