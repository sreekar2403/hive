import fs from "fs";
import {
  Harness,
  HarnessExecutionResult,
  HarnessOptions,
  HarnessEvent,
} from "@hive/shared/harness";
import { inlineForDirectApi } from "./attachments";

/**
 * OpenAI's content-part shape, which LM Studio implements. A plain string
 * is still valid and is what a text-only turn sends; the array form is how
 * an image reaches a vision model.
 */
type LMStudioContent =
  | string
  | Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string } }
    >;

interface LMStudioChatRequest {
  model: string;
  messages: Array<{ role: string; content: LMStudioContent }>;
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

    // Same situation as ollamaDirect: an HTTP model with no filesystem, so
    // an attached file is inlined rather than pointed at.
    const attached = inlineForDirectApi(options?.attachments, (p) =>
      fs.readFileSync(p),
    );
    const text = `${attached.text}${prompt}`;

    // Images go as OpenAI content parts, which LM Studio implements. An
    // earlier version declared them unsendable and pasted a note saying so
    // into the prompt — which was wrong twice over: the transport supports
    // them, and half this user's LM Studio models are vision models.
    //
    // Sent as data: URLs. There is no file for the server to fetch — it may
    // not even be on this machine — so a path or an http URL would resolve
    // to nothing at the far end.
    const content: LMStudioContent = attached.images.length
      ? [
          { type: "text" as const, text },
          ...attached.images.map((image) => ({
            type: "image_url" as const,
            image_url: {
              url: `data:${image.mimeType};base64,${image.data}`,
            },
          })),
        ]
      : text;

    const request: LMStudioChatRequest = {
      model,
      messages: [{ role: "user", content }],
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
        signal: options?.timeout
          ? AbortSignal.timeout(options.timeout)
          : undefined,
      });

      if (!response.ok) {
        const errorText = await response.text();
        events.push(
          eventId("error", `LM Studio error: ${response.status} ${errorText}`),
        );
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
