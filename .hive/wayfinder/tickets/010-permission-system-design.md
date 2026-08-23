# Ticket: Permission System Design

**Label:** `wayfinder:grilling`
**Status:** CLOSED
**Blocked by:** None
**Resolved:** 2026-08-19

## Question

How should the permission system detect and gate destructive commands? The spec defines the patterns but not the enforcement mechanism.

**Decision needed:**

- When does detection happen (before execution? in output? after?);
- How does the permission dialog flow work (WebSocket round-trip?)?
- How are permissions persisted (session-only? file-based?)?
- How does "always allow" work (regex match? exact match?)

**Considerations:**

- Must work with CLI harnesses that may already have the command ready to execute
- The harness executes commands — Hive can only intercept before or after
- "Before" detection means parsing the agent's planned actions (harder)
- "After" detection means catching it in output (easier but too late?)
- Need to think about harness-specific command formats

**Options:**

- A) Post-execution detection — catch in output, deny was too late
- B) Pre-execution interception — harness declares commands before running
- C) Output pattern matching — match patterns in stdout/stderr as they stream

**Recommendation:** C) Output pattern matching — practical middle ground. Catch destructive patterns as output streams, pause before next iteration. Not perfect but workable.

## Resolution

**Decision: C) Dual-phase — prompt scan before harness + output scan during streaming**

Two layers of defense:

### Phase 1: Prompt Scan (Pre-Execution)

Before sending a prompt to the harness, scan it for destructive patterns. If found, block the prompt entirely and ask permission before sending.

```typescript
// packages/server/src/permissions.ts

interface DestructivePattern {
  id: string;
  category: "git" | "filesystem" | "database" | "deploy" | "package";
  pattern: RegExp;
  description: string;
  severity: "block" | "warn"; // block = must ask, warn = log but allow
}

const DESTRUCTIVE_PATTERNS: DestructivePattern[] = [
  // Git
  {
    id: "git-force-push",
    category: "git",
    pattern: /git\s+push\s+--force/i,
    description: "Force push",
    severity: "block",
  },
  {
    id: "git-reset-hard",
    category: "git",
    pattern: /git\s+reset\s+--hard/i,
    description: "Hard reset",
    severity: "block",
  },
  {
    id: "git-clean",
    category: "git",
    pattern: /git\s+clean\s+-[a-z]*f/i,
    description: "Force clean",
    severity: "block",
  },
  {
    id: "git-branch-delete",
    category: "git",
    pattern: /git\s+branch\s+-[dD]/i,
    description: "Delete branch",
    severity: "warn",
  },
  {
    id: "git-checkout-force",
    category: "git",
    pattern: /git\s+checkout\s+--\s+\./i,
    description: "Discard all changes",
    severity: "block",
  },

  // Filesystem
  {
    id: "rm-rf",
    category: "filesystem",
    pattern: /rm\s+-rf?\s+/i,
    description: "Recursive force delete",
    severity: "block",
  },
  {
    id: "rmdir-s",
    category: "filesystem",
    pattern: /rmdir\s+\/s/i,
    description: "Windows recursive delete",
    severity: "block",
  },
  {
    id: "del-force",
    category: "filesystem",
    pattern: /del\s+\/[sfq]/i,
    description: "Windows force delete",
    severity: "block",
  },

  // Database
  {
    id: "drop-table",
    category: "database",
    pattern: /DROP\s+TABLE/i,
    description: "Drop table",
    severity: "block",
  },
  {
    id: "delete-from",
    category: "database",
    pattern: /DELETE\s+FROM/i,
    description: "Delete from table",
    severity: "block",
  },
  {
    id: "truncate",
    category: "database",
    pattern: /TRUNCATE/i,
    description: "Truncate table",
    severity: "block",
  },

  // Deploy
  {
    id: "kubectl-delete",
    category: "deploy",
    pattern: /kubectl\s+delete/i,
    description: "Delete K8s resource",
    severity: "block",
  },
  {
    id: "docker-rm",
    category: "deploy",
    pattern: /docker\s+rm/i,
    description: "Remove container",
    severity: "warn",
  },
  {
    id: "docker-prune",
    category: "deploy",
    pattern: /docker\s+system\s+prune/i,
    description: "Prune Docker system",
    severity: "block",
  },

  // Package
  {
    id: "npm-uninstall",
    category: "package",
    pattern: /npm\s+ uninstall/i,
    description: "Uninstall package",
    severity: "warn",
  },
  {
    id: "pip-uninstall",
    category: "package",
    pattern: /pip\s+uninstall/i,
    description: "Uninstall package",
    severity: "warn",
  },
];
```

### Phase 2: Output Scan (During Streaming)

As harness output streams in, scan each chunk for destructive patterns. If found, **pause the loop** before the next iteration.

```typescript
export class PermissionSystem {
  private whitelist: Set<string>; // pattern IDs to always allow
  private blacklist: Set<string>; // pattern IDs to never allow
  private sessionAllowances: Map<string, Set<string>>; // sessionId → allowed pattern IDs

  constructor(config: PermissionConfig) {
    this.whitelist = new Set(config.whitelist || []);
    this.blacklist = new Set(config.blacklist || []);
    this.sessionAllowances = new Map();
  }

  // Phase 1: Scan prompt before sending to harness
  scanPrompt(prompt: string): DestructiveMatch[] {
    return this.findMatches(prompt);
  }

  // Phase 2: Scan output during streaming
  scanOutput(output: string, sessionId: string): DestructiveMatch[] {
    const matches = this.findMatches(output);
    return matches.filter((m) => !this.isAllowed(m, sessionId));
  }

  private findMatches(text: string): DestructiveMatch[] {
    return DESTRUCTIVE_PATTERNS.filter((p) => p.pattern.test(text)).map(
      (p) => ({
        pattern: p,
        match: text.match(p.pattern)?.[0] || "",
      }),
    );
  }

  private isAllowed(match: DestructiveMatch, sessionId: string): boolean {
    // Blacklist always blocks
    if (this.blacklist.has(match.pattern.id)) return false;

    // Whitelist always allows
    if (this.whitelist.has(match.pattern.id)) return true;

    // Session-level allowance
    const sessionAllow = this.sessionAllowances.get(sessionId);
    if (sessionAllow?.has(match.pattern.id)) return true;

    return false;
  }

  // --- Permission Flow ---

  async requestPermission(
    match: DestructiveMatch,
    sessionId: string,
    broadcast: (msg: any) => void,
  ): Promise<PermissionResult> {
    const requestId = crypto.randomUUID();

    // Send request to UI
    broadcast({
      type: "permission:requested",
      sessionId,
      payload: {
        requestId,
        command: match.match,
        description: match.pattern.description,
        category: match.pattern.category,
      },
    });

    // Wait for response (30s timeout)
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        resolve({ allowed: false, reason: "timeout" });
      }, 30000);

      // Response handler registered elsewhere
      this.pendingRequests.set(requestId, {
        resolve: (result) => {
          clearTimeout(timeout);
          this.pendingRequests.delete(requestId);
          resolve(result);
        },
      });
    });
  }

  respond(requestId: string, allowed: boolean, remember?: boolean): void {
    const pending = this.pendingRequests.get(requestId);
    if (!pending) return;

    if (allowed && remember) {
      // Add to session allowances
      const sessionAllow = this.sessionAllowances.get(sessionId) || new Set();
      sessionAllow.add(patternId);
      this.sessionAllowances.set(sessionId, sessionAllow);
    }

    pending.resolve({
      allowed,
      reason: allowed ? "user-approved" : "user-denied",
    });
  }

  // --- Config ---

  async saveConfig(): Promise<void> {
    const config = {
      whitelist: Array.from(this.whitelist),
      blacklist: Array.from(this.blacklist),
    };
    await writeFile(
      join(process.cwd(), "config", "permissions.yaml"),
      yaml.dump(config),
    );
  }
}

interface DestructiveMatch {
  pattern: DestructivePattern;
  match: string;
}

interface PermissionResult {
  allowed: boolean;
  reason: string;
}

interface PermissionConfig {
  whitelist?: string[];
  blacklist?: string[];
  defaultTimeout?: number; // ms, default 30000
}
```

### Integration with Loop Engine

```typescript
// In loopEngine.ts — OBSERVE phase

case 'observe':
  const chunks: string[] = [];
  for await (const chunk of harness.execute(prompt)) {
    chunks.push(chunk.content);

    // Scan output for destructive patterns
    const matches = permissions.scanOutput(chunks.join(''), sessionId);
    if (matches.length > 0) {
      // Ask permission for each match
      for (const match of matches) {
        const result = await permissions.requestPermission(match, sessionId, broadcast);
        if (!result.allowed) {
          // Inject denial into observation
          chunks.push(`\n[PERMISSION DENIED: ${match.pattern.description}]`);
          loopState.pauseReason = 'permission-denied';
        }
      }
    }
  }
  observation = chunks.join('');
  state = 'verify';
  break;
```

### Flow Summary

```
prompt built by REVISE
    │
    ▼
permissions.scanPrompt(prompt)  ← Phase 1
    │
    ├─ match found, severity=block → requestPermission → wait
    │   ├─ allowed → send to harness
    │   └─ denied → modify prompt, re-REVISE
    │
    └─ no match → send to harness
    │
    ▼
harness output streams
    │
    ▼
permissions.scanOutput(output)  ← Phase 2
    │
    ├─ match found → requestPermission → wait
    │   ├─ allowed → continue streaming
    │   └─ denied → inject denial, continue to VERIFY (will likely fail)
    │
    └─ no match → continue
    │
    ▼
VERIFY (check if goal achieved)
```
