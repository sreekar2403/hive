import { afterEach, describe, expect, it, vi } from "vitest";
import { ApprovalsStore, type PendingPermission } from "../office/approvals";
import { formatRemaining } from "./PermissionPane";

const REQ: PendingPermission = {
  id: "p1",
  sessionId: "chat-1",
  action: "git checkout -b cleanup/remove-repeated-intro",
  description:
    "The agent stopped mid-task trying to run `git checkout -b cleanup/remove-repeated-intro`. Approving re-runs the task with that command allowed.",
  command: "git checkout -b cleanup/remove-repeated-intro",
  timestamp: Date.now(),
  timeoutAt: Date.now() + 45_000,
};

describe("session-scoped approvals", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches only the active chat's requests", async () => {
    const f = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([REQ]),
    });
    vi.stubGlobal("fetch", f);
    const store = new ApprovalsStore("chat-1");
    await store.refresh();
    expect(f).toHaveBeenCalledWith(
      expect.stringContaining("/api/permissions?sessionId=chat-1"),
      expect.anything(),
    );
    expect(store.snapshot()).toEqual([REQ]);
  });

  it("an unscoped store keeps fetching everything (Office Floor)", async () => {
    const f = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([REQ]),
    });
    vi.stubGlobal("fetch", f);
    const store = new ApprovalsStore();
    await store.refresh();
    const url = String(f.mock.calls[0][0]);
    expect(url).toContain("/api/permissions");
    expect(url).not.toContain("sessionId=");
  });

  it("settles through the same approve endpoint", async () => {
    const f = vi.fn((url: RequestInfo | URL) => {
      const path = String(url);
      if (path.includes("/api/permissions?")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([REQ]),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
    vi.stubGlobal("fetch", f as unknown as typeof fetch);
    const store = new ApprovalsStore("chat-1");
    await store.refresh();
    const ok = await store.approve("p1");
    expect(ok).toBe(true);
    expect(store.snapshot()).toEqual([]);
    expect(f).toHaveBeenCalledWith(
      expect.stringContaining("/api/permissions/p1/approve"),
      expect.anything(),
    );
  });
});

describe("formatRemaining", () => {
  it("renders m:ss and clamps the past at zero", () => {
    expect(formatRemaining(45_000)).toBe("0:45");
    expect(formatRemaining(125_000)).toBe("2:05");
    expect(formatRemaining(0)).toBe("0:00");
    expect(formatRemaining(-3_000)).toBe("0:00");
  });
});
