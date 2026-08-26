import {
  Harness,
  HarnessExecutionResult,
  HarnessOptions,
  HarnessEvent,
} from "@hive/shared/harness";

interface LMStudioChatRequest {
  model: string;
  messages: Array<{ role: string; content: string }>;
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
}

interface LMStudioChatResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: { role: string; content: string };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export class LMStudioDirectHarness implements Harness {
  name = "lmstudio-direct";
  private baseUrl: string;

  constructor(baseUrl = "http://localhost:1234") {
    this.baseUrl = baseUrl;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/v1/models`, {
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
    const model = options?.model || "local-model";
    const startTime = Date.now();

    const request: LMStudioChatRequest = {
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
      max_tokens: 4096,
      stream: false,
    };

    const events: HarnessEvent[] = [];
    const eventId = (type: string, text: string) => ({
      type: type as HarnessEvent["type"],
      text,
      at: Date.now(),
    });

    events.push(eventId("status", `Starting LM Studio (${model})...`));

    try {
      const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
        signal: options?.timeout ? AbortSignal.timeout(options.timeout) : undefined,
      });

      if (!response.ok) {
        const errorText = await response.text();
        events.push(eventId("error", `LM Studio error: ${response.status} ${errorText}`));
        return {
          success: false,
          exitCode: 1,
          stdout: "",
          stderr: errorText,
          output: `LM Studio error: ${response.status} ${errorText}`,
          duration: Date.now() - startTime,
          events,
        };
      }

      const data = (await response.json()) as LMStudioChatResponse;
      const content = data.choices[0]?.message?.content || "";
      events.push(eventId("text", content));
      events.push(eventId("status", "completed"));

      return {
        success: true,
        exitCode: 0,
        stdout: content,
        stderr: "",
        output: content,
        duration: Date.now() - startTime,
        events,
        usage: data.usage
          ? {
              inputTokens: data.usage.prompt_tokens,
              outputTokens: data.usage.completion_tokens,
              totalTokens: data.usage.total_tokens,
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
    // LM Studio models are typically just model names
    return !model || !model.includes("/");
  }
}