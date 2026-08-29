# Security Policy

## Supported versions

| Version   | Supported        |
| --------- | ---------------- |
| `main`    | ✅               |
| `< 0.1.0` | ❌ (pre-release) |

## Reporting a vulnerability

**Do not open a public issue.**

Use GitHub “Report a vulnerability” (Security → Advisories → New draft advisory → Report) or email the maintainer listed on `https://github.com/sreekar2403/hive`.

Include steps to reproduce, impact, and any suggested fix. We aim to acknowledge within 72 hours.

## Scope notes

Hive spawns CLI agents with shell and `git` access to your working tree and binds `127.0.0.1` by default (`server.ts` `assertBindingIsSafe`). Binding `0.0.0.0` without `HIVE_AUTH_TOKEN` is refused. The API is loopback-only unless you opt into `HIVE_HOST` + `HIVE_AUTH_TOKEN` + `allowedOrigins`.

`permission.gateOn: "commands"` (default) watches the agent's shell tool stream via `runtimeGuard.ts`; it is detection, not sandboxing — see README “Sandboxed agent runs” under Upcoming.
