import fs from "fs";
import path from "path";
import { gitArgs } from "./gitUtils";

/**
 * Does this copy of Hive know about a newer Hive?
 *
 * Hive is installed by cloning the repo and linking `bin/hive.js`, not from a
 * registry, so there is no `npm outdated` to lean on. The two facts that
 * actually say "you are behind" are both on GitHub: the newest published
 * release, and how many commits the upstream default branch is ahead of the
 * commit this checkout sits on. We ask for both, because a repo that has
 * never cut a release still ships changes, and someone pinned to an old tag
 * is behind even though their branch is clean.
 *
 * Everything here fails soft. An update check that breaks the app because
 * GitHub rate-limited it, or because the machine is offline, is worse than
 * no update check at all.
 */

export type UpdateSource = "release" | "commits" | "none";

export interface LocalVersion {
  /** `version` from the root package.json. */
  version: string;
  /** Full HEAD sha, or null outside a git checkout. */
  commit: string | null;
  branch: string | null;
  /** Uncommitted changes in the Hive checkout itself. */
  dirty: boolean;
}

export interface LatestRelease {
  /** Tag with any leading `v` stripped, e.g. "0.2.0". */
  version: string;
  tag: string;
  url: string;
  notes: string;
  publishedAt: string | null;
}

export interface UpdateStatus {
  checkedAt: number;
  current: LocalVersion;
  latest: LatestRelease | null;
  /** Commits the upstream default branch is ahead of local HEAD. */
  behindBy: number | null;
  updateAvailable: boolean;
  /** Which signal fired: a newer release, or unmerged upstream commits. */
  source: UpdateSource;
  /** The `owner/repo` that was asked. */
  repo: string | null;
  /** Copy-pasteable upgrade command for this install. */
  command: string;
  /** Why the check could not complete. Null on success. */
  error: string | null;
}

/** GitHub's own advice for unauthenticated polling; also our cache floor. */
export const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000;

const USER_AGENT = "hive-update-check";

/* ------------------------------------------------------------------ */
/* Local side                                                          */
/* ------------------------------------------------------------------ */

/**
 * Walks up from this file to the checkout root: the package.json carrying
 * the `hive` bin. Walking beats a fixed `../../..` because the server runs
 * both from `src` under tsx and from `dist` after a build, which sit at
 * different depths.
 */
export function findRepoRoot(startDir: string = __dirname): string | null {
  let dir = startDir;
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, "package.json");
    try {
      if (fs.existsSync(candidate)) {
        const pkg = JSON.parse(fs.readFileSync(candidate, "utf8"));
        if (pkg?.name === "hive" && pkg?.bin) return dir;
      }
    } catch {
      // A package.json we cannot parse is not the one we are looking for.
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export function readLocalVersion(
  root: string | null = findRepoRoot(),
): LocalVersion {
  const fallback: LocalVersion = {
    version: "0.0.0",
    commit: null,
    branch: null,
    dirty: false,
  };
  if (!root) return fallback;

  let version = fallback.version;
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(root, "package.json"), "utf8"),
    );
    if (typeof pkg?.version === "string") version = pkg.version;
  } catch {
    // Keep the fallback; a missing version only weakens the release check.
  }

  const commit = gitArgs(["rev-parse", "HEAD"], root)?.trim();
  const branch = gitArgs(["rev-parse", "--abbrev-ref", "HEAD"], root)?.trim();
  const status = gitArgs(["status", "--porcelain"], root);

  return {
    version,
    commit: commit || null,
    branch: branch || null,
    dirty: Boolean(status && status.trim().length > 0),
  };
}

/**
 * `owner/repo` for this checkout, read from the `origin` remote so a fork
 * checks itself rather than upstream.
 */
export function detectRepoSlug(root: string | null): string | null {
  if (!root) return null;
  return parseRepoSlug(gitArgs(["config", "--get", "remote.origin.url"], root));
}

/** Handles both URL shapes git writes, plus a bare `owner/repo`. */
export function parseRepoSlug(url: string | null): string | null {
  if (!url) return null;
  const trimmed = url.trim().replace(/\.git$/, "");
  const match =
    /github\.com[/:]([^/]+)\/([^/]+)$/.exec(trimmed) ??
    /^([^/\s]+)\/([^/\s]+)$/.exec(trimmed);
  if (!match) return null;
  return `${match[1]}/${match[2]}`;
}

/* ------------------------------------------------------------------ */
/* Version comparison                                                  */
/* ------------------------------------------------------------------ */

/**
 * Semver comparison, enough of it: numeric release parts win, and a
 * prerelease loses to the same version without one (0.2.0-rc.1 < 0.2.0).
 * Returns a positive number when `a` is newer.
 */
export function compareVersions(a: string, b: string): number {
  const split = (v: string) => {
    const [core, pre = ""] = v.replace(/^v/, "").split("-", 2);
    const nums = core.split(".").map((n) => Number.parseInt(n, 10) || 0);
    while (nums.length < 3) nums.push(0);
    return { nums, pre };
  };
  const left = split(a);
  const right = split(b);
  for (let i = 0; i < 3; i++) {
    if (left.nums[i] !== right.nums[i]) return left.nums[i] - right.nums[i];
  }
  if (left.pre === right.pre) return 0;
  if (!left.pre) return 1;
  if (!right.pre) return -1;
  return left.pre < right.pre ? -1 : 1;
}

/* ------------------------------------------------------------------ */
/* GitHub side                                                         */
/* ------------------------------------------------------------------ */

export type FetchLike = (
  url: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

function ghHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": USER_AGENT,
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function ghGet(
  doFetch: FetchLike,
  url: string,
  token: string | undefined,
  timeoutMs: number,
): Promise<{ status: number; body: unknown }> {
  const res = await doFetch(url, {
    headers: ghHeaders(token),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) return { status: res.status, body: null };
  return { status: res.status, body: await res.json() };
}

export interface CheckOptions {
  repo?: string | null;
  local?: LocalVersion;
  token?: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  /** Upstream branch to compare against. Defaults to the repo's default. */
  branch?: string;
}

/**
 * One live check, no caching. Exported separately from `getUpdateStatus` so
 * tests can drive it with a fake fetch and no timers.
 */
export async function checkForUpdate(
  options: CheckOptions = {},
): Promise<UpdateStatus> {
  const root = findRepoRoot();
  const local = options.local ?? readLocalVersion(root);
  const repo = options.repo ?? detectRepoSlug(root);
  const timeoutMs = options.timeoutMs ?? 8000;
  const doFetch =
    options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);

  const base: UpdateStatus = {
    checkedAt: Date.now(),
    current: local,
    latest: null,
    behindBy: null,
    updateAvailable: false,
    source: "none",
    repo,
    command: upgradeCommand(local),
    error: null,
  };

  if (!repo) return { ...base, error: "No GitHub remote to check against." };
  if (typeof doFetch !== "function") {
    return { ...base, error: "This runtime has no fetch available." };
  }

  const api = `https://api.github.com/repos/${repo}`;
  let latest: LatestRelease | null = null;
  let behindBy: number | null = null;
  let error: string | null = null;

  // 1. Newest published release.
  try {
    const { status, body } = await ghGet(
      doFetch,
      `${api}/releases/latest`,
      options.token,
      timeoutMs,
    );
    if (status === 200) {
      latest = parseRelease(body);
    } else if (status === 403 || status === 429) {
      error = "GitHub rate limit reached; try again later.";
    } else if (status !== 404) {
      // 404 is the ordinary answer for a repo that never cut a release.
      error = `GitHub returned ${status}.`;
    }
  } catch (err) {
    error = describe(err);
  }

  // 2. How far the upstream branch moved past this checkout. Skipped when
  //    there is no local commit to compare from.
  if (local.commit) {
    try {
      const head =
        options.branch ??
        (await defaultBranch(doFetch, api, options.token, timeoutMs));
      if (head) {
        const { status, body } = await ghGet(
          doFetch,
          `${api}/compare/${local.commit}...${head}`,
          options.token,
          timeoutMs,
        );
        if (status === 200) {
          const ahead = (body as { ahead_by?: unknown })?.ahead_by;
          if (typeof ahead === "number") behindBy = ahead;
        }
        // A 404 here means the local commit is unknown upstream (a local
        // branch, a rebase). Not an error worth showing anybody.
      }
    } catch (err) {
      error ??= describe(err);
    }
  }

  const releaseIsNewer =
    latest !== null && compareVersions(latest.version, local.version) > 0;
  const source: UpdateSource = releaseIsNewer
    ? "release"
    : behindBy !== null && behindBy > 0
      ? "commits"
      : "none";

  return {
    ...base,
    checkedAt: Date.now(),
    latest,
    behindBy,
    updateAvailable: source !== "none",
    source,
    error,
  };
}

async function defaultBranch(
  doFetch: FetchLike,
  api: string,
  token: string | undefined,
  timeoutMs: number,
): Promise<string | null> {
  const { status, body } = await ghGet(doFetch, api, token, timeoutMs);
  if (status !== 200) return null;
  const name = (body as { default_branch?: unknown })?.default_branch;
  return typeof name === "string" ? name : null;
}

function parseRelease(body: unknown): LatestRelease | null {
  const r = body as Record<string, unknown> | null;
  if (!r || typeof r.tag_name !== "string") return null;
  if (r.draft === true) return null;
  const tag = r.tag_name;
  return {
    tag,
    version: tag.replace(/^v/, ""),
    url: typeof r.html_url === "string" ? r.html_url : "",
    notes: typeof r.body === "string" ? r.body : "",
    publishedAt: typeof r.published_at === "string" ? r.published_at : null,
  };
}

/**
 * What the user should actually run. A dirty checkout is told to stash
 * first, because `git pull` on top of local edits is how somebody loses
 * work they did not know they had.
 */
export function upgradeCommand(local: LocalVersion): string {
  const pull = "git pull && pnpm install";
  return local.dirty ? `git stash && ${pull} && git stash pop` : pull;
}

function describe(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === "TimeoutError" || err.name === "AbortError") {
      return "Update check timed out.";
    }
    return err.message;
  }
  return String(err);
}

/* ------------------------------------------------------------------ */
/* Cache                                                               */
/* ------------------------------------------------------------------ */

let cached: UpdateStatus | null = null;
let inFlight: Promise<UpdateStatus> | null = null;

/**
 * The cached answer, refreshed at most once per TTL. `force` bypasses the
 * cache but still shares one in-flight request, so somebody mashing "check
 * again" does not spend the whole GitHub rate limit on it.
 */
export async function getUpdateStatus(
  options: CheckOptions & { ttlMs?: number; force?: boolean } = {},
): Promise<UpdateStatus> {
  const ttl = options.ttlMs ?? DEFAULT_TTL_MS;
  const fresh = cached !== null && Date.now() - cached.checkedAt < ttl;
  if (fresh && !options.force) return cached as UpdateStatus;
  if (inFlight) return inFlight;

  inFlight = checkForUpdate(options)
    .then((status) => {
      cached = status;
      return status;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/** The last known answer, without touching the network. */
export function peekUpdateStatus(): UpdateStatus | null {
  return cached;
}

/** Test seam. */
export function resetUpdateCache(): void {
  cached = null;
  inFlight = null;
}
