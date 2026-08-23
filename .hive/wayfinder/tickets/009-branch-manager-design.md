# Ticket: Branch Manager Design

**Label:** `wayfinder:grilling`
**Status:** CLOSED
**Blocked by:** None
**Resolved:** 2026-08-19

## Question

How should the branch manager handle git operations? The spec defines the strategy but not the implementation.

**Decision needed:**

- How are branch names generated (query ID? timestamp? human-readable?)?
- How does conflict detection work in parallel mode (git diff? file locking?)
- How is the PR body composed (auto-generated from agent summaries?)?
- How does the system handle repos that aren't on GitHub (GitLab, local-only)?

**Considerations:**

- simple-git library is the chosen tool
- Must handle Windows paths and PowerShell
- PR creation depends on hosting platform (GitHub API, GitLab API, or just git commands)
- For personal use, might not need PR at all — just merge locally

**Options:**

- A) GitHub-only — use gh CLI for PR creation
- B) Git-agnostic — use git commands only, PR is optional
- C) Plugin-based — support multiple platforms via adapters

**Recommendation:** B) Git-agnostic — keep it simple, PR is a nice-to-have, not core. Merge locally first, add PR support later.

## Resolution

**Decision: B) Git-agnostic with simple-git, local merge first, PR optional**

### Branch Naming

```
Sequential (one agent per branch):
  hive/{queryId}/{agentId}     e.g., hive/a1b2c3/agent-frontend

Parallel (shared branch):
  hive/{queryId}/shared        e.g., hive/a1b2c3/shared

Temporary (during merge):
  hive/{queryId}/merge-temp    used for conflict resolution
```

### Core Operations

```typescript
// packages/server/src/branchManager.ts

import simpleGit, { SimpleGit, StatusResult } from "simple-git";
import { join } from "path";
import { SharedMemory } from "./sharedMemory";

export class BranchManager {
  private git: SimpleGit;
  private repoPath: string;

  constructor(repoPath: string = process.cwd()) {
    this.repoPath = repoPath;
    this.git = simpleGit(repoPath);
  }

  // --- Setup ---

  async isGitRepo(): Promise<boolean> {
    try {
      await this.git.status();
      return true;
    } catch {
      return false;
    }
  }

  async getMainBranch(): Promise<string> {
    const branches = await this.git.branchLocal();
    // prefer 'main', fallback to 'master'
    return branches.all.includes("main") ? "main" : "master";
  }

  // --- Branch Creation ---

  async createAgentBranch(queryId: string, agentId: string): Promise<string> {
    const branchName = `hive/${queryId}/${agentId}`;
    const main = await this.getMainBranch();

    await this.git.checkoutLocal(branchName, main);
    return branchName;
  }

  async createSharedBranch(queryId: string): Promise<string> {
    const branchName = `hive/${queryId}/shared`;
    const main = await this.getMainBranch();

    await this.git.checkoutLocal(branchName, main);
    return branchName;
  }

  // --- Agent Work ---

  async commitWork(
    agentId: string,
    message: string,
    files: string[],
  ): Promise<void> {
    await this.git.add(files);
    await this.git.commit(`[${agentId}] ${message}`);
  }

  async getChangedFiles(): Promise<string[]> {
    const status = await this.git.status();
    return status.modified.concat(
      status.created,
      status.renamed.map((r) => r.to),
    );
  }

  // --- Sequential Mode: Merge All Branches ---

  async mergeSequential(
    queryId: string,
    agentIds: string[],
  ): Promise<MergeResult> {
    const main = await this.getMainBranch();
    const results: MergeResult = { success: true, conflicts: [], merged: [] };

    // Create temp branch from main
    const tempBranch = `hive/${queryId}/merge-temp`;
    await this.git.checkoutLocal(tempBranch, main);

    for (const agentId of agentIds) {
      const branchName = `hive/${queryId}/${agentId}`;
      try {
        await this.git.merge([branchName]);
        results.merged.push(agentId);
      } catch (e) {
        // Merge conflict
        const status = await this.git.status();
        const conflicts = status.conflicted;
        results.conflicts.push({ agentId, files: conflicts });
        results.success = false;

        // Abort merge, try next agent
        await this.git.merge(["--abort"]);
      }
    }

    // If all merged, fast-forward main
    if (results.success) {
      await this.git.checkout(main);
      await this.git.merge([tempBranch]);
    }

    // Clean up temp branch
    await this.git.deleteLocalBranch(tempBranch, true);

    return results;
  }

  // --- Parallel Mode: Detect Conflicts ---

  async detectConflicts(
    queryId: string,
    agents: Map<string, string[]>,
  ): Promise<ConflictReport> {
    const report: ConflictReport = { hasConflicts: false, conflicts: [] };
    const fileOwnership = new Map<string, string>(); // filePath → agentId

    for (const [agentId, files] of agents) {
      for (const file of files) {
        if (fileOwnership.has(file)) {
          report.hasConflicts = true;
          report.conflicts.push({
            file,
            agents: [fileOwnership.get(file)!, agentId],
          });
        } else {
          fileOwnership.set(file, agentId);
        }
      }
    }

    return report;
  }

  // --- PR Creation (Optional) ---

  async createPR(
    queryId: string,
    summaries: AgentSummary[],
  ): Promise<PRInfo | null> {
    // Check if gh CLI is available
    const hasGH = await this.checkCommand("gh");
    if (!hasGH) return null;

    const body = this.composePRBody(queryId, summaries);
    const branchName = `hive/${queryId}/shared`;

    try {
      // Use gh CLI for PR creation
      const result = await this.exec(
        `gh pr create --title "Hive: ${queryId}" --body "${body}" --base main --head ${branchName}`,
      );
      return {
        url: result,
        number: parseInt(result.match(/\/(\d+)$/)?.[1] || "0"),
      };
    } catch {
      return null;
    }
  }

  private composePRBody(queryId: string, summaries: AgentSummary[]): string {
    const lines = [`## Hive Query: ${queryId}`, "", "### Agent Work", ""];

    for (const s of summaries) {
      lines.push(`#### ${s.agentId} (${s.harness}/${s.model})`);
      lines.push(s.summary);
      if (s.filesChanged.length > 0) {
        lines.push(`\nFiles changed: ${s.filesChanged.join(", ")}`);
      }
      lines.push("");
    }

    return lines.join("\n");
  }

  // --- Helpers ---

  private async checkCommand(cmd: string): Promise<boolean> {
    try {
      await this.exec(`${cmd} --version`);
      return true;
    } catch {
      return false;
    }
  }

  private async exec(command: string): Promise<string> {
    const result = await this.git.raw(command.split(/\s+/));
    return result.trim();
  }
}

interface MergeResult {
  success: boolean;
  conflicts: Array<{ agentId: string; files: string[] }>;
  merged: string[];
}

interface ConflictReport {
  hasConflicts: boolean;
  conflicts: Array<{ file: string; agents: string[] }>;
}

interface AgentSummary {
  agentId: string;
  harness: string;
  model: string;
  summary: string;
  filesChanged: string[];
}

interface PRInfo {
  url: string;
  number: number;
}
```

### Flow

**Sequential mode:**

```
orchestrator creates agent branches
    │
    ▼
agent works on hive/{queryId}/{agentId}
    │
    ▼
agent commits to its branch
    │
    ▼
all agents done → branchManager.mergeSequential()
    │
    ▼
merge each branch into main (abort on conflict, flag to user)
    │
    ▼
optionally create PR via gh CLI
```

**Parallel mode:**

```
orchestrator creates shared branch hive/{queryId}/shared
    │
    ▼
agents check file ownership before editing
    │
    ├─ file not owned → lock it, edit, commit
    └─ file owned by another → wait or pick different file
    │
    ▼
all done → commit to shared branch, optionally create PR
```
