import {
  Harness,
  HarnessExecutionResult,
  HarnessOptions,
} from "@hive/shared/harness";
import spawn from "cross-spawn";
import { detectFilesChanged } from "../gitUtils";
import { stripAnsi } from "../textUtils";

export class PiHarness implements Harness {
  name = "pi";
  private _path: string;
  private _model: string;

  constructor(path = "pi", model = "sonnet") {
    this._path = path;
    this._model = model;
  }

  isAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawn(this._path, ["--version"], { timeout: 3000 });
      proc.on("error", () => resolve(false));
      proc.on("close", (code) => resolve(code === 0));
    });
  }

  execute(
    prompt: string,
    options?: HarnessOptions,
  ): Promise<HarnessExecutionResult> {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      let stdout = "";
      let stderr = "";

      const proc = spawn(this._path, ["-p", prompt], {
        cwd: options?.cwd || process.cwd(),
        env: { ...process.env, ...options?.env },
      });

      proc.stdout?.on("data", (data: Buffer) => {
        stdout += data.toString();
      });

      proc.stderr?.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on("close", (code) => {
        const duration = Date.now() - startTime;
        const cleanStdout = stripAnsi(stdout);
        const cleanStderr = stripAnsi(stderr);
        resolve({
          success: code === 0,
          exitCode: code ?? 1,
          stdout: cleanStdout,
          stderr: cleanStderr,
          output: cleanStdout || cleanStderr,
          filesChanged: detectFilesChanged(options?.cwd || process.cwd()),
          duration,
        });
      });

      proc.on("error", (err) => {
        reject(err);
      });
    });
  }

  isCompatible(model: string): boolean {
    return model === this._model || model.includes("sonnet");
  }
}
