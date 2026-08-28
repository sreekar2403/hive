import {
  Harness,
  HarnessExecutionResult,
  HarnessOptions,
} from "@hive/shared/harness";
import { OpenCodeParser } from "./eventStream";
import { probeAvailable, runHarness } from "./runner";
import { opencodeFileArgs } from "./attachments";

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
    //
    // `--auto` is not optional here, despite how its help text reads.
    // opencode asks for approval on some tool calls, and it asks on its own
    // stdin — which runner.ts closes, because these CLIs otherwise sit
    // waiting on a prompt nobody will answer. Without `--auto` the run does
    // not fail, it hangs: the log shows `message=asking permission=bash` and
    // then nothing, forever, until the task times out with no output.
    //
    // The approval itself is not being skipped, it is being moved. Hive
    // watches the tool-call stream and stops the agent on a destructive
    // command itself (permissions.ts + runtimeGuard.ts), and asks a human
    // through the UI, where there is somebody who can actually answer.
    const args = ["run", "--pure", "--auto", "--format", "json", "--thinking"];

    // opencode runs a local server of its own and resolves the workspace
    // itself, so inheriting the spawn cwd is not enough — without --dir it
    // happily works in the wrong directory and reports the project's files
    // as missing.
    if (options?.cwd) args.push("--dir", options.cwd);

    const model = options?.model || this._model;
    if (model) args.push("--model", model);
    if (options?.agent) args.push("--agent", options.agent);

    // opencode takes any file type through --file, so nothing has to be
    // described in the prompt for it to be seen.
    args.push(...opencodeFileArgs(options?.attachments));

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
