import fs from "fs";
import {
  Harness,
  HarnessExecutionResult,
  HarnessOptions,
  HarnessEvent,
} from "@hive/shared/harness";
import { inlineForDirectApi } from "./attachments";

interface OllamaGenerateRequest {
  /** Base64 images for a vision model; ignored by models without one. */
  images?: string[];
  model: string;
  prompt: string;
  stream: boolean;
  options?: Record<string, unknown>;
}

interface OllamaGenerateResponse {
  model: string;
  created_at: string;
  response: string;
  done: boolean;
  context?: number[];
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

export class OllamaDirectHarness implements Harness {
  name = "ollama-direct";
  private baseUrl: string;

  constructor(baseUrl = "http://localhost:11434") {
    this.baseUrl = baseUrl;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        method: "GET",
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async execute(
    prompt: string,
    options?: HarnessOptions,
  ): Promise<HarnessExecutionResult> {
    const model = options?.model || "llama3.2";
    const startTime = Date.now();

    // No shell and no file tool here, so a path would be unopenable. Text
    // is inlined and images ride Ollama's own `images` field, which a
    // vision model reads and a text-only one ignores.
    const attached = inlineForDirectApi(options?.attachments, (p) =>
      fs.readFileSync(p),
    );

    const request: OllamaGenerateRequest = {
      model,
      prompt: `${attached.text}${prompt}`,
      ...(attached.images.length ? { images: attached.images } : {}),
      stream: false,
      options: {
        temperature: 0.7,
        top_p: 0.9,
      },
    };

    const events: HarnessEvent[] = [];
    const eventId = (type: string, text: string) => ({
      type: type as HarnessEvent["type"],
      text,
      at: Date.now(),
    });

    events.push(eventId("status", `Starting Ollama (${model})...`));

    try {
      const response = await fetch(`${this.baseUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
        signal: options?.timeout
          ? AbortSignal.timeout(options.timeout)
          : undefined,
      });

      if (!response.ok) {
        const errorText = await response.text();
        events.push(
          eventId("error", `Ollama error: ${response.status} ${errorText}`),
        );
        return {
          success: false,
          exitCode: 1,
          stdout: "",
          stderr: errorText,
          output: `Ollama error: ${response.status} ${errorText}`,
          duration: Date.now() - startTime,
          events,
        };
      }

      const data = (await response.json()) as OllamaGenerateResponse;
      events.push(eventId("text", data.response));
      events.push(eventId("status", "completed"));

      return {
        success: true,
        exitCode: 0,
        stdout: data.response,
        stderr: "",
        output: data.response,
        duration: Date.now() - startTime,
        events,
        usage:
          data.eval_count && data.prompt_eval_count
            ? {
                inputTokens: data.prompt_eval_count,
                outputTokens: data.eval_count,
                totalTokens: data.prompt_eval_count + data.eval_count,
              }
            : undefined,
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      events.push(eventId("error", errorMsg));
      return {
        success: false,
        exitCode: 1,
        stdout: "",
        stderr: errorMsg,
        output: errorMsg,
        duration: Date.now() - startTime,
        events,
      };
    }
  }

  isCompatible(model: string): boolean {
    // Ollama models are typically just model names like "llama3.2", "mistral", etc.
    return !model || !model.includes("/");
  }
}
