# hive

Use when the user wants to build a multi-agent swarm, orchestrate agents across harnesses, or create an agentic framework.

## What it is

A framework for orchestrating AI agents across different harnesses (OpenCode, Claude Code, Pi) with:
- Loop engineering for self-correction
- Permission system for destructive actions
- Branch/PR management
- Resource locking to prevent conflicts
- Shared memory for inter-agent communication

## Quick Start

```bash
cd hive
pnpm install
pnpm dev:server
```

Then open the web interface at `http://localhost:3001`.

## Architecture

- **Router**: Routes tasks to the most suitable harness
- **LoopEngine**: Implements loop engineering for self-correction
- **PermissionManager**: Handles permission requests for destructive actions
- **ResourceManager**: Prevents file conflicts between parallel agents
- **SharedMemory**: Enables inter-agent communication
- **Orchestrator**: Coordinates all components

## When to Use

- Building multi-agent systems
- Orchestrating work across multiple AI harnesses
- Creating frameworks with minimal human intervention
- Any task requiring agent coordination
