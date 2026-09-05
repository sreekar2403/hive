import { Router, Request, Response } from "express";
import { loadConfig } from "../config";
import { broadcast } from "./events";
import {
  DEFAULT_TTL_MS,
  getUpdateStatus,
  peekUpdateStatus,
  readLocalVersion,
  upgradeCommand,
  type UpdateStatus,
} from "../updates";

/**
 * Whether a newer Hive exists, and how to get it.
 *
 * Two endpoints on purpose. `GET /api/updates` is the cheap one the app
 * calls on load and every few hours; it answers from cache and only reaches
 * GitHub when the cache is stale. `POST /api/updates/check` is the "check
 * now" button and always goes out.
 */
const router: Router = Router();

function settings() {
  try {
    return loadConfig().updates;
  } catch {
    // A malformed config file should not take the update check down.
    return undefined;
  }
}

function disabledStatus(): UpdateStatus {
  const local = readLocalVersion();
  return {
    checkedAt: Date.now(),
    current: local,
    latest: null,
    behindBy: null,
    updateAvailable: false,
    source: "none",
    repo: null,
    command: upgradeCommand(local),
    error: null,
  };
}

function options() {
  const cfg = settings();
  return {
    repo: cfg?.repo ? cfg.repo : undefined,
    token: process.env.GITHUB_TOKEN || undefined,
    ttlMs:
      typeof cfg?.checkIntervalHours === "number" && cfg.checkIntervalHours > 0
        ? cfg.checkIntervalHours * 60 * 60 * 1000
        : DEFAULT_TTL_MS,
  };
}

// GET /api/updates - cached answer; refreshes only when stale.
router.get("/", async (_req: Request, res: Response) => {
  if (settings()?.enabled === false) {
    res.json(disabledStatus());
    return;
  }
  res.json(await getUpdateStatus(options()));
});

// POST /api/updates/check - the "check now" button.
router.post("/check", async (_req: Request, res: Response) => {
  if (settings()?.enabled === false) {
    res.json(disabledStatus());
    return;
  }
  const status = await getUpdateStatus({ ...options(), force: true });
  if (status.updateAvailable) broadcast("update:available", status);
  res.json(status);
});

/**
 * The check that runs on its own, so a long-lived window learns about a
 * release without anyone reloading it. Deliberately late and slow: the
 * first check waits a minute so it never competes with startup, and it
 * only announces on the SSE stream when there is genuinely something new.
 */
export function startUpdateWatcher(): () => void {
  const cfg = settings();
  if (cfg?.enabled === false) return () => {};

  const intervalMs = options().ttlMs;
  let lastAnnounced: string | null = null;

  const run = async () => {
    try {
      const status = await getUpdateStatus(options());
      if (!status.updateAvailable) return;
      // One announcement per distinct upstream state, so a window that has
      // been open for a week is not nagged every six hours about the same
      // release.
      const key = `${status.latest?.tag ?? ""}:${status.behindBy ?? 0}`;
      if (key === lastAnnounced) return;
      lastAnnounced = key;
      broadcast("update:available", status);
    } catch {
      // Offline, rate-limited, whatever. Try again next tick.
    }
  };

  const first = setTimeout(run, 60_000);
  const timer = setInterval(run, intervalMs);
  // Neither should hold the process open.
  first.unref?.();
  timer.unref?.();

  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}

/** For `hive doctor` and anything else that wants the answer without a fetch. */
export { peekUpdateStatus };

export default router;
