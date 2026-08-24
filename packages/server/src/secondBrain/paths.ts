import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  type Config,
  type SecondBrainConfig,
  createDefaultSecondBrainConfig,
  deepMerge,
} from "../config";
import type { BrainScope } from "./types";

/**
 * Where the two `mem/` stores live, and how `mem/config.json` layers over
 * `hive.config.json` (ticket 039-06, option C for config).
 *
 * Resolution order, most specific last:
 *   1. built-in defaults          (createDefaultSecondBrainConfig)
 *   2. hive.config.json           (config.secondBrain)
 *   3. ~/.hive/mem/config.json    (global store overrides)
 *   4. <project>/mem/config.json  (project store overrides)
 *
 * Steps 3 and 4 are what let one repo opt out of learning without changing
 * anything machine-wide.
 */

/** Directory names under a store root. Kept in one place so the layout is greppable. */
export const LAYOUT = {
  soul: "soul.md",
  config: "config.json",
  suggestions: "soul.suggestions.json",
  user: "user",
  task: "task",
  graph: "graph",
  nodes: path.join("graph", "nodes.json"),
  edges: path.join("graph", "edges.json"),
  queries: path.join("graph", "queries"),
} as const;

/** Every directory a fully-formed store contains, relative to its root. */
const STORE_DIRS = [
  "user/preferences",
  "user/patterns",
  "user/rules",
  "task/failures",
  "task/strategies",
  "task/routing",
  "graph",
  "graph/queries",
];

/**
 * The machine-wide store. Sits next to the rest of Hive's per-user state
 * rather than in the repo, so it survives cloning the project elsewhere.
 */
export function globalStoreRoot(brainConfig?: SecondBrainConfig): string {
  const configured = brainConfig?.globalDir?.trim();
  if (configured) return path.resolve(expandHome(configured));
  return path.join(os.homedir(), ".hive", "mem");
}

/**
 * The project store, resolved against the project's working tree. Falls
 * back to the server's own cwd when no project is in play, which is the
 * same convention the rest of the server uses for an unscoped task.
 */
export function projectStoreRoot(
  projectPath: string | null | undefined,
  brainConfig?: SecondBrainConfig,
): string {
  const dir = brainConfig?.dir?.trim() || "mem";
  if (path.isAbsolute(dir)) return dir;
  return path.join(projectPath || process.cwd(), dir);
}

/** Both store roots for a project, in read order (least specific first). */
export function storeRoots(
  projectPath: string | null | undefined,
  brainConfig?: SecondBrainConfig,
): Array<{ scope: BrainScope; root: string }> {
  return [
    { scope: "global", root: globalStoreRoot(brainConfig) },
    { scope: "project", root: projectStoreRoot(projectPath, brainConfig) },
  ];
}

/**
 * The effective Second Brain config for a project: `hive.config.json`'s
 * section with each store's `config.json` layered over it.
 *
 * A malformed `mem/config.json` is reported and skipped rather than thrown
 * — a typo in an optional override file should not take the server down.
 */
export function resolveBrainConfig(
  config: Config,
  projectPath?: string | null,
): SecondBrainConfig {
  const resolved = createDefaultSecondBrainConfig();
  if (config.secondBrain) deepMerge(resolved, config.secondBrain);

  // The store roots themselves depend on the config we're still building,
  // so this first pass uses what we have — which is enough, since `dir`
  // and `globalDir` are only ever set in hive.config.json.
  for (const { root } of storeRoots(projectPath, resolved)) {
    const overridePath = path.join(root, LAYOUT.config);
    try {
      if (!fs.existsSync(overridePath)) continue;
      const raw = fs.readFileSync(overridePath, "utf-8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") deepMerge(resolved, parsed);
    } catch (err) {
      console.warn(
        `[second-brain] ignoring ${overridePath}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  return resolved;
}

/**
 * Creates a store's directory tree if it isn't there. Called lazily on the
 * first write to a scope — reading a store that has never been written to
 * must not create anything, or every `git status` would show a stray
 * `mem/` the moment Hive started.
 */
export function ensureStore(root: string): string {
  for (const dir of STORE_DIRS) {
    fs.mkdirSync(path.join(root, ...dir.split("/")), { recursive: true });
  }
  return root;
}

/** True when a store root exists on disk with at least its top-level layout. */
export function storeExists(root: string): boolean {
  return fs.existsSync(root) && fs.statSync(root).isDirectory();
}

/** `~/foo` → `<home>/foo`. Left alone on every other shape. */
function expandHome(input: string): string {
  if (input === "~") return os.homedir();
  if (input.startsWith("~/") || input.startsWith("~\\")) {
    return path.join(os.homedir(), input.slice(2));
  }
  return input;
}
