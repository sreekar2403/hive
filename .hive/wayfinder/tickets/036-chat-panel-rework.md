**Type:** wayfinder:task
**Blocked by:** 026, 027
**Blocks:** none

## Question

Rework `packages/client/src/ChatInterface.tsx` into the new Electron shell: replace the hardcoded
`http://localhost:3001/api/chat` fetch with 026's chosen transport, add the multi-session sidebar that
`SessionList`/`Ready` message types in `protocol.ts` already anticipate but nothing implements, and
surface live per-task output (from 027) inline instead of only showing the final result once the whole
task completes.
