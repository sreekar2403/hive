import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  loadConfig,
  resetConfigCache,
  wasConfigLoadedFresh,
  harnessEnabled,
  createDefaultConfig,
} from "./config";

/**
 * `wasConfigLoadedFresh` is the seam that stops startup from re-enabling
 * every installed harness on every boot: bootstrap is for a config file
 * that does not exist yet, never for one the user has already written.
 */
describe("config load freshness", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "hive-config-"));
    resetConfigCache();
  });

  afterEach(() => {
    resetConfigCache();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("reports a fresh load when no config file exists", () => {
    loadConfig(path.join(dir, "hive.config.json"));

    expect(wasConfigLoadedFresh()).toBe(true);
  });

  it("reports an existing config file as not fresh", () => {
    const file = path.join(dir, "hive.config.json");
    fs.writeFileSync(file, JSON.stringify({ loop: { maxIterations: 7 } }));

    const config = loadConfig(file);

    expect(wasConfigLoadedFresh()).toBe(false);
    expect(config.loop.maxIterations).toBe(7);
  });

  it("resets to not-fresh with the cache", () => {
    loadConfig(path.join(dir, "hive.config.json"));
    expect(wasConfigLoadedFresh()).toBe(true);

    resetConfigCache();
    expect(wasConfigLoadedFresh()).toBe(false);
  });
});

describe("harnessEnabled", () => {
  it("treats an explicit enabled: false as off", () => {
    const config = createDefaultConfig();
    config.harnesses["claude-code"].enabled = false;

    expect(harnessEnabled(config, "claude-code")).toBe(false);
  });

  it("treats enabled: true as on", () => {
    const config = createDefaultConfig();
    config.harnesses["claude-code"].enabled = true;

    expect(harnessEnabled(config, "claude-code")).toBe(true);
  });

  it("treats a harness with no config block as on", () => {
    // The local-model direct harnesses are not in HARNESS_IDS and have no
    // switch to have been turned off.
    const config = createDefaultConfig();

    expect(harnessEnabled(config, "lmstudio-direct")).toBe(true);
  });
});
