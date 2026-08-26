import { describe, it, expect } from "vitest";
import {
  ROUTER_MODEL_LABEL,
  ROUTING_SECTION,
  buildStarterSoul,
  readRoutingGuidance,
  suggestedRoutes,
} from "./starterSoul";
import { parseSoul } from "./soul";

/**
 * The starter soul.md is the routing configuration, so the round trip — write
 * a file, read it back as guidance — is the contract that matters. A change
 * to the template that the parser stops understanding would silently drop the
 * user back to keyword routing, which is exactly the failure this file exists
 * to prevent.
 */

function guidanceFor(markdown: string) {
  return readRoutingGuidance([{ sections: parseSoul(markdown) }]);
}

describe("buildStarterSoul", () => {
  const harnesses = ["opencode", "claude-code", "codex"];

  it("round-trips the router model it was given", () => {
    const soul = buildStarterSoul({
      scope: "global",
      harnesses,
      routerModel: "claude-code/anthropic/haiku",
    });

    expect(guidanceFor(soul).routerModel).toBe("claude-code/anthropic/haiku");
  });

  it("round-trips a route for every category it suggested", () => {
    const soul = buildStarterSoul({
      scope: "global",
      harnesses,
      routerModel: "",
    });
    const guidance = guidanceFor(soul);

    for (const [category, harness] of suggestedRoutes(harnesses)) {
      expect(guidance.routes[category], `route for ${category}`).toBe(harness);
    }
  });

  it("reads an empty router model as automatic, not as a literal", () => {
    const soul = buildStarterSoul({
      scope: "global",
      harnesses,
      routerModel: "",
    });

    expect(soul).toContain(`${ROUTER_MODEL_LABEL}: (automatic)`);
    expect(guidanceFor(soul).routerModel).toBe("");
  });

  it("only ever routes to a harness that is installed", () => {
    const soul = buildStarterSoul({
      scope: "global",
      harnesses: ["pi"],
      routerModel: "",
    });

    for (const harness of Object.values(guidanceFor(soul).routes)) {
      expect(harness).toBe("pi");
    }
  });

  it("writes a usable file when nothing is installed at all", () => {
    const soul = buildStarterSoul({
      scope: "global",
      harnesses: [],
      routerModel: "",
    });
    const guidance = guidanceFor(soul);

    expect(guidance.routes).toEqual({});
    expect(soul).toContain("No agent CLI was found");
    expect(parseSoul(soul).length).toBeGreaterThan(1);
  });

  it("names the project in a project-scoped file", () => {
    const soul = buildStarterSoul({
      scope: "project",
      harnesses: [],
      routerModel: "",
      projectName: "hive",
    });

    expect(soul).toContain("**hive**");
    expect(soul).toContain("overrides the global soul");
  });

  it("keeps the sections a soul.md is expected to have", () => {
    const soul = buildStarterSoul({
      scope: "global",
      harnesses,
      routerModel: "",
    });
    const headings = parseSoul(soul).map((s) => s.heading);

    expect(headings).toContain(ROUTING_SECTION);
    expect(headings).toContain("Writing style");
    expect(headings).toContain("UI preferences");
  });

  it("does not mistake the explanatory comment for routing entries", () => {
    // The section opens with an HTML comment containing arrows and a
    // `Router model:` line as documentation. Parsing those as real entries
    // would pin categories the user never asked for.
    const guidance = guidanceFor(
      buildStarterSoul({ scope: "global", harnesses, routerModel: "" }),
    );

    expect(Object.keys(guidance.routes)).not.toContain("<category>");
    expect(guidance.notes).toEqual([]);
  });
});

describe("readRoutingGuidance", () => {
  const soul = (body: string) =>
    guidanceFor(`# Soul\n\n## ${ROUTING_SECTION}\n\n${body}\n`);

  it("accepts both arrow spellings", () => {
    expect(soul("- test → opencode\n- docs -> claude-code").routes).toEqual({
      test: "opencode",
      docs: "claude-code",
    });
  });

  it("lowercases the category so matching is case-insensitive", () => {
    expect(soul("- Refactor → claude-code").routes).toEqual({
      refactor: "claude-code",
    });
  });

  it("keeps free-text preferences as notes for the router", () => {
    const guidance = soul(
      "- test → opencode\n- Prefer local models when the task is trivial",
    );

    expect(guidance.routes).toEqual({ test: "opencode" });
    expect(guidance.notes).toEqual([
      "Prefer local models when the task is trivial",
    ]);
  });

  it("lets a project soul override the global one", () => {
    const global = parseSoul(
      `## ${ROUTING_SECTION}\n\n- ${ROUTER_MODEL_LABEL}: a/b/c\n- test → opencode\n`,
    );
    const project = parseSoul(
      `## ${ROUTING_SECTION}\n\n- ${ROUTER_MODEL_LABEL}: x/y/z\n- test → codex\n`,
    );

    // Global first, project last — the order the Second Brain merges in.
    const merged = readRoutingGuidance([
      { sections: global },
      { sections: project },
    ]);

    expect(merged.routerModel).toBe("x/y/z");
    expect(merged.routes.test).toBe("codex");
  });

  it("returns empty guidance when the section is missing entirely", () => {
    const guidance = guidanceFor("# Soul\n\n## Writing style\n\n- Be terse\n");

    expect(guidance.routerModel).toBe("");
    expect(guidance.routes).toEqual({});
    expect(guidance.notes).toEqual([]);
  });

  it("treats a malformed line as a note rather than throwing", () => {
    expect(() => soul("- this line → has → too many arrows")).not.toThrow();
    expect(() => soul("- →")).not.toThrow();
  });
});

describe("suggestedRoutes", () => {
  it("suggests nothing when nothing is installed", () => {
    expect(suggestedRoutes([])).toEqual([]);
  });

  it("prefers a harness whose profile claims the category", () => {
    const routes = Object.fromEntries(
      suggestedRoutes(["opencode", "claude-code", "codex", "gemini"]),
    );

    expect(routes.refactor).toBe("claude-code");
    expect(routes.test).toBe("opencode");
    expect(routes.bugfix).toBe("codex");
    expect(routes.research).toBe("gemini");
  });

  it("falls back to what is there when no preference is installed", () => {
    const routes = Object.fromEntries(suggestedRoutes(["crush"]));
    expect(new Set(Object.values(routes))).toEqual(new Set(["crush"]));
  });
});
