# Hive roadmap

Public-facing plan, grouped by horizon. There are no dates on purpose —
these are the problems Hive is working toward, not a release calendar.

## Near-term (0.x)

- **Spend caps** — done (F2). Token and cost ceilings per project and per day
  that refuse a run rather than reporting the damage afterwards.
- **Sandboxed agent runs** (S5) — deferred. The permission gate detects and
  stops destructive commands; it does not contain them. An opt-in container or
  gVisor sandbox per worktree is the next step for bounding blast radius.
- **Scoped tokens** — done (S2). `server.tokenScopes` and `mcp.allowedRoots`
  let an MCP client be narrowed to the repos you actually want reachable.
- **Fan-out review/revert** — done (F3b). Parallel sub-agents run in their own
  worktrees and branches, and branches merge back one at a time; the first
  conflict aborts rather than resolving for you.

## Medium-term

- **Harness registry (P5)** — drop-in CLI adapters without forking Hive.
  Today a new harness needs an adapter, a profile entry, a health probe, a
  config block and registration; see `docs/HARNESS_REGISTRY.md` for the
  current process, which uses a closed `HarnessId` union.
- **Simple mode (P4)** — progressive disclosure for first-time setups. A
  `simpleMode` config flag pins a single default harness, keeps the staged
  pipeline off, keeps fan-out off, and hides advanced settings in the UI.
  The permission gate and budget checks stay on either way.
- **Cloud tunnel docs (P2)** — binding non-loopback requires `HIVE_AUTH_TOKEN`;
  ngrok or cloudflared tunnels can expose the API remotely. Documentation
  only; no code change.

## Longer-term

- **MCP in both directions** — outbound calls to MCP servers for work too
  small for a whole agent CLI, and Hive itself (tasks, board, routing
  decisions) exposed as an MCP server.
- **OpenTelemetry GenAI traces** — emit the GenAI semantic conventions over
  OTLP so runs land in Grafana or Honeycomb instead of only the built-in
  Logs page.
- **Router scorecard** — surface which agent wins which category, over how
  many samples, so the Second Brain's learning is visible instead of implicit.
