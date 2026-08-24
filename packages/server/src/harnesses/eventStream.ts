import type { HarnessEvent, HarnessUsage } from "@hive/shared/harness";

/**
 * Turning three CLIs' JSON streams into one event vocabulary.
 *
 * Each CLI emits newline-delimited JSON on stdout, but agrees on nothing
 * else — opencode nests everything under `part`, Claude Code wraps
 * Anthropic message objects, pi emits message_start/message_end pairs.
 * These parsers are deliberately forgiving: an unrecognised event is
 * skipped rather than fatal, because a CLI upgrade should degrade the
 * activity trail, not break the run.
 */

export interface StreamParser {
  /** Feeds raw stdout; returns whatever events completed in this chunk. */
  push(chunk: string): HarnessEvent[];
  /** Flushes any trailing partial line. */
  finish(): HarnessEvent[];
  /** The readable answer assembled from the stream. */
  finalText(): string;
  usage(): HarnessUsage | undefined;
}

const MAX_DETAIL = 160;

function trim(value: unknown, limit = MAX_DETAIL): string {
  if (value === undefined || value === null) return "";
  const text = typeof value === "string" ? value : safeStringify(value);
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return String(value);
  }
}

function event(
  type: HarnessEvent["type"],
  rest: Partial<HarnessEvent> = {},
): HarnessEvent {
  return { type, at: Date.now(), ...rest };
}

/** Line-buffers a stream and hands each complete line to a handler. */
abstract class NdjsonParser implements StreamParser {
  protected buffer = "";
  protected texts: string[] = [];
  protected finalOverride: string | null = null;
  protected totals: HarnessUsage | undefined;

  push(chunk: string): HarnessEvent[] {
    this.buffer += chunk;
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop() ?? "";
    return this.consume(lines);
  }

  finish(): HarnessEvent[] {
    if (!this.buffer.trim()) return [];
    const rest = this.buffer;
    this.buffer = "";
    return this.consume([rest]);
  }

  private consume(lines: string[]): HarnessEvent[] {
    const out: HarnessEvent[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let parsed: any;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        // Plain text on stdout (a warning, a banner) is still worth showing.
        out.push(event("status", { text: trim(trimmed, 200) }));
        continue;
      }
      out.push(...this.handle(parsed));
    }
    return out;
  }

  protected abstract handle(entry: any): HarnessEvent[];

  finalText(): string {
    if (this.finalOverride !== null) return this.finalOverride;
    return this.texts.join("\n\n").trim();
  }

  usage(): HarnessUsage | undefined {
    return this.totals;
  }
}

/* ------------------------------------------------------------------ */
/* opencode — `opencode run --format json`                             */
/* ------------------------------------------------------------------ */

/**
 * Shape confirmed against a live run:
 *   {"type":"text","part":{"type":"text","text":"…"}}
 *   {"type":"tool_use","part":{"tool":"read","callID":"…",
 *      "state":{"status":"completed","input":{…},"output":"…"}}}
 *   {"type":"step_finish","part":{"tokens":{…},"cost":0}}
 */
export class OpenCodeParser extends NdjsonParser {
  private seenTools = new Set<string>();

  protected handle(entry: any): HarnessEvent[] {
    const part = entry?.part ?? {};
    const kind = entry?.type ?? part?.type;

    switch (kind) {
      case "text": {
        const text = part.text ?? entry.text;
        if (!text) return [];
        this.texts.push(text);
        return [event("text", { text })];
      }

      case "reasoning":
      case "thinking": {
        const text = part.text ?? entry.text;
        return text ? [event("thinking", { text })] : [];
      }

      case "tool_use":
      case "tool": {
        const tool = part.tool ?? part.name ?? "tool";
        const callId = part.callID ?? part.id;
        const state = part.state ?? {};
        const status = state.status;

        // A tool is reported repeatedly as it moves through its states;
        // the call is announced once, then closed when it finishes.
        const events: HarnessEvent[] = [];
        if (callId && !this.seenTools.has(callId)) {
          this.seenTools.add(callId);
          events.push(
            event("tool", {
              tool,
              callId,
              detail: trim(state.input),
              status: "running",
            }),
          );
        }
        if (status === "completed" || status === "error") {
          events.push(
            event("tool-result", {
              tool,
              callId,
              detail: trim(state.output ?? state.error),
              status: status === "completed" ? "completed" : "failed",
            }),
          );
        }
        return events;
      }

      case "step_finish": {
        const tokens = part.tokens ?? {};
        this.totals = {
          inputTokens: tokens.input,
          outputTokens: tokens.output,
          totalTokens: tokens.total,
          costUsd: part.cost,
        };
        return this.totals.totalTokens
          ? [event("usage", { usage: this.totals })]
          : [];
      }

      case "error": {
        const text = trim(part.message ?? entry.message ?? entry.error, 400);
        return text ? [event("error", { text })] : [];
      }

      default:
        return [];
    }
  }
}

/* ------------------------------------------------------------------ */
/* Claude Code — `claude -p --output-format stream-json --verbose`     */
/* ------------------------------------------------------------------ */

/**
 * Shape confirmed against a live run:
 *   {"type":"system","subtype":"init","model":"…","tools":[…]}
 *   {"type":"assistant","message":{"content":[{"type":"text"|"thinking"|"tool_use",…}]}}
 *   {"type":"user","message":{"content":[{"type":"tool_result","content":…}]}}
 *   {"type":"result","subtype":"success","result":"…","total_cost_usd":…}
 */
export class ClaudeCodeParser extends NdjsonParser {
  protected handle(entry: any): HarnessEvent[] {
    switch (entry?.type) {
      case "system":
        if (entry.subtype !== "init") return [];
        return [
          event("status", {
            text: entry.model ? `Running ${entry.model}` : "Session started",
          }),
        ];

      case "assistant": {
        const events: HarnessEvent[] = [];
        for (const block of entry.message?.content ?? []) {
          if (block?.type === "text" && block.text) {
            this.texts.push(block.text);
            events.push(event("text", { text: block.text }));
          } else if (block?.type === "thinking" && block.thinking) {
            events.push(event("thinking", { text: block.thinking }));
          } else if (block?.type === "tool_use") {
            events.push(
              event("tool", {
                tool: block.name ?? "tool",
                callId: block.id,
                detail: trim(block.input),
                status: "running",
              }),
            );
          }
        }
        return events;
      }

      case "user": {
        const events: HarnessEvent[] = [];
        for (const block of entry.message?.content ?? []) {
          if (block?.type !== "tool_result") continue;
          events.push(
            event("tool-result", {
              callId: block.tool_use_id,
              detail: trim(block.content),
              status: block.is_error ? "failed" : "completed",
            }),
          );
        }
        return events;
      }

      case "result": {
        // `result` is the finished answer — this is the field that used to
        // reach the chat window as a raw JSON blob.
        if (typeof entry.result === "string" && entry.result.trim()) {
          this.finalOverride = entry.result;
        }
        this.totals = {
          inputTokens: entry.usage?.input_tokens,
          outputTokens: entry.usage?.output_tokens,
          costUsd: entry.total_cost_usd,
        };
        const events: HarnessEvent[] = [];
        if (entry.is_error) {
          events.push(
            event("error", { text: trim(entry.result ?? entry.subtype, 400) }),
          );
        }
        if (
          this.totals.costUsd !== undefined ||
          this.totals.outputTokens !== undefined
        ) {
          events.push(event("usage", { usage: this.totals }));
        }
        return events;
      }

      default:
        return [];
    }
  }
}

/* ------------------------------------------------------------------ */
/* pi — `pi -p --mode json`                                            */
/* ------------------------------------------------------------------ */

/**
 * Shape confirmed against a live run:
 *   {"type":"message_end","message":{"role":"assistant","content":[…],
 *     "provider":"…","model":"…","usage":{…},"errorMessage":"…"}}
 * Content block names are handled loosely — pi's block vocabulary is not
 * documented in `--help`, so several spellings are accepted.
 */
export class PiParser extends NdjsonParser {
  protected handle(entry: any): HarnessEvent[] {
    if (entry?.type !== "message_end") return [];

    const message = entry.message ?? {};
    if (message.role !== "assistant") return [];

    const events: HarnessEvent[] = [];

    if (message.errorMessage) {
      events.push(event("error", { text: trim(message.errorMessage, 400) }));
    }

    for (const block of message.content ?? []) {
      const kind = block?.type;
      if (kind === "text" && block.text) {
        this.texts.push(block.text);
        events.push(event("text", { text: block.text }));
      } else if (
        (kind === "thinking" || kind === "reasoning") &&
        (block.text ?? block.thinking)
      ) {
        events.push(event("thinking", { text: block.text ?? block.thinking }));
      } else if (
        kind === "toolCall" ||
        kind === "tool_use" ||
        kind === "toolUse"
      ) {
        events.push(
          event("tool", {
            tool: block.name ?? block.tool ?? "tool",
            callId: block.id ?? block.callId,
            detail: trim(block.input ?? block.arguments),
            status: "running",
          }),
        );
      } else if (kind === "toolResult" || kind === "tool_result") {
        events.push(
          event("tool-result", {
            tool: block.name ?? block.tool,
            callId: block.id ?? block.callId ?? block.toolCallId,
            detail: trim(block.output ?? block.content ?? block.result),
            status: block.isError ? "failed" : "completed",
          }),
        );
      }
    }

    const usage = message.usage;
    if (usage) {
      this.totals = {
        inputTokens: usage.input,
        outputTokens: usage.output,
        totalTokens: usage.totalTokens,
        costUsd: usage.cost?.total,
      };
      if (this.totals.totalTokens) {
        events.push(event("usage", { usage: this.totals }));
      }
    }

    return events;
  }
}

/**
 * Last resort for a CLI that produced no parseable stream: show what it
 * printed rather than nothing.
 */
export class PlainTextParser implements StreamParser {
  private text = "";

  push(chunk: string): HarnessEvent[] {
    this.text += chunk;
    return [];
  }
  finish(): HarnessEvent[] {
    return [];
  }
  finalText(): string {
    return this.text.trim();
  }
  usage(): HarnessUsage | undefined {
    return undefined;
  }
}
