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

Options
  -p, --port <n>       API server port          ${dim(`(default ${DEFAULT_API_PORT})`)}
      --ui-port <n>    Vite dev server port     ${dim(`(default ${DEFAULT_UI_PORT})`)}
      --devtools       open DevTools with the window
      --no-window      same as ${bold("hive web")}
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

function doctorCommand(options) {
  const rows = [
    ["repo", ROOT, fs.existsSync(path.join(ROOT, "package.json"))],
    ["node", process.version, true],
    [
      "deps",
      path.join(ROOT, "node_modules"),
      fs.existsSync(path.join(ROOT, "node_modules")),
    ],
    ["tsx", TOOLS.tsx, fs.existsSync(TOOLS.tsx)],
    ["vite", TOOLS.vite, fs.existsSync(TOOLS.vite)],
    ["electron", TOOLS.electron, fs.existsSync(TOOLS.electron)],
  ];

  let ok = true;
  for (const [label, detail, present] of rows) {
    ok = ok && present;
    console.log(
      `  ${present ? green("ok  ") : red("miss")} ${bold(label.padEnd(9))} ${dim(detail)}`,
    );
  }

  Promise.all([
    hiveIsListening(options.apiPort),
    portInUse(options.uiPort),
  ]).then(([api, ui]) => {
    console.log(
      `  ${dim("--")}   ${bold("ports".padEnd(9))} ${dim(
        `api ${options.apiPort}: ${api ? "hive running" : "free"} · ui ${options.uiPort}: ${
          ui ? "in use" : "free"
        }`,
      )}`,
    );
    if (!ok) fail("Something is missing.", INSTALL_HINT);
    note("ready — run `hive` to start everything.");
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.mode === "stop") return stopCommand(options);
  if (options.mode === "doctor") return doctorCommand(options);

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
