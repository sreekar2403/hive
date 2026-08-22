# Hermes Harness Research

## Headline summary

**"Hermes" does resolve to a real, public CLI agent tool from Nous Research — but it is a much bigger, much heavier piece of software than the ticket's framing implies, and the disambiguation risk called out in the ticket is real and worth flagging even though the answer isn't "it doesn't exist."** The tool is **Hermes Agent**, published at `github.com/NousResearch/hermes-agent`, installed by a shell/PowerShell bootstrap script (not npm/PyPI), and exposing a `hermes` binary. It is *not* the same thing as the "Hermes" model family (Hermes 3/4 open-weight LLMs) — those are just model weights Hermes Agent can optionally talk to, and are a completely separate artifact from this CLI. There is also a separate, likely-confusable "Hermes" — Meta's Hermes JavaScript engine for React Native (`hermes-engine`, `hermes-compiler` on npm) — which has nothing to do with Nous Research, LLM agents, or this ticket. Practically for Hive: Hermes Agent does have a genuine one-shot, script-friendly execution mode (`hermes -z <prompt>`) suitable for spawning as a child process, and it can be pointed at local OpenAI-compatible endpoints including Ollama, LM Studio, vLLM, and llama.cpp — so the ticket is plausible to implement. But it is a full Python/Node hybrid application (memory, skills, messaging gateways, scheduling) installed via a curl-pipe-to-bash installer, not a lightweight single-purpose CLI like `claude`/`opencode`/`pi`, and its plain "final text only" one-shot mode does not natively emit the structured JSON or NDJSON event stream that `claudeCode.ts`/`opencode.ts` parse — so the `output` field construction will look more like `pi.ts`'s "use stdout as-is" approach than `opencode.ts`'s event-parsing approach, unless Hive is willing to pair `-z` with `--usage-file` for a secondary side-channel JSON blob.

---

## 1. Installation and invocation

**Answer:** Hermes Agent is not distributed via npm or PyPI. It is installed through Nous Research's own installer scripts:

- Linux/macOS/WSL2/Termux (Android): `curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash`
- Windows (native PowerShell): `iex (irm https://hermes-agent.nousresearch.com/install.ps1)`

The installer clones the `NousResearch/hermes-agent` git repo, provisions a Python 3.11 virtual environment (via `uv`), a Node.js v22 runtime (for some MCP servers), `ripgrep`, and `ffmpeg`, and symlinks a global `hermes` command — at `~/.local/bin/hermes` for a per-user install or `/usr/local/bin/hermes` for a root-mode install. After install, the binary is invoked directly as `hermes` from any shell.

Confidence: **high** for install mechanism and binary name (directly from the official installation docs); **medium** on exact dependency versions (Python 3.11/Node 22 figures came from a WebFetch summary of the docs page, not directly re-verified against raw source).

Sources:
- https://hermes-agent.nousresearch.com/docs/getting-started/installation
- https://github.com/NousResearch/hermes-agent

---

## 2. Non-interactive prompt-execution flags

**Answer:** Yes — there is a purpose-built "one prompt in, one answer out" mode:

```
hermes -z "What's the capital of France?"
# → Paris.
```

Per the CLI reference docs, `-z` gives "single prompt in, final response text out, nothing else on stdout or stderr" — no banner, no spinner, no tool-call previews, no `Session:` line. This is explicitly positioned for programmatic callers: shell scripts, CI pipelines, cron jobs. It also accepts piped stdin as the prompt body:

```
answer=$(hermes -z "summarize this" < /path/to/file.txt)
```

Other flags relevant to non-interactive invocation:
- `--query-file PATH` — reads the prompt from a file rather than argv, avoiding shell interpretation of untrusted prompt text.
- `-Q, --quiet` — suppresses banner/spinner/tool-preview even outside `-z`.
- `--usage-file <path>` — writes a JSON side-channel report (see Q3) after the run completes, including on failure.
- `-m, --model <model>` / `--provider <provider>` — per-invocation overrides of model/provider (see Q5).

A second, less minimal one-shot mode also exists: `hermes chat -q "<prompt>"`, which runs non-interactively but keeps session metadata and tool-call previews in the output (i.e., it is not "final answer only").

Confidence: **high** for the existence and basic semantics of `-z`, `--query-file`, `--usage-file`, `-q` (drawn directly from `website/docs/reference/cli-commands.md` in the official repo). **Medium** on the exact wording of flag help text, since content was retrieved via WebFetch's summarization rather than a raw diff/grep of the file.

Sources:
- https://github.com/nousresearch/hermes-agent/blob/main/website/docs/reference/cli-commands.md
- https://hermes-agent.nousresearch.com/docs/reference/cli-commands

---

## 3. Stdout output format in non-interactive mode

**Answer:** In `-z` mode, stdout is **plain text** — just the agent's final reply, nothing else (no JSON envelope, no NDJSON event stream). Example from the docs:

```
$ hermes -z "What's the capital of France?"
Paris.
```

This is fundamentally different from both:
- `claude -p <prompt> --output-format json` (single structured JSON object on stdout), and
- `opencode run --pure --format json <prompt>` (newline-delimited JSON events, one per line, that `opencode.ts`'s `parseOpenCodeOutput` scans for `event.type === 'text'` / `event.part.text`).

Hermes's closer analogue is `pi -p <prompt>` — raw stdout text used directly as the result — because `-z` produces no structured envelope to parse; the entire stdout string *is* the answer.

There is a secondary, separate JSON artifact available via `--usage-file <path>`: after the run, Hermes writes a JSON report to that file path (not stdout) containing `estimated_cost_usd`, input/output/cache token counts, `api_calls`, `model`, `provider`, `session_id`, and completion status. This file is written even on failed runs, which makes it useful for cost/telemetry accounting, but it is not a substitute for a structured result payload — it carries no "text" or "output" field describing what the agent did, only usage/cost metadata. I could not find documentation of any flag that combines `-z` (or `-q`) with a `--json`/`--output-format json` style flag to get a single structured JSON object containing the answer text on stdout the way `claude -p --output-format json` does. A `--json` flag does exist elsewhere in the CLI (on `hermes send`, `hermes peer dm`, `hermes logs`), but I found no evidence it composes with `-z`.

**Parseability assessment:** because `-z` stdout is already just the final text (no wrapper, no event lines to filter), a Hive `parseHermesOutput`-equivalent would not need `opencode.ts`'s per-line-JSON-scan logic at all — it can do what `pi.ts` does and simply use `stdout` (trimmed) as `output` directly. If Hive wants machine-readable metadata (token/cost accounting) it would need to additionally read the `--usage-file` path after the process exits and merge that in as auxiliary data (not as the `output` string).

Confidence: **high** on `-z` producing plain final text with no envelope (explicit statement in official docs, and matches the "nothing else on stdout" framing directly quoted from the reference). **Low** on whether any hidden/undocumented flag combination yields structured single-JSON-object output on stdout — I could not find one documented, but did not exhaustively check `hermes --help` output directly (no shell access to a live install).

Sources:
- https://github.com/nousresearch/hermes-agent/blob/main/website/docs/reference/cli-commands.md
- https://hermes-agent.nousresearch.com/docs/reference/cli-commands

---

## 4. Streaming / incremental output during execution

**Answer:** Mixed picture, mode-dependent.

- In **interactive mode** (plain `hermes`, no `-z`), the docs describe the CLI as streaming responses token-by-token to the terminal, with inline tool-progress indicators so a human watching the session can see what the agent is doing as it happens.
- In **`-z` (pure one-shot) mode**, the explicit design intent is the opposite: "nothing else on stdout or stderr" until the final reply — i.e., it is documented as suppressing the interactive streaming/progress UI in favor of a single final block of text. The docs do not describe `-z` as flushing partial tokens to stdout incrementally; it reads as a "wait for completion, then print the final answer" mode, consistent with how `--usage-file` is described as written "after execution."

I found no documentation of an NDJSON/event-stream flag for programmatic incremental consumption (nothing analogous to opencode's `--format json` line-by-line event stream). If Hive needs true incremental/streaming consumption of Hermes's work in progress, the interactive mode's token streaming would need to be captured from a live TTY-adjacent process (not `-z`), which is a materially different integration than the other three harnesses' one-shot `spawn()` + wait-for-close pattern.

Confidence: **medium**. This is inferred from wording in secondary summaries of the docs (I did not find a single source that states outright "no partial output" for `-z` in as many words) plus the explicit "final response text out, nothing else" framing, which strongly implies no incremental flush. Recommend re-verifying directly against a live `hermes -z` run before finalizing the implementation.

Sources:
- https://github.com/nousresearch/hermes-agent/blob/main/website/docs/reference/cli-commands.md
- https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server (mentions streaming tool-progress indicators for the API-server/interactive surface)

---

## 5. LLM providers / models, including local inference servers

**Answer:** Hermes Agent supports a very large provider matrix — the docs claim 100+ providers, including:

- **Nous Portal** (Nous Research's own unified gateway, described as the "recommended" default, routing to 300+ models)
- OpenAI (direct API and Codex via OAuth)
- Anthropic Claude (native API and OAuth/Max-plan)
- GitHub Copilot (direct API and ACP subprocess mode)
- Google Gemini (API key or Vertex AI)
- xAI Grok
- OpenRouter
- AWS Bedrock (Claude, Nova, DeepSeek)
- Fireworks AI, Novita AI, DeepSeek, MiniMax, Qwen Cloud/DashScope, Kimi/Moonshot, z.ai/GLM, Arcee AI, NVIDIA NIM, StepFun, Hugging Face Inference, and more, via API keys stored in `~/.hermes/.env`.

**Local inference: confirmed, yes.** Hermes has a first-class "custom provider" framework for any OpenAI-compatible endpoint, and documents explicit setups for:

- **Ollama** — point `base_url` at `http://localhost:11434/v1`, e.g.:
  ```yaml
  model:
    default: qwen2.5-coder:32b
    provider: custom
    base_url: http://localhost:11434/v1
    context_length: 64000
  ```
  (Docs flag a real gotcha here: Ollama defaults to a small context window server-side and this must be raised independently via `OLLAMA_CONTEXT_LENGTH`, since it isn't controllable through the OpenAI-shaped API — corroborated by a live GitHub issue, `NousResearch/hermes-agent#7516`, about `base_url` needing the `/v1` suffix for the OpenAI SDK client to hit the right path.)
- **LM Studio** — either a named provider (`provider: lmstudio`) with auto-discovery via `hermes model`, or manually via `lms load <model> --context-length <n>` plus config.
- **vLLM**, **SGLang**, **llama.cpp/llama-server** — all configured the same "custom provider + base_url" way, each requiring a server-side flag for tool-calling support (`--enable-auto-tool-choice --tool-call-parser hermes` for vLLM; `--tool-call-parser qwen` for SGLang; `--jinja` for llama.cpp).
- A **named multi-provider** config block (`providers: <name>: { api: <url>, key_env / key_cmd }`) lets several custom endpoints coexist and be switched mid-session with `/model custom:<name>:<model>`.

Provider/model selection is controlled by:
- `hermes model` — the interactive provider-setup wizard (only way to *add* a new provider or run its OAuth flow).
- `/model <provider>:<model>` inside an active session — switch among already-configured providers/models; `/model --global` persists the choice to `config.yaml`.
- CLI override flags on any invocation: `-m/--model <model>`, `--provider <provider>`.
- Env var `HERMES_INFERENCE_MODEL` — sets the default model.
- Config file `~/.hermes/config.yaml` — `model.default`, `model.provider`, `model.base_url` (or `providers.<name>.api`), `model.context_length`, `model.max_tokens`.

Confidence: **high** for "yes, local OpenAI-compatible endpoints including Ollama/LM Studio are supported" and for the general provider list breadth (corroborated across the official providers doc page, the FAQ, and a live GitHub issue about Ollama base_url behavior). **Medium** on exact YAML key names / flag spelling, since this was retrieved through WebFetch summarization of the docs rather than a byte-exact read of the raw markdown source.

Sources:
- https://hermes-agent.nousresearch.com/docs/integrations/providers
- https://github.com/NousResearch/hermes-agent/blob/main/website/docs/integrations/providers.md
- https://github.com/NousResearch/hermes-agent/issues/7516
- https://docs.ollama.com/integrations/hermes

---

## Verification of the naming risk (explicit, as requested)

The ticket explicitly asked to check whether "hermes" is a real CLI or a mix-up with the Hermes *model* family. Findings:

1. **A real CLI does exist and is named `hermes`.** It ships from `github.com/NousResearch/hermes-agent`, is described on its own docs site (`hermes-agent.nousresearch.com`) as "the self-improving AI agent built by Nous Research," and is a distinct product from the Hermes model weights (Hermes 3, Hermes 4, etc.) — those are LLMs the agent can optionally call as *one of its providers*, not the CLI itself. This is directly analogous to how Hive's own `claude-code` harness calls the `claude` binary, which itself can be pointed at different Claude *models* — the binary and the model family are not the same thing, and the same separation holds for Hermes Agent vs. the Hermes model weights.
2. **It is a much larger piece of software than a lightweight one-shot harness.** Unlike `claude`, `opencode`, or `pi`, Hermes Agent bundles a persistent memory system, a skill-creation/learning loop, a messaging gateway to 20+ chat platforms, scheduled cron automations, and an installer that provisions Python + Node + ripgrep + ffmpeg. It is architecturally a full personal-agent product, not a minimal CLI-only coding-agent harness — worth flagging to the team even though it does have the one-shot mode the ticket needs.
3. **Genuinely unrelated "hermes" collisions exist and must not be confused with this tool:**
   - `hermes-engine` / `hermes-compiler` / `@react-native-community/cli-hermes` (npm) — **Meta's Hermes JavaScript engine** for React Native. Nothing to do with LLM agents or Nous Research.
   - `hermes` (npm) — described in search results as "a friendly, pluggable chat bot" — a different, unrelated small chat-bot framework, not an LLM agent CLI, not from Nous Research.
   - `@so-me/hermes-agent` (npm) — a *third-party integration layer* between a service called "so-me.studio" and the Nous Hermes 4 *model*; explicitly not the official Nous Research Hermes Agent CLI product, despite the confusingly similar package name.
   - `hermes-cli` (npm) — unrelated tool for searching travel agencies in Brazil.
   - `@hermes-serverless/cli` (npm) — unrelated serverless build/deploy CLI for C++/CUDA functions.

   None of these should be installed or referenced when implementing this ticket; the correct source is exclusively `github.com/NousResearch/hermes-agent` / `hermes-agent.nousresearch.com`.

Confidence: **high** — corroborated by the official Nous Research docs site, the official GitHub org (`NousResearch`), and cross-checked against independent npm search results showing the unrelated same-named packages.

Sources:
- https://github.com/NousResearch/hermes-agent
- https://hermes-agent.nousresearch.com/
- https://www.npmjs.com/package/hermes
- https://www.npmjs.com/package/hermes-engine-cli
- https://www.npmjs.com/package/@react-native-community/cli-hermes
- https://www.npmjs.com/package/@so-me/hermes-agent
- https://www.npmjs.com/package/hermes-cli
- https://www.npmjs.com/package/@hermes-serverless/cli

---

## Implications for HermesHarness implementation

This section is grounded in what was actually read from `packages/shared/src/harness.ts`, `packages/server/src/harnesses/claudeCode.ts`, `packages/server/src/harnesses/opencode.ts`, and `packages/server/src/harnesses/pi.ts` in this repo.

**Verdict: the ticket is implementable, not blocked** — a real `hermes` binary with a one-shot mode exists — but it needs re-scoping expectations around (a) installation being a heavyweight curl-installer rather than an npm/pip dependency Hive can pin, and (b) output shape being closer to `pi.ts`'s "raw stdout" pattern than `opencode.ts`'s "parse NDJSON events" pattern.

Concretely, a `HermesHarness` implementing the `Harness` interface would look structurally like the existing three (same `spawn`/`execSync`/promise-wrapped shape), with these specifics:

```ts
export class HermesHarness implements Harness {
  name = 'hermes';
  private _path: string;
  private _model: string;

  constructor(path = 'hermes', model = 'hermes') {
    this._path = path;
    this._model = model;
  }

  isAvailable(): Promise<boolean> {
    // Same pattern as the other three: spawn `hermes --version`, resolve
    // true/false on close/error. (Need to confirm `--version` is actually
    // the flag Hermes exposes — not verified directly against a live
    // install; `hermes -h`/`hermes --help` may be the safer probe.)
  }

  execute(prompt: string, options?: HarnessOptions): Promise<HarnessExecutionResult> {
    // spawn(this._path, ['-z', prompt, '--model', this._model], { ...cwd/env/shell })
    // Optionally add ['--usage-file', <tmp path>] and read+parse that file
    // after `close` to populate cost/token metadata, mirroring how
    // opencode.ts calls detectFilesChanged() as a post-close side-effect.
    //
    // Unlike opencode.ts, there is no need for a parseHermesOutput()
    // line-by-line JSON scanner: `-z` stdout IS the final answer text,
    // so `output: stdout || stderr` (pi.ts's approach) is the right shape.
  }

  isCompatible(model: string): boolean {
    // model === this._model || model.includes('hermes')
    // — mirrors claudeCode.ts/opencode.ts/pi.ts's substring-match style.
    // Note this needs to NOT collide with Hive's notion of the Hermes
    // *model* family if Hive elsewhere lets users pick "hermes-3"/"hermes-4"
    // as a model name for a *different* harness (e.g. via Ollama through
    // opencode/pi) — worth a naming discussion with the team since "hermes"
    // is both this harness's name and a model family name used elsewhere.
  }
}
```

Open items that need resolving before/during implementation, beyond what this research could settle from docs alone:

1. **Confirm `--version` support** (or find the right availability-probe flag) directly against a live `hermes` install — not found explicitly in the docs pages read.
2. **Confirm exact `-z` flag composition with `-m/--model`/`--provider`** (order, whether they can precede or must follow the prompt) — the docs show these as separate flag families but don't give a single combined example command.
3. **Decide whether to shell out via the heavyweight installer at all**, given Hermes Agent is a large stateful application (SQLite memory, skills, gateway) rather than a narrow one-shot binary — this is a bigger dependency footprint than `claude`/`opencode`/`pi` and may warrant a `HERMES_SKIP_*`-style env var or config flags to keep spawned instances stateless/ephemeral per Hive's process-per-prompt execution model. Not addressed in any doc page found.
4. **Decide on `filesChanged` detection.** The existing three harnesses all reuse an identical `detectFilesChanged()` git-diff helper after `close`; nothing about Hermes suggests this needs to differ, since it's still a CLI mutating a working directory — this part should port unchanged.
5. **Local-endpoint compatibility is real and documented** (Ollama/LM Studio/vLLM/llama.cpp via `provider: custom` + `base_url`), so if Hive wants a "run any harness against a local model" story, Hermes is actually a strong candidate — arguably stronger than the other three, given how first-class the custom-endpoint docs are.
