**Type:** wayfinder:prototype
**Blocked by:** 023, 026
**Blocks:** none

## Question

Design and prototype the visual "office floor" view showing agents at work, in the style of the
munder-difflin reference (Pixi.js-rendered 2D space, avatar characters, visual indicators for agents
moving/working, messages flying between them). Key open questions: what does an "agent" on the floor
correspond to once swarm decomposition (023) can spawn several concurrent subtasks — one avatar per
active subtask, per harness, or per top-level task? What states does an avatar show (idle, working,
blocked-on-permission, done, failed)? Is this pure decoration alongside the functional panels, or does
clicking an avatar navigate into that task's live output/Chat? Scope the art approach pragmatically —
this doesn't need to match the reference's specific "Animal Crossing × Earthbound × SNES" pixel style
unless that's wanted; simple sprite states may be enough for a first version.
