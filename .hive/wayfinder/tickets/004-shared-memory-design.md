# Ticket: Shared Memory Design

**Label:** `wayfinder:grilling`
**Status:** CLOSED
**Blocked by:** None
**Resolved:** 2026-08-19

## Question

How should the shared memory store work in practice? The spec defines the TypeScript interfaces but not the runtime behavior.

**Decision needed:**

- Is shared memory a singleton, per-session, or per-query?
- How do agents read/write concurrently (async locking? optimistic? just trust Node.js event loop)?
- How is shared memory persisted (JSON snapshots? in-memory only with session save?)?
- How do agents discover what other agents have written?

**Considerations:**

- Node.js single-threaded event loop means no true race conditions
- But async operations can interleave — need to think about read-modify-write
- Shared memory is the communication backbone; if it breaks, everything breaks
- Must be lightweight — don't want memory overhead per agent per iteration

**Options:**

- A) In-memory Map with session snapshots — fast, simple, loses state on crash
- B) JSON file-backed — persistent, but file I/O on every write
- C) In-memory with periodic snapshots — fast writes, crash recovery

**Recommendation:** C) In-memory with periodic snapshots — fast for the hot path, recovers from crashes. Session save on completion.

## Resolution

**Decision: C) In-memory per-query store with save-on-completion**

### Scope: Per-Query

Each query gets its own `SharedMemory` instance. Multiple agents on the same query share one instance. Different queries are completely isolated.

```typescript
// Map of queryId → SharedMemory
const stores = new Map<string, SharedMemory>();
```

### Concurrency: Trust the Event Loop

Node.js single-threaded event loop means no true race conditions for synchronous operations. All writes to shared memory are synchronous property assignments — no mutex needed.

For async operations (compaction, harness execution), interleaving is possible but harmless: each agent writes to its own keys (`agentResults[agentId]`), so there's no contention.

Cross-agent writes (Agent B writing to Agent A's result) go through a message queue — serialized, ordered, no races.

### Persistence: Save-on-Completion + Crash Snapshots

```
In-memory (fast path)
    │
    ├── every 30s → snapshot to .hive/snapshots/{queryId}.json
    ├── on query complete → save to .hive/sessions/{queryId}.json
    └── on crash → recover from last snapshot on next startup
```

- **Hot path:** All reads/writes are in-memory Map operations
- **Periodic snapshot:** Every 30 seconds, serialize to temp file (non-blocking)
- **Session save:** On query completion, save final state to sessions directory
- **Crash recovery:** On startup, check snapshots directory, offer to resume

### Discovery: Direct Read + Event Emitter

Agents discover each other's work two ways:

1. **Direct read:** Any agent can read `sharedMemory.getAgentResult(agentId)` at any time
2. **Message subscription:** Agents subscribe to messages via EventEmitter:

```typescript
sharedMemory.on("message", (msg) => {
  if (msg.to === myAgentId || msg.to === "broadcast") {
    // handle message
  }
});
```

### Implementation

```typescript
// packages/server/src/sharedMemory.ts

import { EventEmitter } from "events";
import { writeFile, readFile } from "fs/promises";
import { join } from "path";

interface TaskContext {
  id: string;
  originalQuery: string;
  goal: string;
  status: "routing" | "looping" | "done" | "failed";
  createdAt: Date;
}

interface AgentResult {
  agentId: string;
  harness: string;
  model: string;
  rawTokens: number;
  compactedTokens: number;
  wasCompacted: boolean;
  summary: string;
  keyDecisions: string[];
  filesChanged: string[];
  errors: string[];
  blockingOn: string[];
  fullOutput?: string;
}

interface LoopState {
  iteration: number;
  history: Array<{
    action: string;
    observation: string;
    passed: boolean;
    revision?: string;
  }>;
}

interface BranchInfo {
  name: string;
  agent: string;
  status: "active" | "merged" | "conflict";
  filesChanged: string[];
}

interface Message {
  id: string;
  from: string;
  to: string | "broadcast";
  type: "result" | "request" | "blocking";
  payload: any;
  timestamp: Date;
}

export class SharedMemory extends EventEmitter {
  private taskContext: TaskContext;
  private agentResults = new Map<string, AgentResult>();
  private loopStates = new Map<string, LoopState>();
  private branches = new Map<string, BranchInfo>();
  private messages: Message[] = [];
  private snapshotTimer?: NodeJS.Timeout;

  constructor(taskContext: TaskContext) {
    super();
    this.taskContext = taskContext;
    this.startSnapshotTimer();
  }

  // --- Task Context ---
  getTaskContext(): Readonly<TaskContext> {
    return this.taskContext;
  }
  updateTaskContext(updates: Partial<TaskContext>): void {
    Object.assign(this.taskContext, updates);
  }

  // --- Agent Results ---
  getAgentResult(agentId: string): AgentResult | undefined {
    return this.agentResults.get(agentId);
  }
  setAgentResult(agentId: string, result: AgentResult): void {
    this.agentResults.set(agentId, result);
    this.emit("agent-result", { agentId, result });
  }
  getAllAgentResults(): Map<string, AgentResult> {
    return new Map(this.agentResults);
  }

  // --- Loop State ---
  getLoopState(agentId: string): LoopState | undefined {
    return this.loopStates.get(agentId);
  }
  setLoopState(agentId: string, state: LoopState): void {
    this.loopStates.set(agentId, state);
  }

  // --- Branches ---
  getBranch(branchName: string): BranchInfo | undefined {
    return this.branches.get(branchName);
  }
  setBranch(branchName: string, info: BranchInfo): void {
    this.branches.set(branchName, info);
  }
  getFileOwner(filePath: string): string | undefined {
    for (const [, branch] of this.branches) {
      if (branch.filesChanged.includes(filePath)) {
        return branch.agent;
      }
    }
    return undefined;
  }

  // --- Messages ---
  sendMessage(
    from: string,
    to: string | "broadcast",
    type: Message["type"],
    payload: any,
  ): void {
    const msg: Message = {
      id: crypto.randomUUID(),
      from,
      to,
      type,
      payload,
      timestamp: new Date(),
    };
    this.messages.push(msg);
    this.emit("message", msg);
  }
  getMessages(filter?: { to?: string; type?: string }): Message[] {
    return this.messages.filter((m) => {
      if (filter?.to && m.to !== filter.to && m.to !== "broadcast")
        return false;
      if (filter?.type && m.type !== filter.type) return false;
      return true;
    });
  }

  // --- Persistence ---
  private startSnapshotTimer(): void {
    this.snapshotTimer = setInterval(() => this.snapshot(), 30000);
  }

  async snapshot(): Promise<void> {
    const dir = join(process.cwd(), ".hive", "snapshots");
    await writeFile(
      join(dir, `${this.taskContext.id}.json`),
      JSON.stringify(this.serialize(), null, 2),
    );
  }

  async save(): Promise<void> {
    if (this.snapshotTimer) clearInterval(this.snapshotTimer);
    const dir = join(process.cwd(), ".hive", "sessions");
    await writeFile(
      join(dir, `${this.taskContext.id}.json`),
      JSON.stringify(this.serialize(), null, 2),
    );
  }

  static async load(queryId: string): Promise<SharedMemory | null> {
    try {
      const data = await readFile(
        join(process.cwd(), ".hive", "sessions", `${queryId}.json`),
        "utf-8",
      );
      const parsed = JSON.parse(data);
      const sm = new SharedMemory(parsed.taskContext);
      sm.agentResults = new Map(Object.entries(parsed.agentResults || {}));
      sm.loopStates = new Map(Object.entries(parsed.loopStates || {}));
      sm.branches = new Map(Object.entries(parsed.branches || {}));
      sm.messages = parsed.messages || [];
      return sm;
    } catch {
      return null;
    }
  }

  private serialize() {
    return {
      taskContext: this.taskContext,
      agentResults: Object.fromEntries(this.agentResults),
      loopStates: Object.fromEntries(this.loopStates),
      branches: Object.fromEntries(this.branches),
      messages: this.messages,
    };
  }
}
```

### File Structure

```
.hive/
├── snapshots/          ← periodic crash recovery
│   └── {queryId}.json
└── sessions/           ← completed query records
    └── {queryId}.json
```
