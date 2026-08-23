# Ticket: CLI Harness Abstraction

**Label:** `wayfinder:task`
**Status:** CLOSED
**Blocked by:** None
**Resolved:** 2026-08-19

## Question

What should the base interface for CLI harnesses look like? All harnesses (opencode, claude code, pi) are CLI tools invoked via child_process, but they have different invocation patterns, output formats, and capabilities.

**Decision needed:**

- What methods does the base harness interface expose?
- How is output streamed (chunked, line-by-line, buffered)?
- How do harnesses declare their capabilities (supports streaming, supports tool use, etc.)?
- How are errors surfaced (exit codes, stderr patterns)?

**Considerations:**

- opencode has a rich tool-use protocol, claude code has its own, pi is simpler
- Loop engine needs to observe output in real-time for streaming UI
- Some harnesses may not support all features (e.g., pi might not have tool use)
- Need a way to detect if a harness is installed and available

**Options:**

- A) Minimal interface — just `execute(prompt, options) → Observable<string>`
- B) Rich interface — separate methods for streaming, tool use, file operations
- C) Capability-based — harness declares what it can do, orchestrator adapts

**Recommendation:** C) Capability-based — lets each harness expose what it supports, orchestrator adapts behavior. Most flexible for adding new harnesses later.

## Resolution

**Decision: C) Capability-based with async generator streaming**

### Base Interface

```typescript
// packages/shared/src/harness.ts

export interface CapabilitySet {
  streaming: boolean; // can stream output chunks
  toolUse: boolean; // supports tool use (file edit, bash, etc.)
  modelSelection: boolean; // can switch models at runtime
  sessionResume: boolean; // can resume previous sessions
}

export type OutputChunk =
  | { type: "text"; content: string }
  | { type: "tool_use"; tool: string; input: any }
  | { type: "tool_result"; tool: string; output: string }
  | { type: "error"; message: string; code?: number }
  | { type: "done"; exitCode: number; summary: string };

export interface ExecuteOptions {
  model?: string; // override model for this execution
  timeout?: number; // ms, default 300000 (5 min)
  cwd?: string; // working directory
  env?: Record<string, string>; // extra env vars
}

export interface Harness {
  readonly name: string;
  readonly capabilities: CapabilitySet;

  isAvailable(): Promise<boolean>;
  execute(
    prompt: string,
    options?: ExecuteOptions,
  ): AsyncGenerator<OutputChunk>;
  setModel(model: string): void;
  getModel(): string;
}
```

### Why AsyncGenerator

- Loop engine can `for await` over output chunks
- Natural fit for streaming CLI output
- Backpressure: consumer pulls chunks at its own pace
- Easy to cancel: return from the generator

### Error Handling

Each harness maps CLI-specific errors to `OutputChunk`:

- Non-zero exit code → `{ type: 'error', message, code }`
- Timeout → `{ type: 'error', message: 'Timeout after Xms' }`
- CLI not found → `isAvailable()` returns false, orchestrator skips

### Harness Implementations

Each harness wraps its specific CLI invocation:

```typescript
// packages/server/src/harnesses/opencode.ts
export class OpenCodeHarness implements Harness {
  readonly name = 'opencode';
  readonly capabilities = {
    streaming: true,
    toolUse: true,
    modelSelection: true,
    sessionResume: false,
  };

  async *execute(prompt: string, options?: ExecuteOptions): AsyncGenerator<OutputChunk> {
    const proc = spawn('opencode', ['run', prompt], { ... });
    // pipe stdout through line parser
    // yield text chunks, parse tool use events
  }
}
```

### Capability Queries

The orchestrator checks capabilities before adapting:

```typescript
if (harness.capabilities.toolUse) {
  // prompt can include tool-use instructions
} else {
  // prompt must be self-contained, no tool use
}

if (harness.capabilities.streaming) {
  // stream output to UI in real-time
} else {
  // buffer entire output, return at end
}
```
