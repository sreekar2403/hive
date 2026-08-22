**Type:** wayfinder:grilling
**Blocked by:** 017, 023
**Blocks:** none directly (informs `ResourceManager`, already covered structurally by 019)

## Question

Design VRAM-aware sequencing for local-model subtasks: "we need to be mindful of vram and sequentialise
the work properly" (user's words). Resolve: how Hive detects "this subtask is about to use a local model"
(from 017's findings on how each harness signals its provider/model — likely from the task's resolved
harness+provider+model, not runtime introspection); whether VRAM is actively measured (e.g. shelling out
to `nvidia-smi` if present) or simply assumed-scarce (serialize *all* local-model tasks unconditionally,
one at a time, as the safe default — matching the old Phase-1 ticket 011's "boolean lock + FIFO queue for
local models, cloud tasks bypass entirely"); how this queue interacts with 023's parallel subtask
dispatch (a swarm run with 4 subtasks, 2 of which are local-model, should run the 2 cloud ones freely
while the 2 local ones wait their turn); and queue-wait UX (does the Kanban/Dashboard show "queued —
waiting for local model slot" as a distinct status).
