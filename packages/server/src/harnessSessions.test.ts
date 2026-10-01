import { describe, it, expect } from "vitest";
import {
  getHarnessSession,
  setHarnessSession,
  clearHarnessSession,
} from "./chatSessions";

describe("harness sessions (one live native session per chat)", () => {
  it("returns null when the chat never ran", () => {
    expect(getHarnessSession("chat-never-ran")).toBeNull();
  });

  it("stores and returns the native session for a chat+harness", () => {
    setHarnessSession("chat-1", "claude-code", "native-a");
    expect(getHarnessSession("chat-1")).toEqual({
      harness: "claude-code",
      nativeSessionId: "native-a",
    });
  });

  it("overwrites on harness switch (no parallel rows kept)", () => {
    setHarnessSession("chat-2", "claude-code", "native-a");
    setHarnessSession("chat-2", "codex", "native-b");
    expect(getHarnessSession("chat-2")).toEqual({
      harness: "codex",
      nativeSessionId: "native-b",
    });
  });

  it("clearing removes the mapping", () => {
    setHarnessSession("chat-3", "pi", "native-c");
    clearHarnessSession("chat-3");
    expect(getHarnessSession("chat-3")).toBeNull();
  });
});
