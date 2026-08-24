import { describe, it, expect, afterEach } from "vitest";
import { ssoStatus } from "./sso";

describe("ssoStatus", () => {
  const OAUTH_ENV = "CLAUDE_CODE_OAUTH_TOKEN";
  const savedEnv = process.env[OAUTH_ENV];

  afterEach(() => {
    if (savedEnv === undefined) delete process.env[OAUTH_ENV];
    else process.env[OAUTH_ENV] = savedEnv;
  });

  it("reports providers with no owning CLI as unsupported", () => {
    const status = ssoStatus("ollama");
    expect(status.supported).toBe(false);
    expect(status.signedIn).toBe(false);
    expect(status.cli).toBeNull();
    expect(status.command).toBeNull();
  });

  it("names the CLI that owns the credential and its login command", () => {
    const status = ssoStatus("anthropic");
    expect(status.supported).toBe(true);
    expect(status.cli).toBe("claude");
    expect(status.command).toBe("claude /login");
  });

  // Checked before the filesystem, so this branch is deterministic
  // regardless of what is on the machine running the test.
  it("counts a credential env var as signed in", () => {
    process.env[OAUTH_ENV] = "test-token";
    const status = ssoStatus("anthropic");
    expect(status.signedIn).toBe(true);
    expect(status.detail).toContain(OAUTH_ENV);
  });

  it("never claims sign-in for an unsupported provider even with env set", () => {
    process.env[OAUTH_ENV] = "test-token";
    const status = ssoStatus("lmstudio");
    expect(status.supported).toBe(false);
    expect(status.signedIn).toBe(false);
  });
});
