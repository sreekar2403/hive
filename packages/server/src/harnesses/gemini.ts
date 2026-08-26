import {
  Harness,
  HarnessExecutionResult,
  HarnessOptions,
} from "@hive/shared/harness";
import { GeminiParser } from "./eventStream";
import { probeAvailable, runHarness } from "./runner";

/**
 * Google's Gemini CLI.
 *
 * `-p` is the non-interactive prompt flag; `--output-format json` makes it
 * print one JSON envelope at the end instead of a TUI transcript. There is
 * no streaming JSON mode, so the activity trail for a Gemini run fills in
 * when the run completes rather than as it works — see GeminiParser.
 *
 * `--yolo` is deliberately not passed: tool approvals stay with the CLI's
 * own policy, the same as every other harness here.
 */
export class GeminiHarness implements Harness {
  name = "gemini";
  private _path: string;
  private _model: string;

  constructor(path = "gemini", model = "") {
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
    const args = ["--output-format", "json"];

    const model = options?.model || this._model;
    if (model) args.push("--model", model);

    // -p takes the prompt as its value, unlike the CLIs that accept it as a
    // trailing positional.
    args.push("-p", prompt);

    return runHarness({
      command: this._path,
      args,
      options,
      parser: new GeminiParser(),
    });
  }

  isCompatible(model: string): boolean {
    return !model || model.startsWith("gemini") || model === this._model;
  }
}

/**
 * Qwen Code — a fork of Gemini CLI that kept its flags and its output
 * envelope, so the only differences worth encoding are the binary name and
 * which model ids it will accept.
 */
export class QwenHarness extends GeminiHarness {
  name = "qwen";

  constructor(path = "qwen", model = "") {
    super(path, model);
  }

  isCompatible(model: string): boolean {
    return !model || model.toLowerCase().includes("qwen");
  }
}
