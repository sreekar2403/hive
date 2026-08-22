# Approach C: Plugin Architecture

**Status:** Logged for future reference
**Superseded by:** Approach A (Monolith) for initial implementation

---

## Overview

Core orchestrator with a plugin system — each harness (opencode, claude code, pi) is a plugin that registers itself. Web UI is another plugin. Shared memory is a core service.

## Architecture

```
┌─────────────────────────────────────────┐
│              Core Orchestrator          │
│  ┌─────────┐  ┌──────────┐  ┌────────┐ │
│  │ Shared  │  │  Plugin  │  │ Router │ │
│  │ Memory  │  │ Registry │  │        │ │
│  └─────────┘  └────┬─────┘  └────────┘ │
└────────────────────┼────────────────────┘
                     │
       ┌─────────────┼─────────────┐
       ▼             ▼             ▼
  ┌─────────┐  ┌──────────┐  ┌─────────┐
  │ Plugin  │  │ Plugin   │  │ Plugin  │
  │ opencode│  │ claude   │  │   pi    │
  │         │  │ code     │  │         │
  └─────────┘  └──────────┘  └─────────┘
```

## Pros

- Easy to add new harnesses — just write a plugin
- Clean extensibility
- The system itself becomes agentic

## Cons

- Most complex to design upfront
- Plugin API needs to be right from the start
- Harder to reason about

## When to revisit

If Hive needs to support many different harnesses, or if it becomes a reusable framework for others.
