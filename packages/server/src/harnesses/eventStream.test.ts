import { describe, it, expect } from "vitest";
import {
  ClaudeCodeParser,
  OpenCodeParser,
  PiParser,
  PlainTextParser,
} from "./eventStream";
import type { HarnessEvent } from "@hive/shared/harness";

/**
 * The fixtures below are trimmed from real runs of each CLI (see the
 * shapes documented in eventStream.ts). They exist so that a CLI changing
 * its event format fails here, loudly, instead of silently emptying the
 * chat window.
 */

function drain(
  parser: {
    push(chunk: string): HarnessEvent[];
    finish(): HarnessEvent[];
  },
  chunks: string[],
): HarnessEvent[] {
  const events: HarnessEvent[] = [];
  for (const chunk of chunks) events.push(...parser.push(chunk));
  events.push(...parser.finish());
  return events;
}

describe("OpenCodeParser", () => {
  const lines = [
    '{"type":"step_start","part":{"type":"step-start"}}',
    '{"type":"tool_use","part":{"tool":"read","callID":"call_1","state":{"status":"completed","input":{"filePath":"sample.txt"},"output":"hello"}}}',
    '{"type":"text","part":{"type":"text","text":"The file says hello"}}',
    '{"type":"step_finish","part":{"tokens":{"total":18696,"input":17657,"output":15},"cost":0.002}}',
  ];

  it("reads the answer out of the event stream", () => {
    const parser = new OpenCodeParser();
    drain(parser, [lines.join("\n") + "\n"]);
    expect(parser.finalText()).toBe("The file says hello");
  });

  it("reports the tool call and its result", () => {
    const parser = new OpenCodeParser();
    const events = drain(parser, [lines.join("\n") + "\n"]);

    const tool = events.find((e) => e.type === "tool");
    expect(tool?.tool).toBe("read");
    expect(tool?.detail).toContain("sample.txt");

    const result = events.find((e) => e.type === "tool-result");
    expect(result?.status).toBe("completed");
    expect(result?.detail).toContain("hello");
  });

  it("announces a tool once even though its state is reported repeatedly", () => {
    const parser = new OpenCodeParser();
    const running =
      '{"type":"tool_use","part":{"tool":"read","callID":"call_1","state":{"status":"running","input":{}}}}';
    const events = drain(parser, [`${running}\n${running}\n${lines[1]}\n`]);
    expect(events.filter((e) => e.type === "tool")).toHaveLength(1);
    expect(events.filter((e) => e.type === "tool-result")).toHaveLength(1);
  });

  it("carries token usage", () => {
    const parser = new OpenCodeParser();
    drain(parser, [lines.join("\n") + "\n"]);
    expect(parser.usage()).toMatchObject({
      totalTokens: 18696,
      costUsd: 0.002,
    });
  });

  it("survives a JSON object split across chunks", () => {
    const parser = new OpenCodeParser();
    const whole = '{"type":"text","part":{"type":"text","text":"split"}}\n';
    const events = drain(parser, [whole.slice(0, 20), whole.slice(20)]);
    expect(events.filter((e) => e.type === "text")).toHaveLength(1);
    expect(parser.finalText()).toBe("split");
  });
});

describe("ClaudeCodeParser", () => {
  const lines = [
    '{"type":"system","subtype":"init","model":"claude-sonnet-4","tools":["Read"]}',
    '{"type":"assistant","message":{"content":[{"type":"thinking","thinking":"I should read it"}]}}',
    '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"tu_1","name":"Read","input":{"file_path":"sample.txt"}}]}}',
    '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"tu_1","content":"1\\thello"}]}}',
    '{"type":"assistant","message":{"content":[{"type":"text","text":"It contains: hello"}]}}',
    '{"type":"result","subtype":"success","is_error":false,"result":"It contains: hello","total_cost_usd":0.12}',
  ];

  it("uses the result field as the answer, not the raw envelope", () => {
    const parser = new ClaudeCodeParser();
    drain(parser, [lines.join("\n") + "\n"]);
    const text = parser.finalText();
    expect(text).toBe("It contains: hello");
    expect(text).not.toContain("total_cost_usd");
  });

  it("surfaces thinking, tool calls and tool results", () => {
    const parser = new ClaudeCodeParser();
    const events = drain(parser, [lines.join("\n") + "\n"]);

    expect(events.find((e) => e.type === "thinking")?.text).toBe(
      "I should read it",
    );
    expect(events.find((e) => e.type === "tool")?.tool).toBe("Read");
    expect(events.find((e) => e.type === "tool-result")?.status).toBe(
      "completed",
    );
    expect(parser.usage()?.costUsd).toBe(0.12);
  });

  it("marks a failed run as an error", () => {
    const parser = new ClaudeCodeParser();
    const events = drain(parser, [
      '{"type":"result","subtype":"error_during_execution","is_error":true,"result":"boom"}\n',
    ]);
    expect(events.find((e) => e.type === "error")?.text).toBe("boom");
  });
});

describe("PiParser", () => {
  it("collects assistant text from message_end", () => {
    const parser = new PiParser();
    drain(parser, [
      '{"type":"message_start","message":{"role":"user","content":[{"type":"text","text":"hi"}]}}\n' +
        '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"hello back"}],"usage":{"totalTokens":42,"cost":{"total":0.01}}}}\n',
    ]);
    expect(parser.finalText()).toBe("hello back");
    expect(parser.usage()).toMatchObject({ totalTokens: 42, costUsd: 0.01 });
  });

  it("reports a provider failure rather than going quiet", () => {
    const parser = new PiParser();
    const events = drain(parser, [
      '{"type":"message_end","message":{"role":"assistant","content":[],"provider":"ollama","stopReason":"error","errorMessage":"Connection error."}}\n',
    ]);
    expect(events.find((e) => e.type === "error")?.text).toBe(
      "Connection error.",
    );
  });

  it("ignores the user's own echoed message", () => {
    const parser = new PiParser();
    drain(parser, [
      '{"type":"message_end","message":{"role":"user","content":[{"type":"text","text":"my prompt"}]}}\n',
    ]);
    expect(parser.finalText()).toBe("");
  });
});

describe("non-JSON output", () => {
  it("passes plain lines through as status rather than dropping them", () => {
    const parser = new OpenCodeParser();
    const events = drain(parser, ["warning: something happened\n"]);
    expect(events[0]).toMatchObject({
      type: "status",
      text: "warning: something happened",
    });
  });

  it("falls back to raw text when a CLI has no event stream", () => {
    const parser = new PlainTextParser();
    drain(parser, ["just ", "plain output\n"]);
    expect(parser.finalText()).toBe("just plain output");
  });
});
