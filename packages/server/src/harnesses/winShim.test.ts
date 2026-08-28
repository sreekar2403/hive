import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import spawn from "cross-spawn";
import { resolveWindowsShim, clearShimCache } from "./winShim";

const win = process.platform === "win32";
const onWin = win ? describe : describe.skip;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hive-shim-"));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

/** Runs a command and returns its last argument exactly as the child got it. */
function echoArg(
  command: string,
  args: string[],
): Promise<{ code: number | null; arg: string }> {
  return new Promise((resolve) => {
    const proc = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    proc.stdout?.on("data", (d) => (out += d.toString()));
    proc.stdin?.end();
    proc.on("error", () => resolve({ code: -1, arg: "" }));
    proc.on("close", (code) => {
      let arg = "";
      try {
        arg = JSON.parse(out.trim());
      } catch {
        /* left empty; the assertion reports it */
      }
      resolve({ code, arg });
    });
  });
}

const PRINT =
  "console.log(JSON.stringify(process.argv[process.argv.length - 1] ?? ''))";
const MULTILINE = "=== Context header ===\nsecond line\nthird line";

onWin("resolveWindowsShim", () => {
  beforeEach(() => clearShimCache());

  it("leaves a non-shim command untouched", () => {
    const resolved = resolveWindowsShim(process.execPath);
    expect(resolved).toEqual({ command: process.execPath, prefixArgs: [] });
  });

  it("resolves an npm exe shim to the executable it wraps", () => {
    const exe = path.join(tmp, "real.exe");
    fs.copyFileSync(process.execPath, exe);
    const shim = path.join(tmp, "toolexe.cmd");
    fs.writeFileSync(
      shim,
      ["@ECHO off", "SET dp0=%~dp0", String.raw`"%dp0%\real.exe"   %*`].join(
        "\r\n",
      ),
    );

    expect(resolveWindowsShim(shim)).toEqual({ command: exe, prefixArgs: [] });
  });

  it("resolves a node-script shim to node plus the script", () => {
    const script = path.join(tmp, "cli.js");
    fs.writeFileSync(script, PRINT);
    const shim = path.join(tmp, "toolnode.cmd");
    fs.writeFileSync(
      shim,
      [
        "@ECHO off",
        "SET dp0=%~dp0",
        String.raw`"node.exe"  "%dp0%\cli.js" %*`,
      ].join("\r\n"),
    );

    expect(resolveWindowsShim(shim)).toEqual({
      command: process.execPath,
      prefixArgs: [script],
    });
  });

  it("falls back to the shim when its target cannot be found", () => {
    const shim = path.join(tmp, "broken.cmd");
    fs.writeFileSync(shim, "@ECHO off\r\n%SOMETHING_ELSE% %*\r\n");
    expect(resolveWindowsShim(shim)).toEqual({ command: shim, prefixArgs: [] });
  });

  /* The regression itself: this is what broke every multi-line prompt. */
  it("a .cmd shim truncates a multi-line argument at its first newline", async () => {
    const script = path.join(tmp, "print.js");
    fs.writeFileSync(script, PRINT);
    const shim = path.join(tmp, "print.cmd");
    fs.writeFileSync(
      shim,
      [
        "@ECHO off",
        "SET dp0=%~dp0",
        String.raw`"node.exe" "%dp0%\print.js" %*`,
      ].join("\r\n"),
    );

    const direct = await echoArg(shim, [MULTILINE]);
    expect(direct.arg).toBe("=== Context header ===");
    expect(direct.arg).not.toBe(MULTILINE);
  });

  it("the resolved command delivers the whole multi-line argument", async () => {
    const script = path.join(tmp, "print2.js");
    fs.writeFileSync(script, PRINT);
    const shim = path.join(tmp, "print2.cmd");
    fs.writeFileSync(
      shim,
      [
        "@ECHO off",
        "SET dp0=%~dp0",
        String.raw`"node.exe" "%dp0%\print2.js" %*`,
      ].join("\r\n"),
    );

    const resolved = resolveWindowsShim(shim);
    const viaExe = await echoArg(resolved.command, [
      ...resolved.prefixArgs,
      MULTILINE,
    ]);
    expect(viaExe.arg).toBe(MULTILINE);
  });
});
