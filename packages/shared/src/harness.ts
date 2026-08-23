export interface HarnessOptions {
  cwd?: string;
  env?: Record<string, string>;
  timeout?: number;
}

export interface HarnessExecutionResult {
  success: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  output: string;
  filesChanged?: string[];
  duration: number;
}

export interface Harness {
  name: string;
  isAvailable(): Promise<boolean>;
  execute(
    prompt: string,
    options?: HarnessOptions,
  ): Promise<HarnessExecutionResult>;
  isCompatible(model: string): boolean;
}
