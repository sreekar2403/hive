import { Harness, HarnessExecutionResult, HarnessOptions } from '@hive/shared/harness';
import { spawn, execSync } from 'child_process';
import * as fs from 'fs';

export class OpenCodeHarness implements Harness {
  name = 'opencode';
  private _path: string;
  private _model: string;

  constructor(path = 'opencode', model = 'sonnet') {
    this._path = path;
    this._model = model;
  }

  isAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
      try {
        (execSync as any)(`${this._path} --version`, { shell: true, timeout: 3000 });
        resolve(true);
      } catch {
        resolve(false);
      }
    });
  }

  execute(prompt: string, options?: HarnessOptions): Promise<HarnessExecutionResult> {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      let stdout = '';
      let stderr = '';

      const proc = spawn(this._path, ['run', '--pure', '--format', 'json', prompt], {
        cwd: options?.cwd || process.cwd(),
        env: { ...process.env, ...options?.env },
        shell: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      // Close stdin immediately so opencode knows there's no more input
      proc.stdin.end();

      proc.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        const duration = Date.now() - startTime;
        const parsedOutput = parseOpenCodeOutput(stdout);
        resolve({
          success: code === 0,
          exitCode: code ?? 1,
          stdout,
          stderr,
          output: parsedOutput || stdout || stderr,
          filesChanged: detectFilesChanged(options?.cwd || process.cwd()),
          duration,
        });
      });

      proc.on('error', (err) => {
        reject(err);
      });
    });
  }

  isCompatible(model: string): boolean {
    return model === this._model || model.includes('sonnet');
  }
}

function parseOpenCodeOutput(stdout: string): string {
  const lines = stdout.split('\n').filter(Boolean);
  const textParts: string[] = [];

  for (const line of lines) {
    try {
      const event = JSON.parse(line);
      if (event.type === 'text' && event.part?.text) {
        textParts.push(event.part.text);
      }
    } catch {
      // Not JSON, include as-is
    }
  }

  return textParts.join('\n') || stdout;
}

function detectFilesChanged(cwd: string): string[] {
  const files: string[] = [];
  try {
    const gitDiff = (execSync as any)(
      'git diff --name-only HEAD 2>/dev/null || git status --porcelain 2>/dev/null || echo ""',
      { cwd, shell: true, encoding: 'utf8' }
    ) as string;
    files.push(
      ...gitDiff
        .split('\n')
        .filter(Boolean)
        .map((f: string) => f.trim())
    );
  } catch {
    // Not a git repo or git not available
  }
  return files;
}
