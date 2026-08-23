# Hive — Swarm Agent Framework Design

**Date:** 2026-08-19
**Status:** Approved
**Author:** Sreekar

---

## Overview

Hive is a personal agentic framework with a single web chat interface that dispatches queries to swarm agents running on different CLI harnesses (opencode, claude code, pi). Agents communicate via shared memory, run autonomous loop engineering cycles (act→observe→verify→revise), and coordinate git work through branches and PRs.

---

## Goals

- Single web chat interface for all queries
- Swarm agents on multiple CLI harnesses with model-appropriate routing
- Autonomous loop engineering with minimal human intervention
- Destructive task permission gating
- Sequential work → separate branches → single PR
- Parallel work → shared branch → no file conflicts
- Local model support (Ollama, LM Studio) with resource management
- Multi-session support with sidebar navigation

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│                  Web UI (React)                  │
│  ┌──────────┐  ┌──────────────┐  ┌───────────┐ │
│  │ Chat Box │  │ Agent Panel  │  │ Permission │ │
│  │          │  │ (expandable) │  │  Dialog    │ │
│  └────┬─────┘  └──────┬───────┘  └─────┬─────┘ │
│       └───────────────┼────────────────┘       │
│                       │ WebSocket              │
└───────────────────────┼────────────────────────┘
                        │
┌───────────────────────┼────────────────────────┐
│              Orchestrator (Node.js)            │
│                       │                         │
│  ┌─────────────┐  ┌──┴──────────┐  ┌────────┐ │
│  │   Router    │  │ Loop Engine │  │ Branch │ │
│  │(harness/    │  │(act→observe │  │  Mgr   │ │
│  │ model pick) │  │ →verify→    │  │        │ │
│  │             │  │ revise)     │  │        │ │
│  └──────┬──────┘  └──────┬──────┘  └───┬────┘ │
│         └────────────────┼─────────────┘      │
│                          │                     │
│  ┌───────────────────────┴──────────────────┐  │
│  │           Shared Memory Store            │  │
│  │  (task context, agent results, state)    │  │
│  └──────────────────────────────────────────┘  │
└──────────────────────┬─────────────────────────┘
                       │
         ┌─────────────┼─────────────┐
         ▼             ▼             ▼
    ┌─────────┐  ┌──────────┐  ┌─────────┐
    │ opencode│  │claude code│  │   pi    │
    │  (CLI)  │  │   (CLI)   │  │  (CLI) │
    └─────────┘  └──────────┘  └─────────┘
```

---

## Components

### 1. Agent Loop Engine

Core runtime pattern: act → observe → verify → revise.

- **ACT** — Orchestrator constructs a prompt with task + shared memory context, shells out to the chosen CLI harness, streams output
- **OBSERVE** — Captures CLI output (stdout, stderr, exit code) and writes to shared memory
- **VERIFY** — Evaluates result against the original goal:
  - _Automatic:_ Heuristics (exit code, output contains expected pattern, no errors)
  - _LLM-judge:_ Asks a lightweight model "did this achieve the goal?"
- **REVISE** — If verification failed, constructs a new prompt with failure reason and previous attempt, loops back to ACT

**Safety rails:**

- Max loop iterations (default: 5, configurable per task)
- Timeout per iteration (default: 5 min)
- Destructive action detection → pause and ask for permission

### 2. Router & Harness Selection

Default routing table:

```yaml
routing:
  frontend:
    pattern: "component|UI|CSS|style|layout|responsive|accessibility"
    harness: opencode
    model: sonnet
  backend:
    pattern: "API|endpoint|server|database|auth|middleware"
    harness: claude-code
    model: sonnet
  architecture:
    pattern: "design|architect|system|structure|refactor|scale"
    harness: opencode
    model: opus
  devops:
    pattern: "deploy|CI|Docker|nginx|server|infra"
    harness: claude-code
    model: sonnet
  research:
    pattern: "find|search|compare|evaluate|investigate"
    harness: pi
    model: haiku
  default:
    harness: opencode
    model: sonnet
```

**Override syntax in chat:**

- `@opus` — force model
- `@pi` — force harness
- `@opus@pi` — both

### 3. Resource Manager (Local LLM)

- **Local LLM Lock** — only one agent can use a local model at a time
- **GPU Monitor** — checks VRAM usage before dispatching to a local model
- **Task Queue** — if a local model is busy, tasks either wait in queue or fall back to cloud
- **VRAM Threshold** — configurable (default: 80%), new local tasks queue above this

### 4. Context Compaction

When an agent's session exceeds token budget, compact before writing to shared memory.

- **Per-agent token budget:** configurable (default: 10K tokens)
- **Compactor uses a cheap model:** haiku or local small model
- **Compacted:** Verbose logs, step-by-step reasoning, repeated code blocks
- **Preserved verbatim:** Final decisions, file paths changed, errors, blocking dependencies, credentials/URLs

### 5. Shared Memory

In-process store with per-query workspaces:

```typescript
interface SharedMemory {
  taskContext: {
    id: string;
    originalQuery: string;
    goal: string;
    status: "routing" | "looping" | "done" | "failed";
    createdAt: Date;
  };
  agentResults: Map<string, AgentResult>;
  loopState: Map<
    string,
    {
      iteration: number;
      history: Array<{
        action: string;
        observation: string;
        passed: boolean;
        revision: string;
      }>;
    }
  >;
  branches: Map<
    string,
    {
      name: string;
      agent: string;
      status: "active" | "merged" | "conflict";
      filesChanged: string[];
    }
  >;
  messages: Array<{
    from: string;
    to: string | "broadcast";
    type: "result" | "request" | "blocking";
    payload: any;
  }>;
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
```

**Access rules:**

- Read: Any agent can read any key
- Write: Agents own their own keys
- Cross-write: Via messages (logged, auditable)
- Concurrency: Single-threaded Node.js event loop, file-level locking via git branches

### 6. Branch & PR Management

**Sequential mode (default):**

- Each agent gets its own branch: `swarm/<query-id>/<agent-id>`
- All agents finish → one PR merging all branches into main
- Conflict resolution: orchestrator flags overlapping files, asks user

**Parallel mode:**

- All agents work on single branch: `swarm/<query-id>/shared`
- Shared memory tracks who's editing what
- File locking before modification
- One PR at the end

**Safety:**

- Never pushes to main directly
- PR body includes which agent did what
- Destructive git operations always require permission

### 7. Permission System

Destructive pattern detection:

```yaml
destructive_patterns:
  git:
    - "git push --force"
    - "git reset --hard"
    - "git clean -f"
    - "git branch -D"
  filesystem:
    - "rm -rf"
    - "rmdir /s"
    - "del /f"
  database:
    - "DROP TABLE"
    - "DELETE FROM"
    - "TRUNCATE"
  deploy:
    - "kubectl delete"
    - "docker rm"
    - "docker system prune"
```

**Permission levels:**

- Ask every time (default)
- Allow for session
- Always allow (whitelist)

**On deny:** Agent receives "Command denied" and enters REVISE loop to find alternative.

### 8. Web UI

**Layout:**

```
┌────────┬──────────────────────────────────────────┐
│        │  Swarm Agent                    [Settings]│
│ SIDEBAR├──────────────────────────────────────────┤
│        │                                          │
│ ┌────┐ │  ┌────────────────────────────────────┐  │
│ │ >  │ │  │      Agent Activity Panel          │  │
│ │ S1 │ │  │  ┌─────┐ ┌─────┐ ┌─────┐          │  │
│ │    │ │  │  │ ◉ A │ │ ◎ B │ │ ◎ C │          │  │
│ ├────┤ │  │  └─────┘ └─────┘ └─────┘          │  │
│ │    │ │  └────────────────────────────────────┘  │
│ │ S2 │ │                                          │
│ │    │ │  ┌────────────────────────────────────┐  │
│ ├────┤ │  │ Chat messages...                   │  │
│ │ S3 │ │  └────────────────────────────────────┘  │
│ │    │ │                                          │
│ ├────┤ │  ┌────────────────────────────────────┐  │
│ │ +  │ │  │ Type a message...         [Send]   │  │
│ └────┘ │  └────────────────────────────────────┘  │
└────────┴──────────────────────────────────────────┘
```

**Features:**

- Sidebar: session list with status icons, search/filter, new session button
- Agent Activity Panel: expandable, shows each agent's harness, model, iteration progress
- Chat: streaming responses, inline permission dialogs, override chips
- Settings sub-page: model selection, local model list, resource limits, compaction config

---

## Tech Stack

| Layer     | Technology                                        |
| --------- | ------------------------------------------------- |
| Runtime   | Node.js + TypeScript                              |
| Web UI    | React + Vite + TailwindCSS                        |
| WebSocket | ws                                                |
| Git       | simple-git                                        |
| Process   | child_process                                     |
| Storage   | JSON files (sessions) + in-memory (shared memory) |
| Local LLM | ollama npm package + LM Studio REST API           |

---

## Project Structure

```
hive/
├── package.json
├── tsconfig.json
├── .env
├── docs/
│   ├── superpowers/specs/
│   │   └── 2026-08-19-hive-design.md
│   └── approaches/
│       ├── B-process-per-concern.md
│       └── C-plugin-architecture.md
├── src/
│   ├── server/
│   │   ├── index.ts
│   │   ├── orchestrator.ts
│   │   ├── router.ts
│   │   ├── loopEngine.ts
│   │   ├── resourceManager.ts
│   │   ├── compactor.ts
│   │   ├── branchManager.ts
│   │   ├── permissions.ts
│   │   ├── sharedMemory.ts
│   │   └── harnesses/
│   │       ├── base.ts
│   │       ├── opencode.ts
│   │       ├── claudeCode.ts
│   │       └── pi.ts
│   ├── ui/
│   │   ├── App.tsx
│   │   ├── components/
│   │   │   ├── Sidebar.tsx
│   │   │   ├── Chat.tsx
│   │   │   ├── AgentPanel.tsx
│   │   │   ├── PermissionDialog.tsx
│   │   │   └── Settings.tsx
│   │   ├── hooks/
│   │   │   ├── useWebSocket.ts
│   │   │   └── useSession.ts
│   │   └── types.ts
│   └── shared/
│       └── types.ts
├── config/
│   ├── default.yaml
│   └── permissions.yaml
└── sessions/
```

---

## Future Approaches (Logged for Reference)

See `docs/approaches/` for:

- **Approach B: Process-per-concern** — separate processes communicating via local HTTP/IPC
- **Approach C: Plugin architecture** — core orchestrator with pluggable harness system
