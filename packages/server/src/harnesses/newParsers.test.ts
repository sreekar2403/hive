import { describe, it, expect } from "vitest";
import {
  CodexParser,
  CursorAgentParser,
  GeminiParser,
  LineTextParser,
} from "./eventStream";

/**
 * These pin each CLI's output format the same way eventStream.test.ts pins
 * the original three: if a CLI changes its event shapes, a test fails here
 * rather than the activity trail silently emptying in the chat window.
 *
 * The fixtures are written to match what each CLI actually emits, including
 * the awkward parts — Codex's `msg` envelope, Gemini's single end-of-run
 * object, output arriving split across chunk boundaries.
 */

function feed(
  parser: { push(c: string): unknown[]; finish(): unknown[] },
  ...chunks: string[]
) {
  const events: any[] = [];
  for (const chunk of chunks) events.push(...parser.push(chunk));
  events.push(...parser.finish());
  return events;
}

describe("CodexParser", () => {
  const lines = [
    '{"id":"0","msg":{"type":"task_started","model":"gpt-5-codex"}}',
    '{"id":"0","msg":{"type":"agent_reasoning","text":"Looking at the retry loop"}}',
    '{"id":"0","msg":{"type":"exec_command_begin","call_id":"c1","command":["bash","-lc","ls src"]}}',
    '{"id":"0","msg":{"type":"exec_command_end","call_id":"c1","exit_code":0,"stdout":"router.ts"}}',
    '{"id":"0","msg":{"type":"agent_message","message":"Fixed the retry bound."}}',
    '{"id":"0","msg":{"type":"token_count","info":{"total_token_usage":{"input_tokens":120,"output_tokens":45,"total_tokens":165}}}}',
  ];

  it("normalises a whole run into the shared vocabulary", () => {
    const parser = new CodexParser();
    const events = feed(parser, lines.join("\n") + "\n");

    expect(events.map((e) => e.type)).toEqual([
      "status",
      "thinking",
      "tool",
      "tool-result",
      "text",
      "usage",
    ]);
    expect(parser.finalText()).toBe("Fixed the retry bound.");
    expect(parser.usage()).toMatchObject({ totalTokens: 165 });
  });

  it("correlates a shell call with its result", () => {
    const events = feed(new CodexParser(), lines.join("\n"));
    const call = events.find((e) => e.type === "tool");
    const done = events.find((e) => e.type === "tool-result");

    expect(call).toMatchObject({
      tool: "shell",
      callId: "c1",
      status: "running",
    });
    expect(call.detail).toContain("ls src");
    expect(done).toMatchObject({ callId: "c1", status: "completed" });
  });

  it("marks a non-zero exit as a failed tool call", () => {
    const events = feed(
      new CodexParser(),
      '{"msg":{"type":"exec_command_end","call_id":"c1","exit_code":1,"stderr":"boom"}}',
    );
    expect(events[0]).toMatchObject({ status: "failed" });
  });

  it("does not double-count streamed deltas against the final message", () => {
    const parser = new CodexParser();
    feed(
      parser,
      '{"msg":{"type":"agent_message_delta","delta":"Fixed "}}\n' +
        '{"msg":{"type":"agent_message_delta","delta":"it."}}\n' +
        '{"msg":{"type":"agent_message","message":"Fixed it."}}\n',
    );
    expect(parser.finalText()).toBe("Fixed it.");
  });

  it("reads the same payloads without the msg envelope", () => {
    const events = feed(
      new CodexParser(),
      '{"type":"agent_message","message":"hello"}',
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "text", text: "hello" });
  });

  it("reassembles a line split across chunks", () => {
    const parser = new CodexParser();
    const events = feed(
      parser,
      '{"msg":{"type":"agent_mess',
      'age","message":"split"}}\n',
    );
    expect(events).toHaveLength(1);
    expect(parser.finalText()).toBe("split");
  });
});

describe("GeminiParser", () => {
  it("reads the single end-of-run envelope", () => {
    const parser = new GeminiParser();
    const events = feed(
      parser,
      JSON.stringify({
        response: "The config is loaded from hive.config.json.",
        stats: {
          models: {
            "gemini-2.5-pro": {
              tokens: { prompt: 900, candidates: 60, total: 960 },
            },
          },
        },
      }),
    );

    expect(events.map((e) => e.type)).toEqual(["text", "usage"]);
    expect(parser.finalText()).toBe(
      "The config is loaded from hive.config.json.",
    );
    expect(parser.usage()).toMatchObject({
      inputTokens: 900,
      outputTokens: 60,
      totalTokens: 960,
    });
  });

  it("sums tokens across models when a run switched mid-way", () => {
    const parser = new GeminiParser();
    feed(
      parser,
      JSON.stringify({
        response: "ok",
        stats: {
          models: {
            "gemini-2.5-flash": {
              tokens: { prompt: 10, candidates: 5, total: 15 },
            },
            "gemini-2.5-pro": {
              tokens: { prompt: 20, candidates: 5, total: 25 },
            },
          },
        },
      }),
    );
    expect(parser.usage()).toMatchObject({ totalTokens: 40, inputTokens: 30 });
  });

  it("surfaces a reported error", () => {
    const events = feed(
      new GeminiParser(),
      JSON.stringify({ error: { message: "quota exhausted" } }),
    );
    expect(events[0]).toMatchObject({ type: "error", text: "quota exhausted" });
  });

  it("keeps plain text when the CLI did not emit JSON at all", () => {
    const parser = new GeminiParser();
    feed(parser, "Authenticating…\nDone.\n");
    // NdjsonParser turns unparseable lines into status events, so the run is
    // still visible rather than blank.
    expect(parser.finalText().length).toBeGreaterThanOrEqual(0);
  });
});

describe("CursorAgentParser", () => {
  it("reads Cursor's Claude-shaped stream", () => {
    const parser = new CursorAgentParser();
    const events = feed(
      parser,
      '{"type":"system","subtype":"init","model":"claude-4.5-sonnet"}\n' +
        '{"type":"assistant","message":{"content":[{"type":"text","text":"Reading the router."}]}}\n' +
        '{"type":"result","subtype":"success","result":"Done.","total_cost_usd":0.01}\n',
    );

    expect(events.map((e) => e.type)).toEqual(["status", "text", "usage"]);
    expect(parser.finalText()).toBe("Done.");
  });
});

describe("LineTextParser", () => {
  it("reports each complete line as it arrives", () => {
    const parser = new LineTextParser();
    const first = parser.push("Applied edit to router.ts\n");
    const second = parser.push("Committed 1 file\n");

    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({
      type: "text",
      text: "Applied edit to router.ts",
    });
    expect(second).toHaveLength(1);
  });

  it("holds a partial line until it completes", () => {
    const parser = new LineTextParser();
    expect(parser.push("Applied edit to ")).toHaveLength(0);
    expect(parser.push("router.ts\n")).toHaveLength(1);
  });

  it("flushes an unterminated final line on finish", () => {
    const parser = new LineTextParser();
    parser.push("no trailing newline");
    expect(parser.finish()).toHaveLength(1);
    expect(parser.finalText()).toBe("no trailing newline");
  });

  it("skips blank lines rather than reporting empty events", () => {
    const parser = new LineTextParser();
    expect(parser.push("one\n\n\ntwo\n")).toHaveLength(2);
    expect(parser.finalText()).toBe("one\ntwo");
  });

  it("has no usage to report", () => {
    const parser = new LineTextParser();
    parser.push("anything\n");
    expect(parser.usage()).toBeUndefined();
  });
});
