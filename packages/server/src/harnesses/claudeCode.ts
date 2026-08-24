import {
  Harness,
  HarnessExecutionResult,
  HarnessOptions,
} from "@hive/shared/harness";
import { ClaudeCodeParser } from "./eventStream";
import { probeAvailable, runHarness } from "./runner";

export class ClaudeCodeHarness implements Harness {
  name = "claude-code";
  private _path: string;
  private _model: string;

  constructor(path = "claude", model = "") {
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
    // stream-json (which requires --verbose) carries tool calls and
    // thinking blocks as they happen. Plain --output-format json returns
    // one envelope at the end, which is what used to land in the chat
    // window verbatim.
    const args = ["-p", prompt, "--output-format", "stream-json", "--verbose"];

    const model = options?.model || this._model;
    if (model && model !== "default") args.push("--model", model);
    if (options?.agent) args.push("--agent", options.agent);

    return runHarness({
      command: this._path,
      args,
      options,
      parser: new ClaudeCodeParser(),
    });
  }

  isCompatible(model: string): boolean {
    return (
      !model || model === this._model || /sonnet|opus|haiku|claude/i.test(model)
    );
  }
}
