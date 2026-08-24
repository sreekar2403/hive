import { describe, it, expect } from "vitest";
import * as os from "os";
import * as path from "path";
import {
  GENERAL_PROJECT_ID,
  isGeneralProject,
  rootDirectory,
} from "./generalWorkspace";

describe("generalWorkspace", () => {
  describe("isGeneralProject", () => {
    it("recognises the synthesised id", () => {
      expect(isGeneralProject(GENERAL_PROJECT_ID)).toBe(true);
      expect(isGeneralProject("__general__")).toBe(true);
    });

    it("rejects everything else, including nullish ids", () => {
      expect(isGeneralProject("some-uuid")).toBe(false);
      expect(isGeneralProject("__GENERAL__")).toBe(false);
      expect(isGeneralProject("")).toBe(false);
      expect(isGeneralProject(null)).toBe(false);
      expect(isGeneralProject(undefined)).toBe(false);
    });
  });

  describe("rootDirectory", () => {
    // The repo's hive.config.json sets no general.rootDirectory, so the
    // default applies. If someone adds one there, this test is right to
    // fail: the default and the override are different behaviours.
    it("defaults to ~/.hive/workspace when unconfigured", () => {
      const dir = rootDirectory();
      expect(path.isAbsolute(dir)).toBe(true);
      expect(dir).toBe(path.join(os.homedir(), ".hive", "workspace"));
    });
  });
});
