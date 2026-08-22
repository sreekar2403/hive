import { Harness, HarnessExecutionResult, HarnessOptions } from '@hive/shared/harness';
import { spawn, execSync } from 'child_process';

export class ClaudeCodeHarness implements Harness {
  name = 'claude-code';
  private _path: string;
  private _model: string;

  constructor(path = 'claude', model = 'sonnet') {
    this._path = path;
    this._model = model;
  }

  isAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
      try {
        (execSync as any)(`${this._path} --version`, { shell: true });
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

      const proc = spawn(this._path, ['-p', prompt, '--output-format', 'json'], {
        cwd: options?.cwd || process.cwd(),
        env: { ...process.env, ...options?.env },
        shell: true,
      });

      proc.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        const duration = Date.now() - startTime;
        resolve({
          success: code === 0,
          exitCode: code ?? 1,
          stdout,
          stderr,
          output: stdout || stderr,
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
    return model === this._model || model.includes('sonnet') || model.includes('claude');
  }
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
