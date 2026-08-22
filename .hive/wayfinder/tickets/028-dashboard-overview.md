**Type:** wayfinder:prototype
**Blocked by:** 026
**Blocks:** none

## Question

Design and land the main Dashboard panel: an overview of all sessions/tasks and their status, the
"track my agents" view the user asked for. What's on it (active tasks with live status, recent history,
harness/provider utilization, a quick way to jump into a session's Chat or Kanban)? How does it summarize
a swarm run (once 023 lands) — one row per parent task with an expandable subtask breakdown, or a flatter
list? Prototype it against real data from the sidecar server (026's transport) rather than as a static
mock, and land it as the app's default landing panel.
