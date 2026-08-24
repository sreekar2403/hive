import {
  Harness,
  HarnessExecutionResult,
  HarnessOptions,
} from "@hive/shared/harness";
import { OpenCodeParser } from "./eventStream";
import { probeAvailable, runHarness } from "./runner";

export class OpenCodeHarness implements Harness {
  name = "opencode";
  private _path: string;
  private _model: string;

  constructor(path = "opencode", model = "") {
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
    // `--format json` is the event stream (see OpenCodeParser); `--thinking`
    // makes reasoning blocks part of it instead of being dropped.
    const args = ["run", "--pure", "--format", "json", "--thinking"];

    // opencode runs a local server of its own and resolves the workspace
    // itself, so inheriting the spawn cwd is not enough — without --dir it
    // happily works in the wrong directory and reports the project's files
    // as missing.
    if (options?.cwd) args.push("--dir", options.cwd);

    const model = options?.model || this._model;
    if (model) args.push("--model", model);
    if (options?.agent) args.push("--agent", options.agent);

    args.push(prompt);

    return runHarness({
      command: this._path,
      args,
      options,
      parser: new OpenCodeParser(),
    });
  }

  isCompatible(model: string): boolean {
    // opencode addresses every provider it knows as `provider/model`, so
    // anything in that form is fair game.
    return !model || model.includes("/") || model === this._model;
  }
}
