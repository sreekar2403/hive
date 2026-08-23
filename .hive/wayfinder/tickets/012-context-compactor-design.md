# Ticket: Context Compactor Design

**Label:** `wayfinder:task`
**Status:** CLOSED
**Blocked by:** 004-shared-memory-design
**Resolved:** 2026-08-19

## Question

How should the context compactor summarize agent output? The spec defines what to compact and what to preserve, but not the summarization approach.

**Decision needed:**

- What model is used for summarization (haiku? local small model?)?
- How is the summary generated (prompt template? chain of prompts?)?
- How is token counting done (tiktoken? approximation?)?
- What if the compactor itself fails (truncate as fallback?)?

**Considerations:**

- Compactor runs after each agent iteration, so it must be fast
- Must not use the same model as the agent (resource contention)
- Token counting needs to be accurate enough for budget enforcement
- Compactor failure shouldn't block the loop

**Options:**

- A) LLM summarizer — use haiku with a prompt template
- B) Rule-based — regex + heuristics, no LLM
- C) Hybrid — rule-based first, LLM for remaining

**Recommendation:** A) LLM summarizer — simplest, most reliable. Haiku is fast and cheap. Rule-based is fragile.

## Resolution

**Decision: A) LLM summarizer via haiku with tiktoken counting. Truncate fallback.**

### Design

```
Agent output (raw)
    │
    ▼
┌──────────────────┐
│ Token Counter    │
│ (tiktoken)       │
└────────┬─────────┘
         │
    under budget? ──yes──▶ write directly to shared memory
         │
        no
         │
         ▼
┌──────────────────┐
│ LLM Summarizer   │
│ (haiku)          │
│ - summarize      │
│ - preserve keys  │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ Verify budget    │
│ still over?      │──yes──▶ truncate
└────────┬─────────┘
         │
        no
         │
         ▼
Write compacted result to shared memory
```

### Implementation

```typescript
// packages/server/src/compactor.ts

import { SharedMemory, AgentResult } from "./sharedMemory";

interface CompactorConfig {
  tokenBudgetPerAgent: number; // default: 10000
  compactorModel: string; // default: 'haiku'
  fallbackAction: "truncate" | "error"; // default: 'truncate'
}

export class ContextCompactor {
  private config: CompactorConfig;
  private callLLM: (model: string, prompt: string) => Promise<string>;

  constructor(
    config: CompactorConfig,
    callLLM: (model: string, prompt: string) => Promise<string>,
  ) {
    this.config = {
      tokenBudgetPerAgent: config.tokenBudgetPerAgent ?? 10000,
      compactorModel: config.compactorModel ?? "haiku",
      fallbackAction: config.fallbackAction ?? "truncate",
    };
    this.callLLM = callLLM;
  }

  /**
   * Compact all agent results in shared memory that exceed the token budget.
   */
  async compact(sharedMemory: SharedMemory): Promise<void> {
    const results = sharedMemory.getAllAgentResults();

    for (const [agentId, result] of results) {
      if (!result.fullOutput) continue;

      const rawTokens = this.countTokens(result.fullOutput);

      if (rawTokens <= this.config.tokenBudgetPerAgent) {
        // Under budget — no compaction needed
        continue;
      }

      try {
        const compacted = await this.compactResult(agentId, result, rawTokens);
        sharedMemory.setAgentResult(agentId, compacted);
      } catch (err) {
        // Compactor failed — fallback to truncation
        if (this.config.fallbackAction === "truncate") {
          const truncated = this.truncateResult(agentId, result, rawTokens);
          sharedMemory.setAgentResult(agentId, truncated);
        }
        // else: error propagates, loop engine handles it
      }
    }
  }

  /**
   * Compact a single agent result using LLM summarization.
   */
  private async compactResult(
    agentId: string,
    result: AgentResult,
    rawTokens: number,
  ): Promise<AgentResult> {
    const prompt = this.buildCompactionPrompt(result);
    const summary = await this.callLLM(this.config.compactorModel, prompt);

    // Verify the summary is within budget
    const summaryTokens = this.countTokens(summary);
    if (summaryTokens > this.config.tokenBudgetPerAgent) {
      // Summary itself is too long — truncate
      return this.truncateResult(agentId, result, rawTokens);
    }

    return {
      ...result,
      rawTokens,
      compactedTokens: summaryTokens,
      wasCompacted: true,
      summary,
      fullOutput: undefined, // remove full output to save memory
    };
  }

  /**
   * Build the compaction prompt.
   */
  private buildCompactionPrompt(result: AgentResult): string {
    return `You are a context compactor for an AI agent system. Your job is to summarize an agent's output while preserving critical information.

## Agent Output
${result.fullOutput}

## What to PRESERVE verbatim:
- Final decisions made
- File paths changed or created
- Error messages
- Blocking dependencies on other agents
- Credentials, URLs, or configuration values discovered
- The conclusion or result of the work

## What to COMPACT (summarize concisely):
- Step-by-step reasoning → "Decided to X because Y"
- Verbose logs → "Completed with N warnings"
- Repeated code blocks → "Modified src/foo.ts: changed function bar"
- Debug output → remove entirely

## Output Format
Provide a concise summary that fits within ${this.config.tokenBudgetPerAgent} tokens. Start with the most important information first.`;
  }

  /**
   * Truncate result to fit within budget (fallback).
   */
  private truncateResult(
    agentId: string,
    result: AgentResult,
    rawTokens: number,
  ): AgentResult {
    // Keep first 20% and last 80% of the output
    const lines = result.fullOutput!.split("\n");
    const keepFromStart = Math.ceil(lines.length * 0.2);
    const keepFromEnd = Math.floor(lines.length * 0.8);

    const truncated = [
      ...lines.slice(0, keepFromStart),
      `\n... [truncated ${lines.length - keepFromStart - keepFromEnd} lines] ...`,
      ...lines.slice(-keepFromEnd),
    ].join("\n");

    const truncatedTokens = this.countTokens(truncated);

    return {
      ...result,
      rawTokens,
      compactedTokens: truncatedTokens,
      wasCompacted: true,
      summary: truncated,
      fullOutput: undefined,
    };
  }

  /**
   * Count tokens using tiktoken.
   * Falls back to word count approximation if tiktoken fails.
   */
  private countTokens(text: string): number {
    try {
      // tiktoken for accurate counting
      const { encoding_for_model } = require("tiktoken");
      const enc = encoding_for_model("gpt-4"); // cl100k_base encoding
      const tokens = enc.encode(text);
      enc.free();
      return tokens.length;
    } catch {
      // Fallback: approximate 1 token ≈ 4 characters
      return Math.ceil(text.length / 4);
    }
  }
}
```

### Config

```yaml
# config/default.yaml
compaction:
  enabled: true
  token_budget_per_agent: 10000
  compactor_model: haiku
  fallback: truncate # truncate | error
```

### Integration with Loop Engine

```typescript
// In loopEngine.ts — after VERIFY passes

case 'verify':
  const result = await verifyGoal(ctx, output);
  ctx.history.push({ ...iteration, verification: result });

  // Compact shared memory after each iteration
  await compactor.compact(ctx.sharedMemory);

  if (result.passed) {
    ctx.state = 'done';
  } else if (ctx.iteration >= ctx.maxIterations) {
    ctx.state = 'done';
  } else {
    ctx.state = 'revise';
  }
  break;
```

### Token Budget Enforcement

The compactor runs after every iteration, but the REVISE prompt also respects the budget:

```typescript
function buildPrompt(ctx: LoopContext): string {
  const budget = compactorConfig.tokenBudgetPerAgent;
  const history = ctx.history
    .map((h) => `- ${h.action}: ${h.observation}`)
    .join("\n");

  // Ensure total prompt stays within budget
  const historyTokens = countTokens(history);
  if (historyTokens > budget * 0.5) {
    // Only include last 2 iterations in prompt
    const recent = ctx.history.slice(-2);
    return `Goal: ${ctx.goal}\n\nRecent:\n${recent.map((h) => `- ${h.observation}`).join("\n")}`;
  }

  return `Goal: ${ctx.goal}\n\nHistory:\n${history}`;
}
```
