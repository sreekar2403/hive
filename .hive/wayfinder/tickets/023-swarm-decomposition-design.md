**Type:** wayfinder:grilling
**Blocked by:** none
**Blocks:** 024, 029, 021 (category taxonomy, loosely — see Notes)

## Question

This is the biggest single decision on the map. The user wants **automatic** task decomposition: one
high-level request comes in, and Hive itself splits it into subtasks assigned across harnesses/models,
"based on the requirement with a cap." Resolve: what does the splitting (a dedicated planner/lead-agent
call — using which model? one of the four harnesses, or a direct API call?); what shape a subtask takes
(does it reuse today's `AgentTask`, or need a parent/child relationship — feeds into 018's schema); how
the cap works (fixed max subtask count? user-configurable in Settings? per-request override?); how
subtask results get merged back into one answer for the user; how partial failure is handled (one
subtask fails — does the whole request fail, retry just that subtask, or proceed with partial results);
and how this interacts with the existing `createParallelBranches`/`createSequentialBranches` methods on
`Orchestrator` (does decomposition decide parallel vs. sequential per subtask, or is that still a
separate axis). Note: this ticket's category taxonomy (if it needs one, to route subtasks) should stay
aligned with whichever of this ticket or 021 resolves first — don't invent two incompatible category
lists.
