**Type:** wayfinder:task
**Blocked by:** 016, 017, 026
**Blocks:** 036

## Question

Today every harness (`opencode.ts`, `claudeCode.ts`, `pi.ts`) `spawn`s the CLI, buffers all of stdout/
stderr, and resolves once with the full result after the process exits — the UI can only show a spinner
until the whole task is done. Per the destination decision "PTY where it helps, captured-stream fallback
where a harness's real output is structured JSON": for each harness (plus the new `hermes.ts` from 016),
decide and implement whether it streams via real PTY (`node-pty`) or via streaming the captured stdout
chunks as they arrive (still useful for live display even without full terminal emulation, and safer for
`opencode`'s `--format json` output which needs parsing, not raw display). Wire the chosen transport from
026 to actually push these chunks to the renderer as they happen, not just the final `HarnessExecutionResult`.
