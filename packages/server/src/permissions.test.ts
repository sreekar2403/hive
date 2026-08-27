import { describe, it, expect, beforeEach } from "vitest";
import { PermissionManager } from "./permissions";
import { createDefaultConfig } from "./config";

describe("PermissionManager", () => {
  let permissionManager: PermissionManager;
  const config = createDefaultConfig();

  beforeEach(() => {
    permissionManager = new PermissionManager(config);
  });

  describe("permission detection", () => {
    it("detects destructive actions", () => {
      const destructiveActions = [
        "rm -rf /tmp",
        "git push --force",
        "git reset --hard",
        "delete important_file.txt",
        "clean build artifacts",
      ];

      destructiveActions.forEach((action) => {
        expect(permissionManager.isDestructive(action)).toBe(true);
      });
    });

    it("allows safe actions", () => {
      const safeActions = [
        "echo hello",
        "list files",
        "npm install",
        "run tests",
        "read file.txt",
      ];

      safeActions.forEach((action) => {
        expect(permissionManager.isDestructive(action)).toBe(false);
      });
    });

    it("detects all configured destructive patterns", () => {
      const patterns = config.permission.destructiveActions;
      patterns.forEach((pattern) => {
        const action = `some command ${pattern} more`;
        expect(permissionManager.isDestructive(action)).toBe(true);
      });
    });

    it("does not fire on words that merely contain a pattern", () => {
      // "rm" used to match "confirm"/"platform"/"perform", so ordinary
      // prompts stalled on the approval gate.
      const ordinaryPrompts = [
        "add a settings toggle for dark mode on the platform",
        "please confirm the button styling looks right",
        "improve performance of the dashboard",
        "render the uniform grid",
        "document the cleanup story",
        "prunes are not a git command",
      ];

      ordinaryPrompts.forEach((prompt) => {
        expect(permissionManager.isDestructive(prompt)).toBe(false);
      });
    });

    it("still matches flag-shaped patterns", () => {
      expect(permissionManager.isDestructive("git push -f origin main")).toBe(
        true,
      );
      expect(permissionManager.isDestructive("git push --force")).toBe(true);
      expect(permissionManager.isDestructive("rm -rf node_modules")).toBe(true);
    });

    it("reports which patterns matched", () => {
      expect(permissionManager.matchDestructive("git reset --hard")).toEqual([
        "reset",
      ]);
      expect(permissionManager.matchDestructive("npm install")).toEqual([]);
    });

    it("is case insensitive", () => {
      expect(permissionManager.isDestructive("RM -RF file")).toBe(true);
      expect(permissionManager.isDestructive("DELETE file")).toBe(true);
      expect(permissionManager.isDestructive("GIT PUSH --FORCE")).toBe(true);
    });
  });

  describe("permission request lifecycle", () => {
    it("checks permission for safe actions", () => {
      const result = permissionManager.checkPermission(
        "session-1",
        "echo hello",
        "safe operation",
      );

      expect(result).toBeInstanceOf(Promise);
    });

    it("tracks pending requests", async () => {
      const _permPromise = permissionManager.checkPermission(
        "session-test",
        "delete important_file.txt",
        "remove old file",
      );

      const pending = permissionManager.getPending();
      expect(pending.length).toBeGreaterThan(0);
      expect(pending[0].action).toContain("delete");
    });

    it("approves a pending request", async () => {
      const pending = permissionManager.getPending();
      if (pending.length > 0) {
        const result = permissionManager.approve(pending[0].id);
        expect(result).toBe(true);
      }
    });

    it("denies a pending request", async () => {
      const _permPromise = permissionManager.checkPermission(
        "session-deny",
        "push --force",
        "force push to main",
      );

      const pending = permissionManager.getPending();
      const latestRequest = pending[pending.length - 1];
      const result = permissionManager.deny(latestRequest.id, "User declined");
      expect(result).toBe(true);
    });

    it("clears pending requests after approval", async () => {
      const beforeCount = permissionManager.getPending().length;

      const _permPromise = permissionManager.checkPermission(
        "session-clear",
        "clean build",
        "remove build artifacts",
      );

      const pending = permissionManager.getPending();
      const requestToApprove = pending[pending.length - 1];
      permissionManager.approve(requestToApprove.id);

      const afterCount = permissionManager.getPending().length;
      expect(afterCount).toBeLessThanOrEqual(beforeCount);
    });
  });
});
