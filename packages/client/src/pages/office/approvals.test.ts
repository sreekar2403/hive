import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApprovalsStore, type PendingPermission } from "./approvals";

const REQ_A: PendingPermission = {
  id: "p1",
  sessionId: "s1",
  action: "git push --force",
  description: "Force-push to origin",
  command: "git push --force origin main",
  timestamp: 0,
};

function mockFetch(body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(body),
  }) as unknown as typeof fetch;
}

describe("ApprovalsStore", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("refreshes pending requests from the server", async () => {
    const f = mockFetch([REQ_A]);
    vi.stubGlobal("fetch", f);
    const store = new ApprovalsStore();
    await store.refresh();
    expect(store.snapshot()).toEqual([REQ_A]);
    expect(f).toHaveBeenCalledWith(
      expect.stringContaining("/api/permissions"),
      expect.anything(),
    );
  });

  it("notifies subscribers after a refresh", async () => {
    vi.stubGlobal("fetch", mockFetch([REQ_A]));
    const store = new ApprovalsStore();
    const seen: PendingPermission[][] = [];
    store.subscribe((list) => seen.push(list));
    await store.refresh();
    expect(seen.at(-1)).toHaveLength(1);
  });

  it("optimistically removes an approved request", async () => {
    const f = vi.fn((url: RequestInfo | URL) => {
      const path = String(url);
      if (path.endsWith("/api/permissions")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([REQ_A]),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
    vi.stubGlobal("fetch", f as unknown as typeof fetch);
    const store = new ApprovalsStore();
    await store.refresh();
    const ok = await store.approve("p1");
    expect(ok).toBe(true);
    expect(store.snapshot()).toEqual([]);
  });

  it("keeps the request visible when the POST fails", async () => {
    const f = vi.fn((url: RequestInfo | URL) => {
      const path = String(url);
      if (path.endsWith("/api/permissions")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([REQ_A]),
        });
      }
      return Promise.reject(new Error("network down"));
    });
    vi.stubGlobal("fetch", f as unknown as typeof fetch);
    const store = new ApprovalsStore();
    await store.refresh();
    const ok = await store.approve("p1");
    expect(ok).toBe(false);
    expect(store.snapshot()).toEqual([REQ_A]);
  });

  it("polls on an interval until stopped", async () => {
    const f = mockFetch([]);
    vi.stubGlobal("fetch", f);
    const store = new ApprovalsStore();
    store.startPolling(5000);

    await vi.advanceTimersByTimeAsync(10_001);
    expect(f).toHaveBeenCalledTimes(3); // initial + two ticks

    store.stopPolling();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(f).toHaveBeenCalledTimes(3);
  });
});
