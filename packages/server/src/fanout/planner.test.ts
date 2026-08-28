import { describe, it, expect } from "vitest";
import { asksForFanout, parsePlan, MAX_SUBTASKS } from "./planner";

const HARNESSES = ["opencode", "claude-code", "codex"];

/** Genuinely unrelated pieces — the duplicate guard rejects reworded ones. */
const TOPICS = [
  "authentication flow",
  "billing invoices",
  "search indexing",
  "email notifications",
  "admin dashboard",
  "image uploads",
  "audit logging",
  "rate limiting",
  "webhooks",
  "feature flags",
  "user profiles",
  "export jobs",
  "session storage",
  "password reset",
  "team invites",
  "api keys",
  "dark mode",
  "onboarding",
  "changelog",
  "metrics",
];

describe("asksForFanout", () => {
  it("recognises the ways people ask for it", () => {
    for (const prompt of [
      "use appropriate subagents with respective subagents",
      "split this up into sub-agents",
      "do these in parallel",
      "run them concurrently",
      "use multiple agents for this",
      "work on them at the same time",
    ]) {
      expect(asksForFanout(prompt), prompt).toBe(true);
    }
  });

  it("does not read ordinary requests as asking for it", () => {
    for (const prompt of [
      "write the frontend PRD",
      "fix the failing test",
      "refactor this module and update the docs",
    ]) {
      expect(asksForFanout(prompt), prompt).toBe(false);
    }
  });
});

describe("parsePlan", () => {
  const twoTasks = JSON.stringify({
    parallel: true,
    reasoning: "Frontend and backend are separate documents.",
    subtasks: [
      {
        title: "Frontend PRD",
        prompt:
          "Write docs/frontend-prd.md from ConStruct.md covering UI, screens and state.",
      },
      {
        title: "Backend PRD",
        prompt:
          "Write docs/backend-prd.md from ConStruct.md covering API, schema and jobs.",
      },
    ],
  });

  it("accepts a genuine two-way split", () => {
    const plan = parsePlan(twoTasks, HARNESSES, 4);
    expect(plan?.subtasks).toHaveLength(2);
    expect(plan?.subtasks[0].title).toBe("Frontend PRD");
    expect(plan?.reasoning).toMatch(/separate documents/);
  });

  it("reads the answer out of surrounding prose", () => {
    const plan = parsePlan(
      `Sure — here is the plan:\n\n${twoTasks}\n\nLet me know.`,
      HARNESSES,
      4,
    );
    expect(plan?.subtasks).toHaveLength(2);
  });

  it("honours an explicit refusal to split", () => {
    const output = JSON.stringify({
      parallel: false,
      reasoning: "One document.",
    });
    expect(parsePlan(output, HARNESSES, 4)).toBeNull();
  });

  it("declines a single subtask — that is the normal path with extra steps", () => {
    const output = JSON.stringify({
      parallel: true,
      subtasks: [{ title: "Only one", prompt: "Write the PRD." }],
    });
    expect(parsePlan(output, HARNESSES, 4)).toBeNull();
  });

  it("declines when the pieces are the same instruction reworded", () => {
    const output = JSON.stringify({
      parallel: true,
      subtasks: [
        {
          title: "A",
          prompt: "Write the product requirements document for construct",
        },
        {
          title: "B",
          prompt: "Write the product requirements document for construct now",
        },
      ],
    });
    expect(parsePlan(output, HARNESSES, 4)).toBeNull();
  });

  it("declines an over-long plan rather than truncating a sequence", () => {
    const output = JSON.stringify({
      parallel: true,
      subtasks: TOPICS.slice(0, 8).map((topic, i) => ({
        title: `Step ${i}`,
        prompt: `Implement ${topic} end to end`,
      })),
    });
    expect(parsePlan(output, HARNESSES, 4)).toBeNull();
  });

  it("takes what fits when the user asked for the split themselves", () => {
    const output = JSON.stringify({
      parallel: true,
      subtasks: TOPICS.slice(0, 8).map((topic, i) => ({
        title: `Step ${i}`,
        prompt: `Implement ${topic} end to end`,
      })),
    });
    const plan = parsePlan(output, HARNESSES, 4, true);
    expect(plan?.subtasks).toHaveLength(4);
  });

  it("drops a harness it invented but keeps the task", () => {
    const output = JSON.stringify({
      parallel: true,
      subtasks: [
        {
          title: "A",
          prompt: "Write the frontend spec covering screens",
          harness: "not-a-harness",
        },
        {
          title: "B",
          prompt: "Write the backend spec covering the database",
          harness: "codex",
        },
      ],
    });
    const plan = parsePlan(output, HARNESSES, 4);
    expect(plan?.subtasks[0].harness).toBeUndefined();
    expect(plan?.subtasks[1].harness).toBe("codex");
  });

  it("skips entries with no prompt", () => {
    const output = JSON.stringify({
      parallel: true,
      subtasks: [
        {
          title: "Real",
          prompt: "Write the frontend spec covering screens and state",
        },
        { title: "Empty", prompt: "   " },
        {
          title: "Also real",
          prompt: "Write the backend spec covering database and jobs",
        },
      ],
    });
    expect(parsePlan(output, HARNESSES, 4)?.subtasks).toHaveLength(2);
  });

  it("returns nothing for output that is not JSON at all", () => {
    expect(
      parsePlan("I think we should do it together.", HARNESSES, 4),
    ).toBeNull();
  });

  it("never exceeds the hard cap even when asked to", () => {
    const output = JSON.stringify({
      parallel: true,
      subtasks: TOPICS.map((topic, i) => ({
        title: `T${i}`,
        prompt: `Implement ${topic} end to end`,
      })),
    });
    const plan = parsePlan(output, HARNESSES, 99, true);
    expect(plan?.subtasks.length).toBe(MAX_SUBTASKS);
    expect(MAX_SUBTASKS).toBe(6);
  });
});
