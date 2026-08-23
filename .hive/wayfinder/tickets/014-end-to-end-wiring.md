# Ticket: End-to-End Wiring

**Label:** `wayfinder:task`
**Status:** CLOSED
**Blocked by:** 001-project-scaffold, 002-cli-harness-abstraction, 003-loop-engine-core, 004-shared-memory-design, 005-orchestrator-wiring, 007-websocket-protocol, 008-react-app-setup
**Resolved:** 2026-08-19

## Question

How should all components be wired together for the first working demo? This is the integration ticket — everything connects here.

**Decision needed:**

- What is the minimal viable flow (query → one agent → result → UI)?
- What is the startup sequence (server → UI → WebSocket → ready?)?
- How are errors surfaced to the user?
- What does the first working demo look like?

**Considerations:**

- Must work end-to-end before adding complexity
- First demo should prove the loop works with one harness
- UI can be minimal (just chat, no agent panel yet)
- Config can be hardcoded initially

**Options:**

- A) Vertical slice — one harness, one loop, minimal UI
- B) Horizontal slice — all components, stub implementations
- C) Walking skeleton — full flow, all real implementations, simplest possible

**Recommendation:** C) Walking skeleton — full flow with real implementations. Proves everything works together, no stubs to replace later.

## Resolution

**Decision: C) Walking skeleton — full flow, all real implementations, simplest possible**

### What the First Demo Does

1. User types a query in the chat UI
2. Server receives query via WebSocket
3. Router picks harness/model (opencode/sonnet for most queries)
4. Loop engine runs: sends prompt to opencode CLI, captures output
5. Verifier checks if output looks like success (exit code 0, no errors)
6. If not successful, REVISE constructs a new prompt, loops
7. Output streams to UI in real-time
8. When done, session saved to disk
9. Summary displayed in chat

### Minimal Viable Flow

```
User: "create a hello world function in TypeScript"
    │
    ▼
[WebSocket] query:submit
    │
    ▼
[Server] orchestrator.handleQuery()
    │
    ├─▶ router.route() → { harness: 'opencode', model: 'sonnet' }
    │
    ├─▶ sharedMemory created
    │
    ├─▶ loopEngine.run()
    │   │
    │   ├─▶ ITERATION 1:
    │   │   ├─ prompt: "create a hello world function in TypeScript"
    │   │   ├─ harness.execute() → streams output
    │   │   ├─ output: "Created src/hello.ts with export function hello()..."
    │   │   ├─ verify: exit code 0, no errors → PASSED
    │   │   └─ done
    │   │
    │   └─▶ result: { success: true, filesChanged: ['src/hello.ts'] }
    │
    ├─▶ sharedMemory.save()
    │
    └─▶ [WebSocket] session:done + chat:message
    │
    ▼
UI shows: "Done — created src/hello.ts"
```

### Startup Sequence

```typescript
// packages/server/src/index.ts

import http from "http";
import { Orchestrator } from "./orchestrator";
import { HiveWSServer } from "./wsServer";
import { OpenCodeHarness } from "./harnesses/opencode";
import { ClaudeCodeHarness } from "./harnesses/claudeCode";
import { PiHarness } from "./harnesses/pi";
import { loadConfig } from "./config";
import { resolve } from "path";

async function main() {
  // 1. Load config
  const config = loadConfig();
  console.log("Config loaded:", config.routing.default);

  // 2. Initialize harnesses
  const harnesses = [
    new OpenCodeHarness(),
    new ClaudeCodeHarness(),
    new PiHarness(),
  ];

  // Check which harnesses are available
  for (const h of harnesses) {
    const available = await h.isAvailable();
    console.log(`Harness ${h.name}: ${available ? "available" : "NOT FOUND"}`);
  }

  // 3. Create orchestrator
  const orchestrator = new Orchestrator(harnesses);

  // 4. Create HTTP server (serves UI in production)
  const server = http.createServer((req, res) => {
    // In production: serve static files from packages/ui/dist
    // In dev: Vite dev server handles this
    res.writeHead(200);
    res.end("Hive server running");
  });

  // 5. Attach WebSocket server
  const wsServer = new HiveWSServer(server, orchestrator);

  // 6. Start listening
  const PORT = process.env.HIVE_PORT || 3000;
  server.listen(PORT, () => {
    console.log(`Hive server running on http://localhost:${PORT}`);
    console.log("Ready for queries.");
  });
}

main().catch(console.error);
```

### Dev Workflow

```json
// packages/server/package.json
{
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js"
  }
}
```

```json
// packages/ui/package.json
{
  "scripts": {
    "dev": "vite --port 5173",
    "build": "tsc && vite build",
    "preview": "vite preview"
  }
}
```

```json
// hive/package.json (root)
{
  "scripts": {
    "dev": "concurrently \"npm run dev -w packages/server\" \"npm run dev -w packages/ui\"",
    "build": "npm run build -w packages/ui && npm run build -w packages/server",
    "start": "npm run start -w packages/server"
  }
}
```

### Error Surfacing

```typescript
// Errors flow through the same WebSocket events

// Harness crash
orchestrator.on("session:error", ({ sessionId, error }) => {
  wsServer.broadcast(sessionId, {
    type: "session:error",
    sessionId,
    payload: { error },
    id: crypto.randomUUID(),
    timestamp: Date.now(),
  });
});

// Loop timeout
loopEngine.on("iteration:timeout", ({ sessionId, iteration }) => {
  wsServer.broadcast(sessionId, {
    type: "chat:message",
    sessionId,
    payload: {
      role: "assistant",
      content: `Iteration ${iteration} timed out. Retrying...`,
    },
    id: crypto.randomUUID(),
    timestamp: Date.now(),
  });
});

// Permission timeout
permissionSystem.on("timeout", ({ sessionId }) => {
  wsServer.broadcast(sessionId, {
    type: "permission:timeout",
    sessionId,
    payload: { requestId },
    id: crypto.randomUUID(),
    timestamp: Date.now(),
  });
});
```

### UI Minimal viable components

```
packages/ui/src/
├── App.tsx                 ← connects WebSocket, renders Layout
├── components/
│   ├── Layout.tsx          ← sidebar + main
│   ├── Sidebar.tsx         ← session list
│   ├── Chat.tsx            ← message list + input
│   └── ChatInput.tsx       ← text input + send button
├── stores/
│   └── sessions.ts         ← session state
├── hooks/
│   └── useWebSocket.ts     ← WebSocket connection
└── types.ts                ← shared types
```

### What's NOT in the Walking Skeleton (deferred)

- Agent activity panel (expandable)
- Settings modal
- Multiple harnesses (only opencode works in demo)
- Context compaction (skip for first run)
- Resource manager queueing (only one task at a time)
- Branch manager / PR creation
- Config files (hardcoded defaults)
- Local LLM support (cloud only for demo)

### Build Order

1. **packages/shared** — types, protocol, harness interface
2. **packages/server** — config → sharedMemory → permissions → harness → loopEngine → router → resourceManager → compactor → branchManager → orchestrator → wsServer → index
3. **packages/ui** — stores → hooks → components → App
4. **Root** — package.json scripts, concurrently setup
5. **Test** — run `npm run dev`, type a query, see it work

### Definition of Done

- [ ] `npm run dev` starts server + UI
- [ ] UI loads at http://localhost:5173
- [ ] Typing a query sends it to server
- [ ] Server routes to opencode/sonnet
- [ ] Loop engine runs at least one iteration
- [ ] Output streams to UI in real-time
- [ ] Session completes with summary
- [ ] Session saved to disk
