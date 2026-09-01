import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkForUpdate,
  compareVersions,
  getUpdateStatus,
  parseRepoSlug,
  resetUpdateCache,
  upgradeCommand,
  type FetchLike,
  type LocalVersion,
} from "./updates";

const LOCAL: LocalVersion = {
  version: "0.1.0",
  commit: "a".repeat(40),
  branch: "main",
  dirty: false,
};

/**
 * A fake GitHub. Routes are matched by substring, and anything unmatched
 * comes back 404 — which is exactly how the real API answers a repo with
 * no releases, so the "no release yet" path gets exercised for free.
 */
function fakeGitHub(
  routes: Record<string, { status?: number; body?: unknown }>,
) {
  const calls: string[] = [];
  const impl: FetchLike = async (url) => {
    calls.push(url);
    const hit = Object.entries(routes).find(([key]) => url.includes(key));
    const status = hit?.[1].status ?? (hit ? 200 : 404);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => hit?.[1].body ?? null,
    };
  };
  return { impl, calls };
}

const REPO_ROUTE = { body: { default_branch: "main" } };

describe("compareVersions", () => {
  it("orders by numeric release parts", () => {
    expect(compareVersions("0.2.0", "0.1.9")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0", "0.99.99")).toBeGreaterThan(0);
    expect(compareVersions("0.1.0", "0.1.0")).toBe(0);
    expect(compareVersions("0.1.0", "0.2.0")).toBeLessThan(0);
  });

  it("tolerates a leading v and short versions", () => {
    expect(compareVersions("v0.2", "0.1.9")).toBeGreaterThan(0);
    expect(compareVersions("v1", "1.0.0")).toBe(0);
  });

  it("ranks a prerelease below its own release", () => {
    expect(compareVersions("0.2.0-rc.1", "0.2.0")).toBeLessThan(0);
    expect(compareVersions("0.2.0", "0.2.0-rc.1")).toBeGreaterThan(0);
    expect(compareVersions("0.2.0-rc.2", "0.2.0-rc.1")).toBeGreaterThan(0);
  });
});

describe("parseRepoSlug", () => {
  it("reads both URL shapes git writes", () => {
    expect(parseRepoSlug("https://github.com/sreekar2403/hive.git")).toBe(
      "sreekar2403/hive",
    );
    expect(parseRepoSlug("git@github.com:sreekar2403/hive.git")).toBe(
      "sreekar2403/hive",
    );
    expect(parseRepoSlug("sreekar2403/hive")).toBe("sreekar2403/hive");
  });

  it("declines anything that is not a GitHub repo", () => {
    expect(parseRepoSlug(null)).toBeNull();
    expect(parseRepoSlug("https://gitlab.com/a/b/c/d")).toBeNull();
  });
});

describe("upgradeCommand", () => {
  it("tells a dirty checkout to stash first", () => {
    expect(upgradeCommand({ ...LOCAL, dirty: true })).toContain("git stash");
    expect(upgradeCommand(LOCAL)).not.toContain("git stash");
  });
});

describe("checkForUpdate", () => {
  it("reports a newer published release", async () => {
    const { impl } = fakeGitHub({
      "/releases/latest": {
        body: {
          tag_name: "v0.2.0",
          html_url: "https://example.test/releases/v0.2.0",
          body: "Faster routing.",
          published_at: "2026-08-01T00:00:00Z",
        },
      },
      "/compare/": { body: { ahead_by: 12 } },
      "repos/o/r": REPO_ROUTE,
    });

    const status = await checkForUpdate({
      repo: "o/r",
      local: LOCAL,
      fetchImpl: impl,
    });

    expect(status.updateAvailable).toBe(true);
    expect(status.source).toBe("release");
    expect(status.latest?.version).toBe("0.2.0");
    expect(status.behindBy).toBe(12);
    expect(status.error).toBeNull();
  });

  it("still flags upstream commits when no release exists", async () => {
    const { impl } = fakeGitHub({
      "/compare/": { body: { ahead_by: 3 } },
      "repos/o/r": REPO_ROUTE,
    });

    const status = await checkForUpdate({
      repo: "o/r",
      local: LOCAL,
      fetchImpl: impl,
    });

    expect(status.source).toBe("commits");
    expect(status.updateAvailable).toBe(true);
    expect(status.behindBy).toBe(3);
    // A repo with no releases is normal, not a failure to surface.
    expect(status.error).toBeNull();
  });

  it("says nothing is available when up to date", async () => {
    const { impl } = fakeGitHub({
      "/releases/latest": { body: { tag_name: "v0.1.0", html_url: "" } },
      "/compare/": { body: { ahead_by: 0 } },
      "repos/o/r": REPO_ROUTE,
    });

    const status = await checkForUpdate({
      repo: "o/r",
      local: LOCAL,
      fetchImpl: impl,
    });

    expect(status.updateAvailable).toBe(false);
    expect(status.source).toBe("none");
  });

  it("ignores a release older than what is installed", async () => {
    const { impl } = fakeGitHub({
      "/releases/latest": { body: { tag_name: "v0.0.9", html_url: "" } },
      "/compare/": { body: { ahead_by: 0 } },
      "repos/o/r": REPO_ROUTE,
    });

    const status = await checkForUpdate({
      repo: "o/r",
      local: LOCAL,
      fetchImpl: impl,
    });
    expect(status.updateAvailable).toBe(false);
  });

  it("skips a draft release", async () => {
    const { impl } = fakeGitHub({
      "/releases/latest": {
        body: { tag_name: "v9.0.0", draft: true, html_url: "" },
      },
      "/compare/": { body: { ahead_by: 0 } },
      "repos/o/r": REPO_ROUTE,
    });

    const status = await checkForUpdate({
      repo: "o/r",
      local: LOCAL,
      fetchImpl: impl,
    });
    expect(status.latest).toBeNull();
    expect(status.updateAvailable).toBe(false);
  });

  it("surfaces a rate limit rather than claiming to be current", async () => {
    const { impl } = fakeGitHub({
      "/releases/latest": { status: 403 },
      "/compare/": { body: { ahead_by: 0 } },
      "repos/o/r": REPO_ROUTE,
    });

    const status = await checkForUpdate({
      repo: "o/r",
      local: LOCAL,
      fetchImpl: impl,
    });
    expect(status.error).toMatch(/rate limit/i);
    expect(status.updateAvailable).toBe(false);
  });

  it("survives being offline", async () => {
    const impl: FetchLike = async () => {
      throw new Error("getaddrinfo ENOTFOUND api.github.com");
    };
    const status = await checkForUpdate({
      repo: "o/r",
      local: LOCAL,
      fetchImpl: impl,
    });
    expect(status.updateAvailable).toBe(false);
    expect(status.error).toContain("ENOTFOUND");
  });

  it("does not error when the local commit is unknown upstream", async () => {
    const { impl } = fakeGitHub({ "repos/o/r": REPO_ROUTE });
    const status = await checkForUpdate({
      repo: "o/r",
      local: LOCAL,
      fetchImpl: impl,
    });
    expect(status.behindBy).toBeNull();
    expect(status.error).toBeNull();
  });

  it("skips the commit comparison outside a git checkout", async () => {
    const { impl, calls } = fakeGitHub({ "repos/o/r": REPO_ROUTE });
    await checkForUpdate({
      repo: "o/r",
      local: { ...LOCAL, commit: null },
      fetchImpl: impl,
    });
    expect(calls.some((u) => u.includes("/compare/"))).toBe(false);
  });

  it("reports a missing remote instead of guessing one", async () => {
    const impl = vi.fn();
    const status = await checkForUpdate({
      // Empty is "there is no remote"; null would mean "detect it for me".
      repo: "",
      local: LOCAL,
      fetchImpl: impl as unknown as FetchLike,
    });
    expect(status.error).toMatch(/no github remote/i);
    expect(impl).not.toHaveBeenCalled();
  });
});

describe("getUpdateStatus", () => {
  beforeEach(() => resetUpdateCache());

  it("serves the cached answer inside the TTL", async () => {
    const { impl, calls } = fakeGitHub({
      "/releases/latest": { body: { tag_name: "v0.2.0", html_url: "" } },
      "repos/o/r": REPO_ROUTE,
    });
    const opts = { repo: "o/r", local: LOCAL, fetchImpl: impl, ttlMs: 60_000 };

    await getUpdateStatus(opts);
    const before = calls.length;
    await getUpdateStatus(opts);

    expect(calls.length).toBe(before);
  });

  it("goes back out when forced", async () => {
    const { impl, calls } = fakeGitHub({
      "/releases/latest": { body: { tag_name: "v0.2.0", html_url: "" } },
      "repos/o/r": REPO_ROUTE,
    });
    const opts = { repo: "o/r", local: LOCAL, fetchImpl: impl, ttlMs: 60_000 };

    await getUpdateStatus(opts);
    const before = calls.length;
    await getUpdateStatus({ ...opts, force: true });

    expect(calls.length).toBeGreaterThan(before);
  });

  it("collapses concurrent checks into one request", async () => {
    const { impl, calls } = fakeGitHub({
      "/releases/latest": { body: { tag_name: "v0.2.0", html_url: "" } },
      "repos/o/r": REPO_ROUTE,
    });
    const opts = { repo: "o/r", local: LOCAL, fetchImpl: impl, ttlMs: 60_000 };

    await Promise.all([
      getUpdateStatus({ ...opts, force: true }),
      getUpdateStatus({ ...opts, force: true }),
      getUpdateStatus({ ...opts, force: true }),
    ]);

    // One check is two calls (repo metadata + releases), not six.
    expect(calls.filter((u) => u.includes("/releases/latest")).length).toBe(1);
  });
});
