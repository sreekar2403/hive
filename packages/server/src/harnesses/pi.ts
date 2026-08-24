import {
  Harness,
  HarnessExecutionResult,
  HarnessOptions,
} from "@hive/shared/harness";
import { PiParser } from "./eventStream";
import { probeAvailable, runHarness } from "./runner";

export class PiHarness implements Harness {
  name = "pi";
  private _path: string;
  private _model: string;

  constructor(path = "pi", model = "") {
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
    // `--mode json` emits message_start/message_end pairs; -p keeps it
    // non-interactive. pi takes `provider/id` in a single --model flag.
    const args = ["-p", "--mode", "json"];

    const model = options?.model || this._model;
    if (model) args.push("--model", model);

    args.push(prompt);

    return runHarness({
      command: this._path,
      args,
      options,
      parser: new PiParser(),
    });
  }

  isCompatible(model: string): boolean {
    return !model || model.includes("/") || model === this._model;
  }
}
