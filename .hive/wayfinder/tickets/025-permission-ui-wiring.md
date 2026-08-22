**Type:** wayfinder:task
**Blocked by:** 018
**Blocks:** 032

## Question

`PermissionManager.approve`/`deny` exist but nothing in the codebase calls them — every task classified
"destructive" (via `config.permission.destructiveActions` substring match) silently times out and fails
after `config.permission.timeout` (default 60s), because there's no endpoint or UI surfacing the pending
request for a human to answer. Wire a real path: an endpoint (or, once 026 lands, an IPC call) the
renderer can hit to call `approve(requestId)`/`deny(requestId, reason)`, and a way for the renderer to
learn a request exists in the first place (poll `getPending`, or push it once the transport from 026 is
decided). Persist resolved requests to the history table from 018 so the Permissions panel (032) has
something to show beyond the live queue.
