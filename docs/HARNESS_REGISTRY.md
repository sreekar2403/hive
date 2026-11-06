# Harness registry

Hive's harnesses are the CLI adapters it routes work to — Claude Code,
opencode, Codex, Gemini CLI, pi, aider, Amp, goose, Crush, Copilot CLI —
and any others added later. The list is closed today: every harness Hive
can run is known at compile time through the `HarnessId` union type in
`packages/server/src/config.ts`. There is no drop-in plugin mechanism yet;
"registry" describes the process of adding one, and the longer-term goal
is a plugin registry that needs no fork (see below).

## How to add a new CLI harness

Adding a harness touches six places. The recipe mirrors
`docs/DEVELOPMENT.md` ("Add a harness"); this doc walks it end to end.

### 1. Adapter — `packages/server/src/harnesses/<name>.ts`

Implement the `Harness` interface from `packages/shared/src/harness.ts`:
`isAvailable`, `execute`, `isCompatible`. Keep it thin — `runner.ts` does
the spawning, and `eventStream.ts` turns the CLI's output into the shared
`HarnessEvent` vocabulary (`text | thinking | tool | tool-result | usage |
status | error`). Pin the real shapes you observed in `eventStream.test.ts`;
that test is what turns "the chat window went blank" into a failing test
when a CLI changes its output format.

### 2. Profile entry — `packages/server/src/harnesses/profiles.ts`

Add a `HarnessProfile` entry describing what the CLI is good at: task
kinds, context size, speed, cost. The router reads this file when it
decides, so the profile is documentation that executes — not just docs for
humans.

### 3. Probe spec — `packages/server/src/harnesses/health.ts`

Add the harness to `harnessSpecs()`: the command, the args sent before the
prompt, and a `StreamParser` from `eventStream.ts` — or `parser: null` for
CLIs with no structured stream (only exit code is checked). This is what
`hive doctor` and `hive doctor --deep` verify on every machine.

### 4. Config default block and `HarnessId` — `packages/server/src/config.ts`

- Add the new id to the closed `HarnessId` union.
- Add a default block — `enabled`, `path`, `defaultModel`, `args`,
  `concurrency` — to `createDefaultConfig().harnesses`. Harnesses start
  disabled (`enabled: false`); startup reconciliation and the setup screen
  turn on exactly the CLIs that are actually installed, so a fresh config
  never claims agents a machine doesn't have.

### 5. Registration — `packages/server/src/harnesses/index.ts`

Export the adapter class from `harnesses/index.ts` alongside the existing
ones so the orchestrator can import it by id.

### 6. Client settings — `packages/client/src/pages/settings/`

- `types.ts`: add the id to the client's `HarnessId` mirror, `HARNESS_IDS`,
  `HARNESS_COMMANDS` and `HARNESS_LABELS`.
- `HarnessesSection.tsx`: the row that lets users enable/disable the CLI
  and set its path, default model and concurrency.
- `src/index.css`: give it a colour token (`--hive-agent-<name>`), then add
  it to `HARNESSES` in `pages/kanban/constants.ts` and `AGENT_VAR` in
  `OfficeFloorPage.tsx` so it shows on the board and floor.
- Model discovery (optional): teach `models/catalog.ts` how to ask the CLI
  what it can run, if it has a way to answer.

Any new _config field_ follows the four-place rule from
`docs/DEVELOPMENT.md`: server `Config` interface and `createDefaultConfig()`,
`validatePartialConfig` in `packages/server/src/routes/settings.ts`, the
client `SettingsConfig` mirror in `types.ts`, and the relevant section
component.

## From a closed list to a plugin registry

Today `HarnessId` is a closed union, so adding a harness is a fork-and-edit
of `packages/server/src`. The goal behind the name "registry" is a drop-in
mechanism: an adapter placed in `harnesses/` (or loaded from a plugin
directory) that Hive picks up without touching `config.ts` or rebuilding.
That is deliberately not this batch — `HarnessId` stays closed, and this
doc describes how the process works today.
