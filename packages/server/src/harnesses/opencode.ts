import {
  Harness,
  HarnessExecutionResult,
  HarnessOptions,
} from "@hive/shared/harness";
import spawn from "cross-spawn";
import { detectFilesChanged } from "../gitUtils";
import { stripAnsi } from "../textUtils";

export class OpenCodeHarness implements Harness {
  name = "opencode";
  private _path: string;
  private _model: string;

  constructor(path = "opencode", model = "sonnet") {
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

      const proc = spawn(
        this._path,
        ["run", "--pure", "--format", "json", prompt],
        {
          cwd: options?.cwd || process.cwd(),
          env: { ...process.env, ...options?.env },
          stdio: ["pipe", "pipe", "pipe"],
        },
      );

      // Close stdin immediately so opencode knows there's no more input
      proc.stdin?.end();

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
        const parsedOutput = parseOpenCodeOutput(cleanStdout);
        resolve({
          success: code === 0,
          exitCode: code ?? 1,
          stdout: cleanStdout,
          stderr: cleanStderr,
          output: parsedOutput || cleanStdout || cleanStderr,
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

function parseOpenCodeOutput(stdout: string): string {
  const lines = stdout.split("\n").filter(Boolean);
  const textParts: string[] = [];

  for (const line of lines) {
    try {
      const event = JSON.parse(line);
      if (event.type === "text" && event.part?.text) {
        textParts.push(event.part.text);
      }
    } catch {
      // Not JSON, include as-is
    }
  }

  return textParts.join("\n") || stdout;
}
