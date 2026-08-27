import { describe, it, expect, beforeEach } from "vitest";
import type { HarnessEvent } from "@hive/shared/harness";
import { RuntimeGuard, commandFromDetail, isShellTool } from "./runtimeGuard";
import { PermissionManager } from "./permissions";
import { createDefaultConfig } from "./config";

const toolEvent = (tool: string, detail: string): HarnessEvent => ({
  type: "tool",
  tool,
  detail,
  at: Date.now(),
});

describe("RuntimeGuard", () => {
  let guard: RuntimeGuard;
  let permissions: PermissionManager;

  beforeEach(() => {
    permissions = new PermissionManager(createDefaultConfig());
    guard = new RuntimeGuard(permissions);
  });

  it("trips on a destructive shell command", () => {
    const trip = guard.inspect(toolEvent("bash", "git reset --hard HEAD~3"));
    expect(trip).not.toBeNull();
    expect(trip?.command).toBe("git reset --hard HEAD~3");
    expect(trip?.patterns).toContain("reset");
  });

  it("ignores ordinary commands", () => {
    expect(guard.inspect(toolEvent("bash", "npm test"))).toBeNull();
    expect(guard.inspect(toolEvent("shell", "git status"))).toBeNull();
    // "rm" inside a word must not fire — the old substring gate did.
    expect(guard.inspect(toolEvent("bash", "npm run build:platform"))).toBeNull();
  });

  it("ignores non-shell tools", () => {
    // A file edit whose content mentions a destructive word is not a
    // destructive command; only shell tools are gated.
    expect(guard.inspect(toolEvent("read", "remove the console.log"))).toBeNull();
    expect(guard.inspect(toolEvent("edit", "delete this line"))).toBeNull();
  });

  it("ignores non-tool events entirely", () => {
    expect(
      guard.inspect({ type: "text", text: "rm -rf /", at: Date.now() }),
    ).toBeNull();
    expect(
      guard.inspect({ type: "thinking", text: "maybe git clean -fd", at: Date.now() }),
    ).toBeNull();
  });

  it("keeps only the first trip", () => {
    const first = guard.inspect(toolEvent("bash", "rm -rf dist"));
    const second = guard.inspect(toolEvent("bash", "git push --force"));
    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(guard.tripped()?.command).toBe("rm -rf dist");
  });

  it("lets through a command a human already approved", () => {
    const allowing = new RuntimeGuard(permissions, ["git reset --hard"]);
    expect(allowing.inspect(toolEvent("bash", "git reset --hard"))).toBeNull();
    // A *different* destructive command still trips.
    expect(allowing.inspect(toolEvent("bash", "rm -rf node_modules"))).not.toBeNull();
  });

  it("respects the configured pattern list", () => {
    const config = createDefaultConfig();
    config.permission.destructiveActions = ["dd"];
    const custom = new RuntimeGuard(new PermissionManager(config));
    expect(custom.inspect(toolEvent("bash", "git reset --hard"))).toBeNull();
    expect(custom.inspect(toolEvent("bash", "dd if=/dev/zero of=x"))).not.toBeNull();
  });
});

describe("commandFromDetail", () => {
  it("passes a bare command through", () => {
    expect(commandFromDetail("git reset --hard")).toBe("git reset --hard");
  });

  it("unwraps a JSON tool input", () => {
    // Claude Code's Bash tool arrives as a flattened JSON blob.
    expect(commandFromDetail('{"command":"rm -rf dist","timeout":120}')).toBe(
      "rm -rf dist",
    );
  });

  it("falls back to raw text when the JSON is truncated", () => {
    // Details are capped, so the blob can arrive unparseable — the command
    // is still in there and must still be scanned.
    const truncated = '{"command":"git clean -fd and then so';
    expect(commandFromDetail(truncated)).toBe(truncated);
  });

  it("handles empty details", () => {
    expect(commandFromDetail(undefined)).toBe("");
    expect(commandFromDetail("")).toBe("");
  });
});

describe("isShellTool", () => {
  it("recognises the shell tool names the parsers emit", () => {
    ["bash", "shell", "Bash", "run_command", "run-command", "terminal"].forEach(
      (tool) => expect(isShellTool(tool)).toBe(true),
    );
  });

  it("rejects everything else", () => {
    ["read", "edit", "write", "glob", undefined].forEach((tool) =>
      expect(isShellTool(tool)).toBe(false),
    );
  });
});
