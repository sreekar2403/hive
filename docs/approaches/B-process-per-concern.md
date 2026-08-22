# Approach B: Process-per-concern

**Status:** Logged for future reference
**Superseded by:** Approach A (Monolith) for initial implementation

---

## Overview

Separate processes for each concern: web UI (frontend dev server), orchestrator (Node.js), agent runners (one per harness invocation). Communicate via local HTTP or Unix sockets.

## Architecture

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Web UI     │────▶│ Orchestrator │────▶│ Agent Runner │
│ (React/Vite) │     │  (Node.js)   │     │   (Node.js)  │
└──────────────┘     └──────────────┘     └──────────────┘
       │                    │                    │
       └────────────────────┼────────────────────┘
                            │
                     ┌──────┴──────┐
                     │ Shared State │
                     │  (Redis)     │
                     └─────────────┘
```

## Pros

- Clean separation — crash in one agent doesn't kill others
- Can restart individual components
- Feels more "production-ish"

## Cons

- More moving parts, harder to debug
- IPC complexity for shared memory (needs serialization)
- Overkill for a personal tool

## When to revisit

If Hive grows beyond personal use, or if process isolation becomes necessary for stability.
