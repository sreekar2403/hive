import {
  Harness,
  HarnessExecutionResult,
  HarnessOptions,
} from "@hive/shared/harness";
import { CursorAgentParser } from "./eventStream";
import { probeAvailable, runHarness } from "./runner";
import { attachmentPreamble } from "./attachments";

/**
 * Cursor's headless agent (`cursor-agent`), the CLI half of the editor.
 *
 * `-p` is non-interactive print mode and `--output-format stream-json`
 * emits the same envelope Claude Code does, which is why CursorAgentParser
 * inherits from ClaudeCodeParser.
 *
 * Worth knowing: `cursor-agent` authenticates against a Cursor account
 * (`cursor-agent login`), so its available models are whatever that plan
 * offers — Hive holds no key for it, the same as every other harness.
 */
export class CursorAgentHarness implements Harness {
  name = "cursor-agent";
  private _path: string;
  private _model: string;

  constructor(path = "cursor-agent", model = "") {
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
    const args = ["-p", "--output-format", "stream-json"];

    const model = options?.model || this._model;
    if (model) args.push("--model", model);

    args.push(`${attachmentPreamble(options?.attachments)}${prompt}`);

    return runHarness({
      command: this._path,
      args,
      options,
      parser: new CursorAgentParser(),
    });
  }

  isCompatible(model: string): boolean {
    return !model || !model.includes("/") || model === this._model;
  }
}
