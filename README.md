# Hive

**Hive drives CLI coding agents the way a manager drives a team.** You describe a change; Hive
picks the agent best suited to it, runs it against a real git working tree, retries when it fails,
and shows you what it did — tool calls, thinking, token spend, files touched.

The agents are not built into Hive. They are the CLIs you already have on your PATH — `opencode`,
`claude` (Claude Code), `pi` — and Hive is the thing that routes work to them, keeps them honest,
and gives you one place to watch it happen.

```
┌─────────────────────────────────────────────────────────────┐
│  Electron window / browser  ·  React UI (packages/client)   │
└──────────────────────────┬──────────────────────────────────┘
                           │  REST + Server-Sent Events
┌──────────────────────────▼──────────────────────────────────┐
│  Express API on :3001  (packages/server)                    │
│                                                             │
│   Orchestrator ── Router ──── which harness, which model    │
│        │       ── LoopEngine ─ retry until it works         │
│        │       ── Permissions ─ gate destructive work       │
│        │       ── Resources ─── file locks                  │
│        ▼                                                    │
│   Harness adapters → spawn a CLI, parse its event stream    │
└──────────────────────────┬──────────────────────────────────┘
                           ▼
            opencode  ·  claude  ·  pi        (your git repo as cwd)
```

---

## Why this exists

You already run **Claude Code + OpenCode + local models**. Now manage them like a team instead of five terminals.

Hive is the orchestration layer that turns a collection of CLI agents into a coherent swarm:

| Problem                   | How Hive solves it                                                                                    |
| ------------------------- | ----------------------------------------------------------------------------------------------------- |
| **Which agent for what?** | Routing rules + learned performance pick the right harness per task                                   |
| **Keeping agents honest** | Loop engine retries on real errors, stops on real failures, shows every tool call                     |
| **Context switching**     | One chat window, persistent sessions per project, activity trail survives page changes                |
| **Memory that sticks**    | Second Brain builds `soul.md` from what it observes — your preferences, which harness wins which work |
| **Visibility**            | Office floor (isometric), Kanban board, live logs, git diffs — all in one window                      |

---

## What it looks like

![The Hive dashboard: who is working, what is uncommitted, which harnesses are online](sample.png)

## Quick start

**Prerequisites**

- Node.js 22+ and [pnpm](https://pnpm.io) 9+
- At least one agent CLI on your PATH. Check with `opencode --version`, `claude --version`,
  or `pi --version` — Hive works with one, and routes across all three if you have them.

```bash
pnpm install
pnpm --filter hive exec npm link   # optional: puts `hive` on your PATH
hive                               # API server + UI + desktop window
```

Then either use the window Hive opened, or visit <http://localhost:3000>.

`hive doctor` checks the whole setup — Node version, ports, which agent CLIs it can find — and is
the first thing to run when something doesn't come up.

### The `hive` command

| Command              | What it starts                                                           |
| -------------------- | ------------------------------------------------------------------------ |
| `hive`               | API server, Vite dev server, and the Electron window, as one process     |
| `hive web`           | API server + UI; open <http://localhost:3000> yourself                   |
| `hive server`        | API server only, on :3001                                                |
| `hive stop`          | Frees Hive's ports, whatever is holding them                             |
| `hive doctor`        | Checks this machine can run all of the above                             |
| `hive doctor --deep` | Also runs one real prompt per CLI to prove its event stream still parses |

Useful flags: `-p/--port` (API port), `--ui-port`, `--devtools`, `--no-window`, and for the doctor
`--deep` / `--json`. `hive --help` has the full list.

Every child process runs with the repo root as its working directory. That matters: the server
resolves `hive.config.json` against `process.cwd()`, so starting the pieces by hand from elsewhere
loads different configuration. `hive` guarantees the right cwd; if you start things manually, do it
from the repo root.

---

## What you get

### Scopes: projects and the General workspace

Everything in Hive is scoped to a **project** — a git working tree you point it at from the switcher
in the top bar. Tasks, diffs, chats and schedules all belong to one.

There is also always a **General workspace**: a scope that belongs to no repository, for the
questions that aren't about your code ("what does this error mean", "write me a cron expression").
It lives in `~/.hive/workspace` by default, is created and `git init`-ed on first use, and can be
pointed elsewhere under **Settings → General**. Nothing you ask there can touch your projects.

### Chat

Describe a change; Hive routes it, runs it, and streams back what the agent actually did. The
activity trail under each answer shows tool calls, thinking blocks and token spend as they happen —
and is still there after the fact. Runs keep going if you navigate away.

The composer's model picker lists what this machine can genuinely run, discovered live rather than
configured: `opencode models`, `pi --list-models`, Ollama's `/api/tags`, LM Studio's `/v1/models`,
plus Claude Code's documented aliases and the Anthropic API's model list when a key is set. A model
is identified end to end as `harness/provider/model`, so choosing one pins the harness too.

### The staged loop

By default a task is one harness run, retried on a retryable error. Turn on the **staged loop**
(Settings → Execution) and it becomes five, each with a gate that can send the work back:

```
plan → implement → test → review → ship
```

The gates are the point, because a harness that does the wrong thing still exits zero:

- **implement** fails if the working tree is unchanged — a run that touched nothing did nothing,
  however confident its summary reads.
- **test** runs the project's own test command (detected from `package.json`, `Cargo.toml`,
  `go.mod`, `pyproject.toml`, or set explicitly) and sends failures back to implement, bounded by
  a repair budget so it cannot loop forever.
- **review** blocks a diff carrying conflict markers, a stray `debugger`, a new `FIXME`, or an
  `it.only`. A configured model can add a second opinion; the harness reviews its own diff when
  none is.

Stages drive the Office floor, so the room a character is standing in _is_ the stage it reached.

### Parallel agents

`createParallelBranches` gives each task its own branch **and its own git worktree** — a real
directory sharing the repository's object store — so two agents editing the same file are editing
two different checkouts. Branches merge back one at a time; the first conflict stops the run,
reports the files, and aborts the merge rather than resolving it for you.

Because those worktrees are invisible to each other, agents in a session share a **mailbox**
(`/api/messages`): one agent leaves a note about what it moved or renamed, and the next agent to
start is told once, in its prompt.

### Board, workflows, schedules

- **Kanban** — eight columns across the real life of a task: Backlog, Queued, In progress, In
  review, Testing, Blocked, Done, Failed. Drag or use each card's column control; columns collapse
  so all eight fit; WIP limits flag an overloaded column.
- **Workflows** — a node graph (trigger, agent task, tool, gate, approval, parallel, join, output)
  with undo/redo, auto-layout and validation.
- **Schedule** — cron-backed recurring runs, with the history of what actually fired.

### Watching and inspecting

- **Office** — an isometric floor where each agent stands in the zone matching its task's stage.
  Decorative on purpose, but the positions are real: zone = pipeline phase.
- **Dashboard** — who's working, what's uncommitted, which harnesses are online.
- **Capacity** — how many agents run at once is a property of your machine, not a number typed
  once: leave `loop.maxConcurrentAgents` at `0` and Hive sizes it from your cores and memory.
  Runs past the limit queue in arrival order instead of fighting over the machine, and the Office
  header and the board's "In progress" limit both follow the same number.
- **Changes** — working-tree and staged diffs, and commit history, per project.
- **Logs** — a live tail plus per-task trace spans, so a run can be opened from the message that
  produced it.
- **Memory** — the per-session key/value store agents share, browsable and editable.
- **Permissions** — approve or deny work Hive classified as destructive. This is a real gate: a
  task waiting here is genuinely blocked until someone answers or it times out.

### Credentials: the CLIs bring their own

Hive has no API-key settings, on purpose. Every harness CLI holds its own
authentication — `claude /login` for Anthropic, `opencode auth login` for OpenAI,
OpenRouter and Google — and Hive uses whatever that CLI is already signed in
with. If a model works in the terminal, it works in Hive.

The only servers configured directly are the local ones that need no key at
all — Ollama and LM Studio — whose base URLs live under `localModels`.

---

## Configuration

`hive.config.json` at the repo root is merged over the built-in defaults, and the `PORT`
environment variable wins over both. Everything in it is editable from the Settings screen, which
writes the same file — so the UI and the file never drift.

```jsonc
{
  "localModels": {
    "ollama": "http://localhost:11434",
    "lmstudio": "http://localhost:1234",
  },
  "harnesses": {
    "opencode": {
      "enabled": true,
      "path": "opencode",
      "defaultModel": "…",
      "args": [],
      "concurrency": 2,
    },
  },
  "routing": {
    "default": "opencode",
    "fallback": "claude-code",
    "rules": [
      {
        "id": "test",
        "pattern": "test|spec|assert",
        "harness": "opencode",
        "enabled": true,
      },
    ],
  },
  "permission": {
    "enabled": true,
    "timeout": 60000,
    "destructiveActions": ["rm", "push --force"],
  },
  "loop": {
    "maxIterations": 10,
    "timeoutMs": 300000,
    "maxConcurrentAgents": 3,
  },
  "storage": { "cacheDir": "./.hive-cache" },
  "general": { "defaultProjectId": "", "rootDirectory": "" },
}
```

`routing.rules` is an ordered table — array order _is_ priority, and the rule with
`taskType: "default"` is always the catch-all. `general.rootDirectory` is the General workspace's
folder; blank means `~/.hive/workspace`.

**Where state lives**

| What                                               | Where                                 |
| -------------------------------------------------- | ------------------------------------- |
| Projects, tasks, workflows, schedules, logs, spans | `storage/cache/hive.db` (SQLite, WAL) |
| Shared memory                                      | `.hive-cache/<sessionId>/<key>.json`  |
| Configuration                                      | `hive.config.json`                    |
| General workspace                                  | `~/.hive/workspace` (configurable)    |
| Chat sessions, UI prefs                            | browser `localStorage`                |

---

## Development

```bash
pnpm dev:server     # API server via tsx, no build step
pnpm dev:client     # Vite dev server for the UI
pnpm dev:electron   # UI + Electron window
pnpm build          # tsc --build across shared + server
pnpm test           # vitest (44 tests)
pnpm lint           # eslint
pnpm format         # prettier --write .
```

See **[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)** for the package layout, how to add a harness, a
provider or a settings field, and the sharp edges worth knowing about before you hit them.
**[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** covers how a request becomes a running agent, and
**[docs/API.md](docs/API.md)** is the REST + SSE reference.

## Repository layout

```
bin/hive.js              the `hive` command
packages/shared          types shared across packages (no runtime code)
packages/server          Express API, orchestrator, harness adapters, SQLite
packages/client          React UI (Vite) + the Electron shell
packages/ui              empty scaffold — packages/client is the real UI
docs/                    architecture, development, API, design system
docs/examples/           ready-to-import workflow recipes
hive.config.json         configuration, read and written by the app
```

## Troubleshooting

| Symptom                                    | Cause and fix                                                                                                                  |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| A task hangs and then fails                | Its prompt matched `permission.destructiveActions`. Answer it on the **Permissions** screen; unanswered, it times out.         |
| The model picker is empty                  | No agent CLI is on PATH and Ollama/LM Studio aren't running. `hive doctor` says which.                                         |
| The activity trail is empty for a harness  | That CLI changed its output format. `hive doctor --deep` runs one real prompt through each CLI and says which stopped parsing. |
| "not a git repository"                     | The scope's folder isn't a repo. Changed-file detection needs one — that's why the General workspace `git init`s itself.       |
| Ports already in use                       | `hive stop`, or start with `-p` / `--ui-port`.                                                                                 |
| Settings look stale after editing the file | The config is a cached singleton. Restart the server, or edit through the Settings screen, which updates it in place.          |

## License

[MIT License](LICENSE)
