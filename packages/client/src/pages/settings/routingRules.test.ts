import { describe, it, expect } from "vitest";
import { patternError, ruleFor } from "./RoutingSection";
import type { RoutingRule } from "./types";

/**
 * The "which rule would this prompt reach?" tester.
 *
 * These assert the *ordering*, because a tester that disagreed with the
 * server would be worse than none at all — it would talk someone into a
 * rule set that does something else in practice. Mirrors Router.route.
 */
function rule(over: Partial<RoutingRule> = {}): RoutingRule {
  return {
    id: `r${Math.random()}`,
    taskType: "tests",
    pattern: "test|spec",
    harness: "opencode",
    model: "",
    reasoning: "",
    enabled: true,
    ...over,
  };
}

const DEFAULT = rule({ taskType: "default", pattern: "", harness: "codex" });

describe("ruleFor", () => {
  it("returns nothing for an empty prompt", () => {
    expect(ruleFor("   ", [rule(), DEFAULT])).toBeNull();
  });

  it("picks the first matching rule, not the best one", () => {
    const first = rule({ taskType: "a", pattern: "fix" });
    const second = rule({ taskType: "b", pattern: "fix the parser" });
    expect(ruleFor("fix the parser", [first, second, DEFAULT])?.taskType).toBe(
      "a",
    );
  });

  it("matches case-insensitively, as the server does", () => {
    expect(ruleFor("Add a TEST for it", [rule(), DEFAULT])?.taskType).toBe(
      "tests",
    );
  });

  it("falls through to the default when nothing matches", () => {
    expect(ruleFor("write the docs", [rule(), DEFAULT])?.taskType).toBe(
      "default",
    );
  });

  it("skips a disabled rule", () => {
    const off = rule({ taskType: "tests", enabled: false });
    expect(ruleFor("add a test", [off, DEFAULT])?.taskType).toBe("default");
  });

  it("skips a rule with no pattern rather than matching everything", () => {
    const blank = rule({ taskType: "blank", pattern: "   " });
    expect(ruleFor("anything", [blank, DEFAULT])?.taskType).toBe("default");
  });

  it("skips a pattern that cannot compile", () => {
    const broken = rule({ taskType: "broken", pattern: "test(" });
    expect(ruleFor("add a test", [broken, DEFAULT])?.taskType).toBe("default");
  });

  it("never returns the default by matching its empty pattern", () => {
    // The default is reached by falling through, not by matching — its
    // pattern is empty and would otherwise match every prompt first.
    const order = [DEFAULT, rule()];
    expect(ruleFor("add a test", order)?.taskType).toBe("tests");
  });

  it("returns null when there is no default and nothing matches", () => {
    expect(ruleFor("write the docs", [rule()])).toBeNull();
  });
});

describe("patternError", () => {
  it("says nothing about a valid pattern", () => {
    expect(patternError("test|spec")).toBeNull();
    expect(patternError("")).toBeNull();
    expect(patternError("   ")).toBeNull();
  });

  it("explains one that cannot compile", () => {
    // The server compiles this too, so a rule that cannot compile never
    // matches — silently, before this was surfaced.
    expect(patternError("test(")).toBeTruthy();
    expect(patternError("[a-")).toBeTruthy();
  });
});
