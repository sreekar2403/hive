**Type:** wayfinder:prototype
**Blocked by:** 018, 026
**Blocks:** none

## Question

Design and land the Kanban panel: tasks (and, once 023 lands, subtasks) organized by status columns
(pending/running/needs-approval/completed/failed, or whatever set actually maps cleanly onto the state
machine `AgentTask.status` and `TaskContext.status` already use — reconcile the two if they've diverged
by the time this is worked). Decide whether subtasks nest under their parent card or appear as their own
cards with a parent-link badge, and whether cards are drag-to-reprioritize or purely status-reflecting
(read-only, mirroring the actual backend state like the git panel does).
