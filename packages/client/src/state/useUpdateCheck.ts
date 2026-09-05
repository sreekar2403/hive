import { useCallback, useEffect, useState } from "react";
import { API, subscribeToEvents } from "../lib/api";

/** Mirrors `UpdateStatus` in packages/server/src/updates.ts. */
export interface UpdateStatus {
  checkedAt: number;
  current: {
    version: string;
    commit: string | null;
    branch: string | null;
    dirty: boolean;
  };
  latest: {
    version: string;
    tag: string;
    url: string;
    notes: string;
    publishedAt: string | null;
  } | null;
  behindBy: number | null;
  updateAvailable: boolean;
  source: "release" | "commits" | "none";
  repo: string | null;
  command: string;
  error: string | null;
}

const DISMISSED_KEY = "hive.update.dismissed";

/**
 * Identifies *what* was dismissed, not just that something was. Dismissing
 * "0.2.0 is out" must not also silence "0.3.0 is out" a month later, so the
 * key carries the upstream state and a newer one is a different key.
 */
function stateKey(status: UpdateStatus): string {
  return `${status.latest?.tag ?? "none"}:${status.behindBy ?? 0}`;
}

function readDismissed(): string {
  try {
    return localStorage.getItem(DISMISSED_KEY) ?? "";
  } catch {
    // Storage can throw in a locked-down context; nothing is dismissed then.
    return "";
  }
}

/**
 * Whether a newer Hive is available.
 *
 * Asks once on mount (the server answers from its own cache, so this is
 * cheap on every reload) and then listens on the SSE stream, which is what
 * lets a window that has been open all day notice a release without a
 * reload.
 */
export function useUpdateCheck() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [dismissed, setDismissed] = useState(readDismissed);

  useEffect(() => {
    let cancelled = false;

    API.get<UpdateStatus>("/api/updates")
      .then((s) => {
        if (!cancelled) setStatus(s);
      })
      .catch(() => {
        // An older server has no /api/updates, and an unreachable one is
        // already reported by the connection indicator. Stay quiet.
      });

    const unsubscribe = subscribeToEvents((type, data) => {
      if (cancelled || type !== "update:available") return;
      setStatus(data as UpdateStatus);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const check = useCallback(async () => {
    setChecking(true);
    try {
      setStatus(await API.post<UpdateStatus>("/api/updates/check"));
    } catch {
      // Leave the last known status in place rather than blanking the UI.
    } finally {
      setChecking(false);
    }
  }, []);

  const dismiss = useCallback(() => {
    if (!status) return;
    const key = stateKey(status);
    setDismissed(key);
    try {
      localStorage.setItem(DISMISSED_KEY, key);
    } catch {
      // Non-fatal: the notice reappears next reload, which is acceptable.
    }
  }, [status]);

  const visible = Boolean(
    status?.updateAvailable && stateKey(status) !== dismissed,
  );

  return { status, visible, checking, check, dismiss };
}
