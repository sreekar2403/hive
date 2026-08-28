import fs from "fs";
import path from "path";

/**
 * Windows only: get a CLI's *real* executable so arguments are not routed
 * through `cmd.exe`.
 *
 * The bug this exists to prevent is silent and total. Most of these CLIs are
 * installed by npm, which puts a `.cmd` batch shim on PATH rather than the
 * binary. `cross-spawn` runs a `.cmd` as `cmd.exe /d /s /c "…"`, and cmd.exe
 * treats a raw newline inside an argument as the end of the command — so a
 * multi-line prompt arrives at the agent truncated at its first line.
 *
 * Every prompt Hive builds is multi-line as soon as anything is prepended to
 * it (the Second Brain briefing, conversation history, a retry's error
 * block), and the first line of those is a header. The agent would receive
 * `=== Context from Hive's memory of your past work ===` and nothing else,
 * then reasonably answer "your message seems to be empty".
 *
 * Spawning the underlying `.exe` (or `node <script>`) directly skips cmd.exe
 * altogether: Node escapes argv for `CreateProcess` itself, and newlines
 * survive verbatim.
 */
export interface ResolvedCommand {
  command: string;
  /** Prefixed to the caller's args — a node shim needs its script path. */
  prefixArgs: string[];
}

/** The `"…\bin\thing.exe"   %*` line of an npm binary shim. */
const EXE_CALL = /"?([^"]*?\.exe)"?(?:\s|$)/i;
/** The `"…\node.exe"  "…\cli.js" %*` line of an npm node-script shim. */
const NODE_SCRIPT_CALL = /node(?:\.exe)?"?\s+"?([^"]*?\.(?:js|mjs|cjs))"?/i;

/**
 * Batch bookkeeping rather than the thing being run. Skipping these keeps a
 * `SET dp0=…` or a `GOTO` from being mistaken for the invocation. Matching
 * line by line (instead of one multiline regex over the whole file) also
 * means a backslash inside a Windows path can never be read as the start of
 * a new line, which is exactly how a `\r`-prefixed path fooled an earlier
 * version of this.
 */
const NOISE =
  /^(?::|@?call\s+:|@?(?:echo|set|goto|if|exit|setlocal|endlocal|rem)(?![a-z0-9_]))/i;

function commandLines(body: string): string[] {
  return body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !NOISE.test(line));
}

const cache = new Map<string, ResolvedCommand>();

/**
 * Expands the `%dp0%` / `%~dp0` the npm shims use for their own directory.
 * Anything else left unexpanded means we do not understand this shim, and
 * the caller falls back to running it as written.
 */
function expand(raw: string, shimDir: string): string | null {
  const out = raw
    .replace(/%~?dp0%?\\?/gi, `${shimDir}${path.sep}`)
    .replace(/\//g, path.sep)
    .trim();
  if (out.includes("%")) return null;
  return path.normalize(out);
}

export function resolveWindowsShim(command: string): ResolvedCommand {
  const asIs: ResolvedCommand = { command, prefixArgs: [] };
  if (process.platform !== "win32") return asIs;

  const cached = cache.get(command);
  if (cached) return cached;

  const shimPath = locateShim(command);
  if (!shimPath) {
    cache.set(command, asIs);
    return asIs;
  }

  let body: string;
  try {
    body = fs.readFileSync(shimPath, "utf8");
  } catch {
    cache.set(command, asIs);
    return asIs;
  }

  const shimDir = path.dirname(shimPath);
  let resolved = asIs;

  for (const line of commandLines(body)) {
    // A node-script shim also names an .exe (node's own), so it has to be
    // tried first — otherwise every one of them would resolve to the node
    // binary with the script silently dropped.
    const script = NODE_SCRIPT_CALL.exec(line);
    const scriptPath = script ? expand(script[1], shimDir) : null;
    if (scriptPath && fs.existsSync(scriptPath)) {
      // process.execPath, not "node": the server's own runtime is known to
      // exist, and a PATH without node would put us back on a shim.
      resolved = { command: process.execPath, prefixArgs: [scriptPath] };
      break;
    }

    const exe = EXE_CALL.exec(line);
    const target = exe ? expand(exe[1], shimDir) : null;
    if (target && fs.existsSync(target)) {
      resolved = { command: target, prefixArgs: [] };
      break;
    }
  }

  cache.set(command, resolved);
  return resolved;
}

/**
 * A bare name ("opencode") is looked up on PATH the way the shell would; an
 * explicit path is taken as given. Only batch shims are of interest — a real
 * `.exe` on PATH already behaves.
 */
function locateShim(command: string): string | null {
  const isBatch = (p: string) => /\.(cmd|bat)$/i.test(p);

  if (command.includes(path.sep) || command.includes("/")) {
    return isBatch(command) && fs.existsSync(command) ? command : null;
  }

  if (isBatch(command)) return searchPath(command);

  // `spawn("opencode")` finds opencode.cmd via PATHEXT; look the same way.
  for (const ext of [".cmd", ".bat"]) {
    const found = searchPath(command + ext);
    if (found) return found;
  }
  return null;
}

function searchPath(fileName: string): string | null {
  const dirs = (process.env.PATH || "").split(path.delimiter);
  for (const dir of dirs) {
    if (!dir) continue;
    const candidate = path.join(dir, fileName);
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      // An unreadable PATH entry is not worth failing over.
    }
  }
  return null;
}

/** Tests reach in here; the cache would otherwise outlive a fixture. */
export function clearShimCache(): void {
  cache.clear();
}
