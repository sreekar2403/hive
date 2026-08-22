# Ticket: Loop Engine Core

**Label:** `wayfinder:grilling`
**Status:** CLOSED
**Blocked by:** None
**Resolved:** 2026-08-19

## Question

How should the loop engine implement the act→observe→verify→revise cycle? The spec defines the pattern but not the implementation details.

**Decision needed:**
- Is the loop a state machine, a recursive function, or a while-loop?
- How does REVISE construct the next prompt? (prepend history? summarize? template?)
- How does VERIFY evaluate success? (heuristics only? LLM-judge? both?)
- What happens when max iterations are reached?
- How is the loop interrupted for permission requests?

**Considerations:**
- Must support streaming (UI sees progress in real-time)
- Must be interruptible (permission dialog pauses the loop)
- Must write to shared memory at each step
- Must handle harness crashes gracefully (timeout, retry, fail)

**Options:**
- A) State machine — explicit states, transitions, event-driven
- B) Async generator — yields at each step, caller controls flow
- C) Simple while-loop — check conditions each iteration, simplest

**Recommendation:** A) State machine — clearest mental model for the loop, easiest to debug, naturally handles interruptions and edge cases. The loop is the core of the system; worth getting right.

## Resolution

**Decision: A) State machine with event-driven transitions**

### States

```
                    ┌─────────────────────────────┐
                    │                             │
    ┌───────┐   ACT    ┌────────┐   OBSERVE   ┌──┴───┐
    │ IDLE  │────────▶│  ACT   │────────────▶│OBSERVE│
    └───┬───┘         └───┬────┘             └──┬───┘
        │                 │                     │
        │              permission            VERIFY
        │              requested               │
        │                 │               ┌────┴────┐
        │                 ▼               │         │
        │            ┌────────┐        PASS      FAIL
        │            │ PAUSED │         │         │
        │            └───┬────┘         ▼         ▼
        │                │          ┌──────┐  ┌───────┐
        │           allow│          │ DONE │  │REVISE │
        │                │          └──────┘  └───┬───┘
        │                │                        │
        │                └─────── back to ACT ────┘
        │
        │ max iterations exceeded
        ▼
   ┌─────────┐
   │  DONE   │ (partial success, report progress)
   └─────────┘
```

### State Definitions

```typescript
type LoopState =
  | 'idle'      // waiting to start
  | 'act'       // executing harness command
  | 'observe'   // capturing output
  | 'verify'    // evaluating result against goal
  | 'revise'    // constructing next prompt
  | 'paused'    // waiting for permission
  | 'done'      // task complete
  | 'failed';   // unrecoverable error
```

### Loop Context

```typescript
interface LoopContext {
  taskId: string;
  goal: string;
  originalQuery: string;
  state: LoopState;
  iteration: number;
  maxIterations: number;        // default: 5
  history: LoopIteration[];     // full audit trail
  currentPrompt: string;
  harness: Harness;
  timeout: number;              // ms per iteration, default: 300000
}

interface LoopIteration {
  iteration: number;
  action: string;               // the prompt sent to harness
  observation: string;          // harness output
  verification: VerificationResult;
  revision?: string;            // failure reason + next approach
  timestamp: Date;
  duration: number;             // ms
}

interface VerificationResult {
  passed: boolean;
  method: 'heuristic' | 'llm_judge';
  reason: string;
  confidence: number;           // 0-1, for LLM-judge
}
```

### Core Loop Pseudocode

```typescript
async function runLoop(ctx: LoopContext): Promise<LoopResult> {
  while (ctx.state !== 'done' && ctx.state !== 'failed') {
    switch (ctx.state) {

      case 'idle':
        ctx.state = 'act';
        break;

      case 'act':
        // Build prompt from history (or original for first iteration)
        ctx.currentPrompt = buildPrompt(ctx);
        ctx.state = 'observe';
        break;

      case 'observe':
        // Stream harness output, check for destructive commands
        const output = await streamHarness(ctx);
        if (output.blocked) {
          ctx.state = 'paused';
          await requestPermission(output.blockedCommand);
        } else {
          ctx.state = 'verify';
        }
        break;

      case 'verify':
        const result = await verifyGoal(ctx, output);
        ctx.history.push({ ...iteration, verification: result });
        if (result.passed) {
          ctx.state = 'done';
        } else if (ctx.iteration >= ctx.maxIterations) {
          ctx.state = 'done'; // partial success
        } else {
          ctx.state = 'revise';
        }
        break;

      case 'revise':
        ctx.iteration++;
        ctx.state = 'act';
        break;

      case 'paused':
        // wait for permission response via WebSocket
        // on allow: ctx.state = 'observe'
        // on deny: inject denial, ctx.state = 'revise'
        break;
    }
  }
  return buildResult(ctx);
}
```

### VERIFY: Two-Phase Evaluation

**Phase 1 — Heuristic (fast, free):**
- Exit code = 0? → likely success
- Output contains error patterns? → likely failure
- Output contains expected result patterns? → likely success
- If confidence > 0.8 → use heuristic result

**Phase 2 — LLM-judge (when heuristic is uncertain):**
- Send to haiku or local small model:
  ```
  Goal: {ctx.originalQuery}
  Output: {truncated output}
  Previous attempts: {history summaries}
  Did this achieve the goal? Answer: yes/no with reason.
  ```
- Use result if confidence > 0.7
- Otherwise: assume failure, revise

### REVISE: Prompt Construction

```
Original goal: {ctx.originalQuery}
Current iteration: {ctx.iteration}/{ctx.maxIterations}

Previous attempt:
{ctx.history[last].observation}

Why it failed:
{ctx.history[last].verification.reason}

Given this, revise your approach. What would you do differently?
```

### Permission Interruption

1. During OBSERVE, scan output for destructive patterns
2. If match found:
   - Pause harness execution (SIGSTOP or just stop reading stdout)
   - Emit `permission_request` event via WebSocket
   - Wait for user response (with 30s timeout)
   - On allow: resume harness
   - On deny: inject "Command denied. Find alternative." into observation, continue to VERIFY (which will likely fail, triggering REVISE)
