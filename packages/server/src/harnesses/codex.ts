import {
  Harness,
  HarnessExecutionResult,
  HarnessOptions,
} from "@hive/shared/harness";
import { CodexParser } from "./eventStream";
import { probeAvailable, runHarness } from "./runner";
import { attachmentPreamble, splitForCodex } from "./attachments";

/**
 * OpenAI's Codex CLI.
 *
 * `codex exec` is the non-interactive entry point — the interactive `codex`
 * with no subcommand opens a TUI and would hang here. `--json` turns on the
 * event stream CodexParser reads.
 *
 * Sandboxing is left at the CLI's own default rather than relaxed: Hive
 * already gates destructive work through PermissionManager, and a harness
 * that quietly grants itself more filesystem reach than the user's own
 * `codex` session has is the wrong kind of surprise.
 */
export class CodexHarness implements Harness {
  name = "codex";
  private _path: string;
  private _model: string;

  constructor(path = "codex", model = "") {
    this._path = path;
    this._model = model;
  }

  isAvailable(): Promise<boolean> {
    return probeAvailable(this._path);
  }

  execute(
    prompt: string,
    options?: HarnessOptions,
  ): Promise<HarnessExecutionResult> {
    const args = ["exec", "--json", "--skip-git-repo-check"];

    const model = options?.model || this._model;
    if (model) args.push("--model", model);

    // Codex's --image takes images and nothing else; a CSV handed to it
    // fails the run. Images go through the flag, everything else is named
    // in the prompt for Codex to open itself.
    const { imageArgs, rest } = splitForCodex(options?.attachments);
    args.push(...imageArgs);

    args.push(`${attachmentPreamble(rest)}${prompt}`);

    return runHarness({
      command: this._path,
      args,
      options,
      parser: new CodexParser(),
    });
  }

  isCompatible(model: string): boolean {
    // Codex takes a bare model id (`gpt-5-codex`, `o4-mini`), never a
    // `provider/model` pair — that form belongs to opencode and pi.
    return !model || !model.includes("/") || model === this._model;
  }
}
