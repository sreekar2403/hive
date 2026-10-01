import {
  Harness,
  HarnessExecutionResult,
  HarnessOptions,
} from "@hive/shared/harness";
import { PiParser } from "./eventStream";
import { probeAvailable, runHarness } from "./runner";
import { attachmentPreamble } from "./attachments";

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

    // Resume the chat's native session when asked. `--session` takes a
    // session file path or partial UUID — the id the session line reports.
    if (options?.resumeSessionId) {
      args.push("--session", options.resumeSessionId);
    }

    args.push(`${attachmentPreamble(options?.attachments)}${prompt}`);

    return runHarness({
      command: this._path,
      args,
      options,
      parser: new PiParser(),
    });
  }

  supportsResume(): boolean {
    return true;
  }

  isCompatible(model: string): boolean {
    return !model || model.includes("/") || model === this._model;
  }
}
