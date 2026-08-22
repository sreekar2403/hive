# Ticket: WebSocket Protocol

**Label:** `wayfinder:task`
**Status:** CLOSED
**Blocked by:** None
**Resolved:** 2026-08-19

## Question

What should the WebSocket message protocol look like between server and UI? This is the contract that makes real-time agent activity work.

**Decision needed:**
- What message types exist (agent-update, permission-request, chat-message, etc.)?
- What is the payload shape for each type?
- How does the UI know which session a message belongs to?
- How does the server handle UI disconnection/reconnection?

**Considerations:**
- Must support multiple concurrent sessions
- Must be typed (TypeScript interfaces for messages)
- Must handle out-of-order delivery (WebSocket doesn't guarantee ordering)
- Must be extensible for new message types

**Options:**
- A) Flat messages — each message has a `type` field, flat payload
- B) Envelope pattern — outer envelope with session/id, inner payload
- C) RPC-style — request/response with method names

**Recommendation:** B) Envelope pattern — session routing is a first-class concern, not a hack.

## Resolution

**Decision: B) Envelope pattern with typed message unions**

### Envelope Structure

Every message (both directions) uses the same envelope:

```typescript
// packages/shared/src/protocol.ts

interface Envelope<T extends string = string, P = unknown> {
  id: string;           // unique message ID for dedup/ordering
  sessionId: string;    // which session this belongs to
  type: T;              // message type discriminator
  payload: P;           // type-specific payload
  timestamp: number;    // Date.now()
}
```

### Server → UI Messages

```typescript
type ServerMessage =
  | Envelope<'session:created', { sessionId: string; query: string }>
  | Envelope<'session:routed', { harness: string; model: string; source: string }>
  | Envelope<'agent:started', { agentId: string; harness: string; model: string }>
  | Envelope<'agent:output', { agentId: string; chunk: string }>
  | Envelope<'agent:completed', { agentId: string; summary: string; filesChanged: string[] }>
  | Envelope<'agent:error', { agentId: string; error: string }>
  | Envelope<'loop:iteration', { agentId: string; iteration: number; maxIterations: number; state: string }>
  | Envelope<'loop:verify', { agentId: string; passed: boolean; reason: string }>
  | Envelope<'permission:requested', { requestId: string; command: string; reason: string }>
  | Envelope<'permission:timeout', { requestId: string }>
  | Envelope<'session:pr', { prUrl: string; prNumber: number }>
  | Envelope<'session:done', { success: boolean; summary: string }>
  | Envelope<'session:error', { error: string }>
  | Envelope<'session:status', { status: string }>
  | Envelope<'chat:message', { role: 'assistant'; content: string }>;
```

### UI → Server Messages

```typescript
type ClientMessage =
  | Envelope<'query:submit', { query: string }>
  | Envelope<'query:cancel', {}>
  | Envelope<'permission:respond', { requestId: string; allowed: boolean; remember?: boolean }>
  | Envelope<'session:select', { sessionId: string }>
  | Envelope<'session:list', {}>
  | Envelope<'settings:update', { settings: Partial<Settings> }>;
```

### Message Flow: Query → Response

```
UI                              Server
│                               │
│── query:submit ──────────────▶│
│                               │── session:created ──────────▶│
│                               │── session:routed ───────────▶│
│                               │── agent:started ────────────▶│
│                               │── loop:iteration ───────────▶│
│                               │── agent:output (stream) ────▶│
│                               │── agent:output (stream) ────▶│
│                               │── loop:verify ──────────────▶│
│                               │── loop:iteration ───────────▶│
│                               │── agent:output (stream) ────▶│
│                               │── agent:completed ──────────▶│
│                               │── session:done ─────────────▶│
│                               │── chat:message ─────────────▶│
│                               │
│◀── (all via WebSocket) ──────│
```

### Permission Flow

```
UI                              Server
│                               │
│◀── permission:requested ─────│  (server detected destructive cmd)
│                               │
│── permission:respond ────────▶│  (user clicks Allow/Deny)
│                               │
│   if allowed:                 │── resume execution
│   if denied:                  │── inject denial, REVISE loop
│   if timeout (30s):           │── auto-deny, REVISE loop
│                               │
│◀── permission:timeout ───────│  (only if UI didn't respond)
```

### Reconnection Handling

```
UI disconnects
    │
    ▼
Server marks session as "disconnected"
    │
UI reconnects
    │
    ▼
UI sends: session:list
    │
    ▼
Server responds with all active sessions + status
    │
    ▼
UI sends: session:select { sessionId }
    │
    ▼
Server replays missed events from session history (last 100 events)
    │
    ▼
UI resumes display
```

### Implementation

```typescript
// packages/server/src/wsServer.ts

import { WebSocketServer, WebSocket } from 'ws';
import { Orchestrator } from './orchestrator';

export class HiveWSServer {
  private wss: WebSocketServer;
  private orchestrator: Orchestrator;
  private clients = new Map<string, WebSocket>(); // sessionId → ws

  constructor(server: http.Server, orchestrator: Orchestrator) {
    this.wss = new WebSocketServer({ server });
    this.orchestrator = orchestrator;
    this.setupConnection();
    this.setupOrchestratorEvents();
  }

  private setupConnection(): void {
    this.wss.on('connection', (ws) => {
      ws.on('message', (data) => {
        const msg: ClientMessage = JSON.parse(data.toString());
        this.handleClientMessage(ws, msg);
      });

      ws.on('close', () => {
        // find and remove client
        for (const [sessionId, client] of this.clients) {
          if (client === ws) {
            this.clients.delete(sessionId);
            break;
          }
        }
      });
    });
  }

  private handleClientMessage(ws: WebSocket, msg: ClientMessage): void {
    switch (msg.type) {
      case 'query:submit':
        this.clients.set(msg.sessionId, ws);
        this.orchestrator.handleQuery(msg.sessionId, msg.payload.query);
        break;

      case 'query:cancel':
        this.orchestrator.cancelSession(msg.sessionId);
        break;

      case 'permission:respond':
        this.orchestrator.respondPermission(
          msg.sessionId,
          msg.payload.requestId,
          msg.payload.allowed,
          msg.payload.remember
        );
        break;

      case 'session:list':
        const sessions = this.orchestrator.getAllSessions();
        ws.send(JSON.stringify({
          id: crypto.randomUUID(),
          sessionId: 'global',
          type: 'session:list',
          payload: { sessions: sessions.map(s => ({ id: s.id, query: s.query, status: s.status })) },
          timestamp: Date.now(),
        }));
        break;
    }
  }

  private setupOrchestratorEvents(): void {
    this.orchestrator.on('*', (event: ServerMessage) => {
      const client = this.clients.get(event.sessionId);
      if (client?.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(event));
      }
    });
  }

  broadcast(sessionId: string, event: ServerMessage): void {
    const client = this.clients.get(sessionId);
    if (client?.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(event));
    }
  }
}
```

### Message IDs for Ordering

Each message has a monotonically increasing `id` (UUID or counter). UI can:
- Detect out-of-order delivery (check timestamps)
- Dedup (if server retries)
- Gap detection (if messages are missing, request replay)
