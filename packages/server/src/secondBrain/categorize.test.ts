import { describe, it, expect } from "vitest";
import { categorize, keywords } from "./categorize";
import type { RoutingRule } from "../config";

const testRules: RoutingRule[] = [
  {
    id: "test",
    taskType: "test",
    pattern: "test|spec|assert|expect|describe|it\\(|jest|vitest|mocha",
    harness: "opencode",
    model: "",
    reasoning: "Test-related task",
    enabled: true,
  },
  {
    id: "refactor",
    taskType: "refactor",
    pattern: "refactor|clean|restructure|rename|move|extract",
    harness: "claude-code",
    model: "",
    reasoning: "Refactoring task",
    enabled: true,
  },
  {
    id: "docs",
    taskType: "docs",
    pattern: "document|readme|doc|writeup|explain|comment",
    harness: "claude-code",
    model: "",
    reasoning: "Documentation task",
    enabled: true,
  },
  {
    id: "default",
    taskType: "default",
    pattern: "",
    harness: "opencode",
    model: "",
    reasoning: "Default routing",
    enabled: true,
  },
];

describe("categorize", () => {
  it("returns the task type when a keyword rule matches", () => {
    expect(categorize("Write tests for the router", testRules)).toBe("test");
    expect(categorize("Add a spec for the login flow", testRules)).toBe("test");
    expect(categorize("Refactor the auth module", testRules)).toBe("refactor");
    expect(categorize("Rename the function to be clearer", testRules)).toBe("refactor");
    expect(categorize("Document the API endpoints", testRules)).toBe("docs");
    expect(categorize("Write a readme for the project", testRules)).toBe("docs");
  });

  it("is case insensitive", () => {
    expect(categorize("WRITE TESTS FOR THE ROUTER", testRules)).toBe("test");
    expect(categorize("Refactor The Code", testRules)).toBe("refactor");
  });

  it("returns 'general' when no rule matches", () => {
    expect(categorize("Hello world", testRules)).toBe("general");
    expect(categorize("What is the meaning of life?", testRules)).toBe("general");
  });

  it("skips disabled rules", () => {
    const rulesWithDisabled = [...testRules];
    rulesWithDisabled[0].enabled = false;
    expect(categorize("Write tests now", rulesWithDisabled)).toBe("general");
  });

  it("skips the default rule during matching", () => {
    expect(categorize("This doesn't match any pattern", testRules)).toBe("general");
  });

  it("handles malformed regex patterns gracefully", () => {
    const rulesWithBadPattern: RoutingRule[] = [
      {
        id: "bad",
        taskType: "bad",
        pattern: "[invalid",
        harness: "opencode",
        model: "",
        reasoning: "Bad pattern",
        enabled: true,
      },
      {
        id: "default",
        taskType: "default",
        pattern: "",
        harness: "opencode",
        model: "",
        reasoning: "Default",
        enabled: true,
      },
    ];
    // Should not throw, should fall back to general
    expect(categorize("anything", rulesWithBadPattern)).toBe("general");
  });
});

describe("keywords", () => {
  it("extracts meaningful words from a prompt", () => {
    const result = keywords("Add tests for the router authentication module", 10);
    expect(result).toContain("tests");
    expect(result).toContain("router");
    expect(result).toContain("authentication");
    expect(result).toContain("module");
  });

  it("filters out stopwords", () => {
    const result = keywords("Add the tests for the module", 10);
    expect(result).not.toContain("the");
    expect(result).not.toContain("for");
    expect(result).not.toContain("add");
  });

  it("filters out short words", () => {
    const result = keywords("Fix it now", 10);
    expect(result).not.toContain("it");
    expect(result).not.toContain("fix");
  });

  it("limits the number of returned keywords", () => {
    const result = keywords(
      "one two three four five six seven eight nine ten",
      3,
    );
    expect(result.length).toBeLessThanOrEqual(3);
  });

  it("handles punctuation and special characters", () => {
    const result = keywords("Fix the bug! @#$%", 10);
    expect(result).toContain("bug");
  });

  it("handles hyphenated words", () => {
    const result = keywords("fix the build-system", 10);
    expect(result).toContain("build-system");
  });

  it("returns empty array for prompt with only stopwords", () => {
    const result = keywords("the and or but", 10);
    expect(result).toEqual([]);
  });
});
