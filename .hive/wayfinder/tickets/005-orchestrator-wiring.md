# Ticket: Orchestrator Wiring

**Label:** `wayfinder:grilling`
**Status:** CLOSED
**Blocked by:** 002-cli-harness-abstraction, 003-loop-engine-core, 004-shared-memory-design
**Resolved:** 2026-08-19

## Question

How does the orchestrator connect all components? The spec shows the architecture diagram but not the data flow.

**Decision needed:**

- What is the orchestrator's main loop? (receive query → route → loop → result?)
- How does it handle multiple concurrent queries (multi-session)?
- How does it stream progress to the UI?
- How does it manage agent lifecycle (spawn, monitor, kill)?

**Considerations:**

- Orchestrator is the central nervous system — every component touches it
- Must handle multiple sessions simultaneously (sidebar feature)
- Must stream real-time updates to UI via WebSocket
- Must manage resource contention (local LLM lock, file conflicts)

**Options:**

- A) Event-driven — orchestrator emits events, components subscribe
- B) Pipeline — query flows through a pipeline of middleware-like functions
- C) Command pattern — each action is a command object, orchestrator dispatches

**Recommendation:** A) Event-driven — natural fit for WebSocket streaming, easy to add/remove components, clear data flow.

## Resolution

**Decision: A) Event-driven orchestrator as coordinator**

The orchestrator is the central nervous system. It doesn't do work — it coordinates components. Each query flows through a clear lifecycle, and the orchestrator emits events at each stage for the WebSocket layer to broadcast.

### Data Flow

```
UI (WebSocket)
    │
    │ query submitted
    ▼
┌───────────────────────────────────────────────────────┐
│                     ORCHESTRATOR                       │
│                                                       │
│  1. receiveQuery(query)                               │
│     │                                                 │
│     ├─▶ router.route(query) → { harness, model }     │
│     │                                                 │
│     ├─▶ new SharedMemory(query)                       │
│     │                                                 │
│     ├─▶ resourceManager.acquire(harness)              │
│     │                                                 │
│     ├─▶ loopEngine.run({                              │
│     │       goal, harness, sharedMemory,              │
│     │       onEvent → broadcast to WebSocket          │
│     │   })                                            │
│     │                                                 │
│     ├─▶ compactor.compact(sharedMemory)               │
│     │                                                 │
│     ├─▶ branchManager.createPR(sharedMemory)          │
│     │                                                 │
│     └─▶ sharedMemory.save()                           │
│                                                       │
└───────────────────────────────────────────────────────┘
    │
    │ result events streamed via WebSocket
    ▼
UI (updates in real-time)
```

### Multi-Session Management

```typescript
// packages/server/src/orchestrator.ts

import { EventEmitter } from "events";
import { Router } from "./router";
import { LoopEngine } from "./loopEngine";
import { SharedMemory } from "./sharedMemory";
import { ResourceManager } from "./resourceManager";
import { BranchManager } from "./branchManager";
import { ContextCompactor } from "./compactor";
import { Harness } from "@hive/shared";

interface Session {
  id: string;
  query: string;
  status: "routing" | "looping" | "compacting" | "merging" | "done" | "failed";
  sharedMemory: SharedMemory;
  startedAt: Date;
}

export class Orchestrator extends EventEmitter {
  private sessions = new Map<string, Session>();
  private router: Router;
  private loopEngine: LoopEngine;
  private resourceManager: ResourceManager;
  private branchManager: BranchManager;
  private compactor: ContextCompactor;
  private harnesses: Map<string, Harness>;

  constructor(harnesses: Harness[]) {
    super();
    this.router = new Router();
    this.loopEngine = new LoopEngine();
    this.resourceManager = new ResourceManager();
    this.branchManager = new BranchManager();
    this.compactor = new ContextCompactor();
    this.harnesses = new Map(harnesses.map((h) => [h.name, h]));
  }

  async handleQuery(sessionId: string, query: string): Promise<void> {
    // 1. Create session
    const session: Session = {
      id: sessionId,
      query,
      status: "routing",
      sharedMemory: new SharedMemory({
        id: sessionId,
        originalQuery: query,
        goal: query,
        status: "routing",
        createdAt: new Date(),
      }),
      startedAt: new Date(),
    };
    this.sessions.set(sessionId, session);
    this.emit("session:start", session);

    try {
      // 2. Route
      const route = this.router.route(query);
      this.emit("session:routed", { sessionId, route });

      // 3. Acquire resources (local LLM lock if needed)
      await this.resourceManager.acquire(route.harness);

      // 4. Get harness
      const harness = this.harnesses.get(route.harness);
      if (!harness) throw new Error(`Harness not found: ${route.harness}`);

      // 5. Set model
      if (harness.capabilities.modelSelection && route.model) {
        harness.setModel(route.model);
      }

      // 6. Run loop
      session.status = "looping";
      session.sharedMemory.updateTaskContext({ status: "looping" });

      const loopResult = await this.loopEngine.run({
        goal: query,
        harness,
        sharedMemory: session.sharedMemory,
        maxIterations: 5,
        timeout: 300000,
        onEvent: (event) => this.emit("loop:event", { sessionId, ...event }),
      });

      // 7. Compact results
      session.status = "compacting";
      await this.compactor.compact(session.sharedMemory);

      // 8. Create branch + PR (if in a git repo)
      session.status = "merging";
      try {
        const pr = await this.branchManager.createPR(session.sharedMemory);
        this.emit("session:pr", { sessionId, pr });
      } catch (e) {
        // not in a git repo or PR creation failed — skip
        this.emit("session:pr-skipped", { sessionId, reason: e.message });
      }

      // 9. Save session
      session.status = loopResult.success ? "done" : "failed";
      session.sharedMemory.updateTaskContext({ status: session.status });
      await session.sharedMemory.save();

      this.emit("session:done", { sessionId, result: loopResult });
    } catch (error) {
      session.status = "failed";
      session.sharedMemory.updateTaskContext({ status: "failed" });
      await session.sharedMemory.save();
      this.emit("session:error", { sessionId, error: error.message });
    } finally {
      this.resourceManager.release();
    }
  }

  cancelSession(sessionId: string): void {
    this.loopEngine.cancel(sessionId);
    this.sessions.delete(sessionId);
    this.emit("session:cancelled", { sessionId });
  }

  getSession(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  getAllSessions(): Session[] {
    return Array.from(this.sessions.values());
  }
}
```

### Event Types (broadcast to UI)

```typescript
type OrchestratorEvent =
  | { type: "session:start"; sessionId: string; query: string }
  | { type: "session:routed"; sessionId: string; route: Route }
  | { type: "loop:event"; sessionId: string; loopEvent: LoopEvent }
  | { type: "session:pr"; sessionId: string; pr: PRInfo }
  | { type: "session:done"; sessionId: string; result: LoopResult }
  | { type: "session:error"; sessionId: string; error: string }
  | { type: "permission:requested"; sessionId: string; command: string }
  | { type: "permission:response"; sessionId: string; allowed: boolean };
```

### Resource Lifecycle

```
query arrives
    │
    ├─▶ resourceManager.acquire(harness)
    │    ├─ if cloud model → immediate
    │    └─ if local model → check lock → queue if busy
    │
    ├─▶ loop runs (may be long)
    │
    └─▶ finally: resourceManager.release()
         └─ if queued tasks waiting → wake next
```

### Cancellation

When user cancels a session:

1. `loopEngine.cancel(sessionId)` — stops the current harness execution (kills child process)
2. Session removed from `sessions` map
3. Resource released
4. `session:cancelled` event emitted
