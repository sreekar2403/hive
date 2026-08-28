#!/usr/bin/env node
"use strict";

/**
 * `hive` — one command that brings the whole app up from any directory.
 *
 * Replaces the two-terminal dance (`pnpm dev:server` in one, `pnpm
 * dev:electron` in another): this starts the API server, the Vite dev
 * server and the desktop window as children of a single process, streams
 * their output into one prefixed log, and takes them all down together on
 * Ctrl+C or when the window is closed.
 *
 * Everything runs with the repo root as its working directory regardless
 * of where you invoked it from — the server resolves hive.config.json
 * against process.cwd(), so that part is load-bearing, not tidiness.
 *
 * Tools are launched as `node <tool entrypoint>` rather than through the
 * .cmd shims in node_modules/.bin: it avoids Windows shell quoting, and
 * it gives us a real pid per child to shut down afterwards.
 */

const { spawn, spawnSync } = require("child_process");
const http = require("http");
const net = require("net");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const CLIENT = path.join(ROOT, "packages", "client");

const DEFAULT_API_PORT = 3001;
const DEFAULT_UI_PORT = 3000;

/* ------------------------------------------------------------------ */
/* Output                                                              */
/* ------------------------------------------------------------------ */

const useColor =
  process.stdout.isTTY && !process.env.NO_COLOR && process.env.TERM !== "dumb";

const paint = (code) => (text) =>
  useColor ? `\x1b[${code}m${text}\x1b[0m` : text;
const dim = paint("2");
const bold = paint("1");
const amber = paint("33");
const green = paint("32");
const blue = paint("36");
const magenta = paint("35");
const red = paint("31");
const yellow = paint("93");

function note(message) {
  console.log(`${amber("hive")} ${message}`);
}

function fail(message, hint) {
  console.error(`${red("hive")} ${message}`);
  if (hint) console.error(`     ${dim(hint)}`);
  // Anything already started has to come down too: half a stack left
  // running is worse than none, and it holds the ports.
  stopChildren();
  process.exit(1);
}

/** Streams a child's output line by line under a fixed label. */
function pipeOutput(child, label, colorise) {
  const prefix = `${colorise(label.padEnd(6))} `;
  const forward = (stream, out) => {
    if (!stream) return;
    let buffered = "";
    stream.on("data", (chunk) => {
      buffered += chunk.toString();
      const lines = buffered.split(/\r?\n/);
      buffered = lines.pop() ?? "";
      for (const line of lines) out.write(`${prefix}${line}\n`);
    });
    stream.on("end", () => {
      if (buffered.trim()) out.write(`${prefix}${buffered}\n`);
    });
  };
  forward(child.stdout, process.stdout);
  forward(child.stderr, process.stderr);
}

/* ------------------------------------------------------------------ */
/* Arguments                                                           */
/* ------------------------------------------------------------------ */

const HELP = `
${bold("hive")} — start the Hive desktop app

  ${bold("hive")}                 API server + UI + desktop window
  ${bold("hive web")}             API server + UI only; open ${dim("http://localhost:3000")} yourself
  ${bold("hive server")}          API server only
  ${bold("hive stop")}            stop whatever is already listening on Hive's ports
  ${bold("hive doctor")}          check this machine can run all of the above
  ${bold("hive doctor --deep")}   also run one real prompt per CLI ${dim("(costs tokens)")}

Options
  -p, --port <n>       API server port          ${dim(`(default ${DEFAULT_API_PORT})`)}
      --ui-port <n>    Vite dev server port     ${dim(`(default ${DEFAULT_UI_PORT})`)}
      --devtools       open DevTools with the window
      --no-window      same as ${bold("hive web")}
      --deep           doctor: verify each CLI's event stream still parses
      --json           doctor: machine-readable report on stdout
  -h, --help           this message
  -v, --version        print the version

Ctrl+C stops everything. Closing the window does too.
`;

function parseArgs(argv) {
  const options = {
    mode: "app",
    apiPort: Number(process.env.PORT) || DEFAULT_API_PORT,
    uiPort: Number(process.env.HIVE_UI_PORT) || DEFAULT_UI_PORT,
    devtools: false,
    deep: false,
    json: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "app":
      case "web":
      case "server":
      case "stop":
      case "doctor":
        options.mode = arg;
        break;
      case "-p":
      case "--port":
        options.apiPort = Number(argv[++i]);
        break;
      case "--ui-port":
        options.uiPort = Number(argv[++i]);
        break;
      case "--devtools":
        options.devtools = true;
        break;
      case "--deep":
        options.deep = true;
        break;
      case "--json":
        options.json = true;
        break;
      case "--no-window":
        options.mode = "web";
        break;
      case "-h":
      case "--help":
        console.log(HELP);
        process.exit(0);
        break;
      case "-v":
      case "--version": {
        const pkg = require(path.join(ROOT, "package.json"));
        console.log(pkg.version);
        process.exit(0);
        break;
      }
      default:
        fail(
          `Unknown argument: ${arg}`,
          "Run `hive --help` to see what it takes.",
        );
    }
  }

  if (!Number.isInteger(options.apiPort) || !Number.isInteger(options.uiPort)) {
    fail("Ports must be whole numbers.");
  }
  return options;
}

/* ------------------------------------------------------------------ */
/* Probes                                                              */
/* ------------------------------------------------------------------ */

function get(url, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.setTimeout(timeoutMs, () => req.destroy());
    req.on("error", () => resolve(null));
  });
}

/** True when a Hive server — not just anything — answers on this port. */
async function hiveIsListening(port) {
  return (await get(`http://127.0.0.1:${port}/health`)) === 200;
}

function probe(port, host) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    const done = (result) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(700, () => done(false));
    socket.on("connect", () => done(true));
    socket.on("error", () => done(false));
  });
}

/**
 * Both loopback families, because they are not interchangeable here:
 * Vite binds IPv6 loopback only ([::1]:3000), while the API server binds
 * dual-stack. Probing 127.0.0.1 alone waits forever for a UI that is
 * already up.
 */
async function portInUse(port) {
  const results = await Promise.all([
    probe(port, "127.0.0.1"),
    probe(port, "::1"),
  ]);
  return results.some(Boolean);
}

async function waitFor(check, { label, timeoutMs = 60000, everyMs = 250 }) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await new Promise((r) => setTimeout(r, everyMs));
  }
  fail(`${label} did not come up within ${Math.round(timeoutMs / 1000)}s.`);
  return false;
}

/* ------------------------------------------------------------------ */
/* Children                                                            */
/* ------------------------------------------------------------------ */

const children = [];
let shuttingDown = false;

function launch(name, args, { cwd, env, colorise }) {
  const child = spawn(process.execPath, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  child.on("error", (err) => fail(`Could not start ${name}: ${err.message}`));
  pipeOutput(child, name, colorise);
  children.push({ name, child });
  return child;
}

/** Kills every child started by this run. Safe to call more than once. */
function stopChildren() {
  for (const { child } of children) killTree(child);
}

/** Kills a child and anything it spawned (Electron spawns its own binary). */
function killTree(child) {
  if (!child || child.exitCode !== null || child.signalCode) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
      stdio: "ignore",
    });
  } else {
    child.kill("SIGTERM");
  }
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  note("shutting down…");
  stopChildren();
  // Give the kills a moment to land before the process object goes away.
  setTimeout(() => process.exit(code), 250);
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => shutdown(0));
}

/* ------------------------------------------------------------------ */
/* Steps                                                               */
/* ------------------------------------------------------------------ */

const TOOLS = {
  tsx: path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs"),
  tsc: path.join(ROOT, "node_modules", "typescript", "bin", "tsc"),
  vite: path.join(CLIENT, "node_modules", "vite", "bin", "vite.js"),
  electron: path.join(CLIENT, "node_modules", "electron", "cli.js"),
};

function requireTool(key, hint) {
  if (!fs.existsSync(TOOLS[key])) {
    fail(`${key} is not installed in this checkout.`, hint);
  }
  return TOOLS[key];
}

const INSTALL_HINT = `Run \`pnpm install\` in ${ROOT}`;

async function startServer(options) {
  if (await hiveIsListening(options.apiPort)) {
    note(`reusing the server already on ${bold(String(options.apiPort))}`);
    return null;
  }
  if (await portInUse(options.apiPort)) {
    fail(
      `Port ${options.apiPort} is busy, and whatever holds it isn't a Hive server.`,
      `Free it with \`hive stop\`, or pick another port: \`hive --port 3005\``,
    );
  }

  const tsx = requireTool("tsx", INSTALL_HINT);
  const entry = path.join(ROOT, "packages", "server", "src", "index.ts");
  const child = launch("server", [tsx, entry], {
    // The server resolves hive.config.json and its storage against the
    // working directory, so this has to be the repo root.
    cwd: ROOT,
    env: { PORT: String(options.apiPort) },
    colorise: green,
  });

  child.on("exit", (code) => {
    if (shuttingDown) return;
    fail(`The server stopped (exit ${code}).`);
  });

  await waitFor(() => hiveIsListening(options.apiPort), {
    label: "The API server",
    timeoutMs: 45000,
  });
  note(`api    ${bold(`http://localhost:${options.apiPort}`)}`);
  return child;
}

async function startUi(options) {
  if (await portInUse(options.uiPort)) {
    note(`reusing the UI already on ${bold(String(options.uiPort))}`);
    return null;
  }

  const vite = requireTool("vite", INSTALL_HINT);
  const child = launch(
    "ui",
    [vite, "--port", String(options.uiPort), "--strictPort"],
    {
      cwd: CLIENT,
      // Lets `--port` actually mean something: the UI talks to whichever
      // API port this run chose.
      env: { VITE_API_BASE: `http://localhost:${options.apiPort}` },
      colorise: blue,
    },
  );

  child.on("exit", (code) => {
    if (shuttingDown) return;
    fail(`The UI dev server stopped (exit ${code}).`);
  });

  await waitFor(() => portInUse(options.uiPort), {
    label: "The UI dev server",
    timeoutMs: 60000,
  });
  note(`ui     ${bold(`http://localhost:${options.uiPort}`)}`);
  return child;
}

/** Electron runs compiled JS; rebuild only when the sources are newer. */
function buildElectronMain() {
  const sources = ["main.ts", "preload.ts"].map((f) =>
    path.join(CLIENT, "electron", f),
  );
  const outputs = ["main.js", "preload.js"].map((f) =>
    path.join(CLIENT, "electron", "dist", f),
  );

  const newest = (files) =>
    files.reduce((max, file) => {
      if (!fs.existsSync(file)) return Infinity;
      return Math.max(max, fs.statSync(file).mtimeMs);
    }, 0);

  if (newest(sources) <= newest(outputs)) return;

  const tsc = requireTool("tsc", INSTALL_HINT);
  note("compiling the desktop shell…");
  const result = spawnSync(
    process.execPath,
    [tsc, "-p", path.join(CLIENT, "electron", "tsconfig.json")],
    { cwd: CLIENT, stdio: "inherit" },
  );
  if (result.status !== 0) fail("Could not compile the Electron main process.");
}

function startWindow(options) {
  const electron = requireTool("electron", INSTALL_HINT);
  buildElectronMain();

  const child = launch("app", [electron, "."], {
    cwd: CLIENT,
    env: {
      NODE_ENV: "development",
      HIVE_API_BASE: `http://localhost:${options.apiPort}`,
      HIVE_UI_URL: `http://localhost:${options.uiPort}`,
      ...(options.devtools ? { HIVE_DEVTOOLS: "1" } : {}),
    },
    colorise: magenta,
  });

  // Closing the window is a deliberate "I'm done" — take the rest down too.
  child.on("exit", () => shutdown(0));
  return child;
}

/* ------------------------------------------------------------------ */
/* Commands                                                            */
/* ------------------------------------------------------------------ */

/** Ports Hive uses; `hive stop` frees them. */
function pidsOnPort(port) {
  const pids = new Set();
  if (process.platform === "win32") {
    const out =
      spawnSync("netstat", ["-ano"], { encoding: "utf8" }).stdout ?? "";
    for (const line of out.split(/\r?\n/)) {
      // proto | local address | foreign address | state | pid
      const parts = line.trim().split(/\s+/);
      if (parts.length < 5 || parts[3] !== "LISTENING") continue;
      if (!parts[1].endsWith(`:${port}`)) continue;
      const pid = parts[4];
      if (pid && pid !== "0") pids.add(pid);
    }
  } else {
    const out =
      spawnSync("lsof", ["-ti", `tcp:${port}`, "-sTCP:LISTEN"], {
        encoding: "utf8",
      }).stdout ?? "";
    for (const pid of out.split(/\s+/)) if (pid) pids.add(pid);
  }
  return [...pids];
}

function stopCommand(options) {
  // Both ports are scanned before anything is killed: a running `hive`
  // takes its own UI down the moment the server dies, so scanning port by
  // port would report only half of what it actually stopped.
  const targets = [];
  for (const port of [options.apiPort, options.uiPort]) {
    for (const pid of pidsOnPort(port)) targets.push({ pid, port });
  }

  let stopped = 0;
  for (const { pid, port } of targets) {
    const result =
      process.platform === "win32"
        ? spawnSync("taskkill", ["/pid", pid, "/t", "/f"], { stdio: "ignore" })
        : spawnSync("kill", ["-TERM", pid], { stdio: "ignore" });
    if (result.status === 0) {
      note(`stopped pid ${pid} on port ${port}`);
      stopped++;
    }
  }

  if (stopped === 0) note("nothing was listening on Hive's ports.");
}

/**
 * `hive doctor` — can this machine run Hive, and will it behave?
 *
 * Three tiers, because they cost wildly different amounts:
 *   1. the checkout   — node, deps, the tool entrypoints we spawn
 *   2. the outside    — git, pnpm, the harness CLIs, the ports
 *   3. `--deep`       — a real prompt per CLI, verifying its event stream
 *                       still parses (see harnesses/health.ts)
 *
 * Every failure prints what to do about it. A check that cannot be run is
 * reported as unknown rather than as a pass.
 */

const CHECK_MARKS = { ok: "ok  ", warn: "warn", miss: "miss", info: "info" };

function reportLine(state, label, detail) {
  const paintState =
    state === "ok"
      ? green
      : state === "miss"
        ? red
        : state === "warn"
          ? yellow
          : dim;
  console.log(
    `  ${paintState(CHECK_MARKS[state])} ${bold(String(label).padEnd(12))} ${dim(detail)}`,
  );
}

/** `<cmd> --version`, cross-platform, without a shell. */
function probeVersion(command) {
  try {
    // Windows resolves the .cmd/.ps1 shims npm installs only through a
    // shell, so the command goes as one string — passing an args array
    // alongside shell:true is deprecated (DEP0190) and unescaped.
    const onWindows = process.platform === "win32";
    const proc = onWindows
      ? spawnSync(`${command} --version`, {
          timeout: 5000,
          encoding: "utf8",
          shell: true,
        })
      : spawnSync(command, ["--version"], { timeout: 5000, encoding: "utf8" });
    if (proc.status !== 0) return null;
    const text = `${proc.stdout || ""}${proc.stderr || ""}`.trim();
    return text.split(/\r?\n/)[0] || "installed";
  } catch {
    return null;
  }
}

async function doctorCommand(options) {
  const report = { checks: [], deep: null, ok: true };
  const add = (state, label, detail, hint) => {
    report.checks.push({ state, label, detail, hint: hint ?? null });
    if (state === "miss") report.ok = false;
  };

  /* 1. the checkout */
  const pkgPath = path.join(ROOT, "package.json");
  add(
    fs.existsSync(pkgPath) ? "ok" : "miss",
    "repo",
    ROOT,
    "hive must be run from its own checkout — reinstall with install.sh.",
  );
  const major = Number(process.versions.node.split(".")[0]);
  add(
    major >= 20 ? "ok" : "miss",
    "node",
    `${process.version} (need >= 20)`,
    "Install Node 20 or newer: https://nodejs.org",
  );
  add(
    fs.existsSync(path.join(ROOT, "node_modules")) ? "ok" : "miss",
    "deps",
    path.join(ROOT, "node_modules"),
    "Run `pnpm install` in the checkout.",
  );
  for (const key of ["tsx", "vite", "electron"]) {
    add(
      fs.existsSync(TOOLS[key]) ? "ok" : "miss",
      key,
      TOOLS[key],
      "Run `pnpm install` — this entrypoint ships with the workspace deps.",
    );
  }

  /* 2. the outside world */
  const git = probeVersion("git");
  add(
    git ? "ok" : "miss",
    "git",
    git ?? "not found on PATH",
    "Harnesses run against a git working tree; changed files are read from git.",
  );
  const pnpm = probeVersion("pnpm");
  add(
    pnpm ? "ok" : "warn",
    "pnpm",
    pnpm ?? "not found on PATH (only needed to install)",
    "npm i -g pnpm",
  );

  const clis = [
    { name: "opencode", command: "opencode" },
    { name: "claude", command: "claude" },
    { name: "pi", command: "pi" },
  ];
  const installed = [];
  const harnessRows = [];
  for (const cli of clis) {
    const version = probeVersion(cli.command);
    if (version) installed.push(cli.name);
    const row = {
      state: version ? "ok" : "warn",
      label: cli.name,
      detail: version ?? "not installed (optional)",
      hint: null,
    };
    report.checks.push(row);
    harnessRows.push(row);
  }

  /* config + local model servers */
  const configPath = path.join(ROOT, "hive.config.json");
  const hasConfig = fs.existsSync(configPath);
  let configValid = true;
  if (hasConfig) {
    try {
      JSON.parse(fs.readFileSync(configPath, "utf8"));
    } catch (err) {
      configValid = false;
      add(
        "miss",
        "config",
        `${configPath} is not valid JSON: ${err.message}`,
        "Fix or delete it — Hive recreates a default on the next start.",
      );
    }
  }
  if (configValid) {
    add(
      hasConfig ? "ok" : "info",
      "config",
      hasConfig ? configPath : "using defaults (created on first start)",
    );
  }

  const [api, ui, ollama, lmstudio] = await Promise.all([
    hiveIsListening(options.apiPort),
    portInUse(options.uiPort),
    get("http://localhost:11434/api/tags")
      .then((c) => c === 200)
      .catch(() => false),
    get("http://localhost:1234/v1/models")
      .then((c) => c === 200)
      .catch(() => false),
  ]);
  add(
    "info",
    "ports",
    `api ${options.apiPort}: ${api ? "hive running" : "free"} · ui ${options.uiPort}: ${ui ? "in use" : "free"}`,
    ui && !api
      ? "Something else holds the UI port — `hive stop` or --ui-port."
      : undefined,
  );
  add(
    "info",
    "local models",
    `ollama: ${ollama ? "up" : "not running"} · lm studio: ${lmstudio ? "up" : "not running"}`,
  );

  /* print tiers 1 and 2, harnesses in their own block */
  for (const check of report.checks) {
    if (harnessRows.includes(check)) continue;
    reportLine(check.state, check.label, check.detail);
  }
  console.log(`  ${dim("--")}   ${bold("CLI harnesses")}`);
  for (const row of harnessRows) {
    reportLine(row.state, row.label, row.detail);
  }

  if (installed.length === 0) {
    report.ok = false;
    console.log("");
    console.error(
      `  ${red("miss")} ${bold("harnesses".padEnd(12))} ${dim("no agent CLI found on PATH")}`,
    );
    console.error(
      `       ${dim("Hive drives other CLIs; install at least one:")}`,
    );
    console.error(
      `       ${dim("claude   → npm i -g @anthropic-ai/claude-code")}`,
    );
    console.error(`       ${dim("opencode → npm i -g opencode-ai")}`);
  }

  /* 3. the deep check */
  let deepFailed = false;
  if (options.deep) {
    console.log("");
    note("running one real prompt per installed CLI — this costs tokens…");
    report.deep = await runDeepProbe();
    if (report.deep?.probes) {
      for (const probe of report.deep.probes) {
        if (!probe.installed) {
          reportLine("info", probe.harness, "not installed — skipped");
          continue;
        }
        if (probe.streamOk) {
          reportLine(
            "ok",
            probe.harness,
            `event stream parses (${probe.eventsParsed} events)`,
          );
        } else {
          report.ok = false;
          deepFailed = true;
          reportLine(
            "miss",
            probe.harness,
            probe.error ?? "stream did not parse",
          );
          // A timeout and a format change are different problems and need
          // different advice.
          console.error(
            /did not answer/.test(probe.error ?? "")
              ? `       ${dim("The CLI is installed but not answering — check its auth/login and that it runs on its own.")}`
              : `       ${dim("Its output format may have changed. packages/server/src/harnesses/eventStream.ts is what parses it.")}`,
          );
        }
      }
    } else {
      reportLine("warn", "deep", report.deep?.error ?? "probe could not run");
    }
  }

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  }

  if (!report.ok) {
    for (const check of report.checks) {
      if (check.state === "miss" && check.hint) {
        console.error(`       ${dim(check.hint)}`);
      }
    }
    console.error("");
    // The install hint is about this checkout; a harness that failed its
    // deep probe is not fixed by reinstalling Hive.
    fail(
      "Some checks did not pass.",
      deepFailed && report.checks.every((c) => c.state !== "miss")
        ? "Re-run `hive doctor --deep` after fixing the CLI above."
        : INSTALL_HINT,
    );
  }

  console.log("");
  if (!hasConfig) {
    note("first run — Hive writes a default hive.config.json when it starts.");
    console.log(
      `  ${dim("Run")} ${bold("hive")} ${dim("for the desktop app, or")} ${bold("hive web")} ${dim("for the browser.")}`,
    );
  } else {
    note("ready — run `hive` to start everything.");
  }
  if (!options.deep) {
    console.log(
      `  ${dim("Tip:")} ${bold("hive doctor --deep")} ${dim("also checks each CLI still emits the event stream Hive parses.")}`,
    );
  }
}

/** Runs the TypeScript deep probe under tsx and reads its JSON report. */
function runDeepProbe() {
  return new Promise((resolve) => {
    if (!fs.existsSync(TOOLS.tsx)) {
      resolve({ error: "tsx is not installed — run `pnpm install`." });
      return;
    }
    const script = path.join(
      ROOT,
      "packages",
      "server",
      "src",
      "scripts",
      "doctorProbe.ts",
    );
    const child = spawn(process.execPath, [TOOLS.tsx, script], {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (c) => (out += c.toString()));
    child.stderr.on("data", (c) => (err += c.toString()));
    child.on("error", (e) => resolve({ error: e.message }));
    child.on("close", () => {
      // The probe prints one JSON object last; anything tsx logged before it
      // is noise.
      const line = out.trim().split(/\r?\n/).filter(Boolean).pop();
      try {
        resolve(JSON.parse(line));
      } catch {
        resolve({
          error: err.trim().slice(0, 300) || "probe produced no report",
        });
      }
    });
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.mode === "stop") return stopCommand(options);
  if (options.mode === "doctor") return await doctorCommand(options);

  if (!fs.existsSync(path.join(ROOT, "node_modules"))) {
    fail("Dependencies are not installed.", INSTALL_HINT);
  }

  note(`starting from ${dim(ROOT)}`);
  await startServer(options);

  if (options.mode === "server") {
    note("server only — Ctrl+C to stop.");
    return;
  }

  await startUi(options);

  if (options.mode === "web") {
    note(
      `open ${bold(`http://localhost:${options.uiPort}`)} — Ctrl+C to stop.`,
    );
    return;
  }

  startWindow(options);
}

main().catch((err) => {
  fail(err instanceof Error ? err.message : String(err));
});
