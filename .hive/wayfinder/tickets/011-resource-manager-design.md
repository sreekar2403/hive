# Ticket: Resource Manager Design

**Label:** `wayfinder:grilling`
**Status:** CLOSED
**Blocked by:** None
**Resolved:** 2026-08-19

## Question

How should the resource manager handle local LLM queuing? The spec defines the rules but not the implementation.

**Decision needed:**
- How is VRAM usage checked (Ollama API? nvidia-smi? LM Studio API?)?
- How does the lock work (mutex? semaphore? just a flag?)?
- How does the queue work (FIFO? priority-based?)?
- What happens when a local model task is denied (queue, fallback, or error)?

**Considerations:**
- Ollama has an API for model info but not VRAM usage directly
- nvidia-smi works for NVIDIA GPUs but not AMD
- LM Studio has its own API
- Need cross-platform VRAM detection (or just skip it and use a simpler approach)

**Options:**
- A) Simple flag — just a boolean "local model in use", no VRAM checking
- B) Ollama API — check model loading status, infer VRAM from model size
- C) System command — call nvidia-smi/rocm-smi for actual VRAM data

**Recommendation:** A) Simple flag for MVP — VRAM checking is nice but not essential. A boolean lock + queue is enough to prevent two local models from fighting. Add VRAM checking later.

## Resolution

**Decision: A) Simple boolean lock + FIFO queue. Cloud tasks bypass entirely.**

### Design

```
Cloud model task? ──yes──▶ run immediately (no queue)
      │
      no
      │
      ▼
Local model lock free? ──yes──▶ acquire lock, run
      │
      no
      │
      ▼
Add to FIFO queue ──▶ wait for lock ──▶ run ──▶ release lock ──▶ wake next
```

### Implementation

```typescript
// packages/server/src/resourceManager.ts

import { EventEmitter } from 'events';

interface QueuedTask {
  id: string;
  sessionId: string;
  model: string;
  resolve: () => void;
  reject: (err: Error) => void;
}

export class ResourceManager extends EventEmitter {
  private localModelInUse = false;
  private currentTask: QueuedTask | null = null;
  private queue: QueuedTask[] = [];
  private config: ResourceManagerConfig;

  constructor(config: ResourceManagerConfig = {}) {
    super();
    this.config = {
      maxConcurrentLocal: config.maxConcurrentLocal ?? 1,
      queueTimeout: config.queueTimeout ?? 60000,  // 60s
      fallbackToCloud: config.fallbackToCloud ?? false,
    };
  }

  /**
   * Acquire a resource for a task.
   * Returns immediately for cloud models, queues for local models.
   */
  async acquire(sessionId: string, model: string, isLocal: boolean): Promise<void> {
    // Cloud models bypass the queue entirely
    if (!isLocal) {
      return;
    }

    // Local model: check lock
    if (!this.localModelInUse) {
      this.localModelInUse = true;
      this.currentTask = { id: crypto.randomUUID(), sessionId, model, resolve: () => {}, reject: () => {} };
      this.emit('acquired', { sessionId, model });
      return;
    }

    // Lock held: add to queue
    return new Promise<void>((resolve, reject) => {
      const task: QueuedTask = {
        id: crypto.randomUUID(),
        sessionId,
        model,
        resolve,
        reject,
      };
      this.queue.push(task);
      this.emit('queued', { sessionId, position: this.queue.length });

      // Timeout
      if (this.config.queueTimeout > 0) {
        setTimeout(() => {
          const idx = this.queue.indexOf(task);
          if (idx >= 0) {
            this.queue.splice(idx, 1);
            reject(new Error(`Queue timeout: waited ${this.config.queueTimeout}ms`));
            this.emit('timeout', { sessionId });
          }
        }, this.config.queueTimeout);
      }
    });
  }

  /**
   * Release the local model lock.
   * Wakes the next task in queue if any.
   */
  release(sessionId?: string): void {
    if (!this.localModelInUse) return;

    // Release current task
    if (this.currentTask) {
      this.currentTask.resolve();
      this.currentTask = null;
    }

    // Wake next in queue
    if (this.queue.length > 0) {
      const next = this.queue.shift()!;
      this.currentTask = next;
      this.emit('acquired', { sessionId: next.sessionId, model: next.model });
    } else {
      this.localModelInUse = false;
      this.emit('released', { sessionId });
    }
  }

  /**
   * Force-release (e.g., on cancellation).
   */
  forceRelease(): void {
    if (this.currentTask) {
      this.currentTask.reject(new Error('Force released'));
      this.currentTask = null;
    }
    this.localModelInUse = false;
    this.emit('force-released');
  }

  /**
   * Cancel a queued task (e.g., session cancelled).
   */
  cancel(sessionId: string): void {
    const idx = this.queue.findIndex(t => t.sessionId === sessionId);
    if (idx >= 0) {
      const task = this.queue.splice(idx, 1)[0];
      task.reject(new Error('Task cancelled'));
      this.emit('cancelled', { sessionId });
    }
  }

  // --- Status ---

  isLocked(): boolean {
    return this.localModelInUse;
  }

  getQueueLength(): number {
    return this.queue.length;
  }

  getStatus(): ResourceManagerStatus {
    return {
      locked: this.localModelInUse,
      currentTask: this.currentTask ? {
        sessionId: this.currentTask.sessionId,
        model: this.currentTask.model,
      } : null,
      queueLength: this.queue.length,
      queue: this.queue.map(t => ({ sessionId: t.sessionId, model: t.model })),
    };
  }
}

interface ResourceManagerConfig {
  maxConcurrentLocal?: number;   // default: 1
  queueTimeout?: number;         // ms, default: 60000
  fallbackToCloud?: boolean;     // default: false
}

interface ResourceManagerStatus {
  locked: boolean;
  currentTask: { sessionId: string; model: string } | null;
  queueLength: number;
  queue: Array<{ sessionId: string; model: string }>;
}
```

### Integration with Orchestrator

```typescript
// In orchestrator.ts — handleQuery()

async handleQuery(sessionId: string, query: string): Promise<void> {
  // ... routing, etc.

  const isLocal = route.model.startsWith('ollama:') || route.model.startsWith('lmstudio:');
  const modelName = route.model.replace(/^(ollama:|lmstudio:)/, '');

  try {
    // Acquire resource (blocks if local model is busy)
    await this.resourceManager.acquire(sessionId, modelName, isLocal);

    // Run loop
    await this.loopEngine.run({ ... });

  } finally {
    // Release resource
    this.resourceManager.release(sessionId);
  }
}
```

### Queue Events (broadcast to UI)

```typescript
resourceManager.on('queued', ({ sessionId, position }) => {
  broadcast(sessionId, {
    type: 'session:status',
    sessionId,
    payload: { status: `queued (position ${position})` },
  });
});

resourceManager.on('acquired', ({ sessionId, model }) => {
  broadcast(sessionId, {
    type: 'session:status',
    sessionId,
    payload: { status: `running (${model})` },
  });
});
```

### Config

```yaml
# config/default.yaml
resource_limits:
  max_concurrent_local: 1
  queue_timeout: 60000        # 60 seconds
  fallback_to_cloud: false    # if true, use cloud model when queue times out
```
