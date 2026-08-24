import { spawn } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { ProviderId } from "../config";

/**
 * Single sign-on for providers, as it actually works on a developer's own
 * machine.
 *
 * Hive never sees a browser: it drives CLI harnesses, and those CLIs
 * already own an OAuth flow of their own — `claude` signs in with a Claude
 * subscription, `opencode auth login` signs in to whatever provider it
 * supports. When a harness holds a credential, Hive needs no API key for
 * that provider at all.
 *
 * So "SSO" here means: delegate the login to the CLI that owns it, and
 * report whether that CLI is currently signed in. That is a real, checkable
 * state — a file on disk — not a claim. Providers with no such CLI path
 * report `supported: false` so the UI can say so instead of offering a
 * button that cannot work.
 */

export type AuthMode = "api-key" | "sso";

interface SsoProvider {
  /** The CLI that owns the credential, shown in the UI. */
  cli: string;
  /** Human description of what signing in gets you. */
  description: string;
  /** Argv for the interactive login, run in a terminal of its own. */
  loginArgs: string[];
  /** Argv for signing out, or null when the CLI has no such command. */
  logoutArgs: string[] | null;
  /**
   * Candidate credential locations, first match wins. Absolute paths, or
   * relative to the home directory.
   */
  credentialPaths: string[];
  /** Extra check: an env var that also counts as signed in. */
  envVars?: string[];
}

/*
  Paths are the CLIs' documented credential stores. More than one is listed
  per CLI because they have moved between releases and differ by platform —
  a missing file is not evidence of being signed out if the CLI keeps it
  somewhere else.
*/
const SSO_PROVIDERS: Partial<Record<ProviderId, SsoProvider>> = {
  anthropic: {
    cli: "claude",
    description:
      "Sign in with your Claude account. Claude Code holds the credential, so Hive needs no Anthropic API key.",
    loginArgs: ["/login"],
    logoutArgs: ["/logout"],
    credentialPaths: [
      ".claude/.credentials.json",
      ".config/claude/.credentials.json",
    ],
    envVars: ["CLAUDE_CODE_OAUTH_TOKEN"],
  },
  openai: {
    cli: "opencode",
    description:
      "Sign in through opencode, which brokers OpenAI credentials for the harnesses that use it.",
    loginArgs: ["auth", "login"],
    logoutArgs: ["auth", "logout"],
    credentialPaths: [
      ".local/share/opencode/auth.json",
      "AppData/Local/opencode/auth.json",
    ],
  },
  openrouter: {
    cli: "opencode",
    description:
      "Sign in through opencode, which stores the OpenRouter credential for you.",
    loginArgs: ["auth", "login"],
    logoutArgs: ["auth", "logout"],
    credentialPaths: [
      ".local/share/opencode/auth.json",
      "AppData/Local/opencode/auth.json",
    ],
  },
  google: {
    cli: "opencode",
    description:
      "Sign in through opencode, which stores the Google credential for you.",
    loginArgs: ["auth", "login"],
    logoutArgs: ["auth", "logout"],
    credentialPaths: [
      ".local/share/opencode/auth.json",
      "AppData/Local/opencode/auth.json",
    ],
  },
};

export interface SsoStatus {
  /** False for providers with no CLI that can hold a credential. */
  supported: boolean;
  signedIn: boolean;
  /** The CLI that owns the login, when there is one. */
  cli: string | null;
  description: string | null;
  /** Where the credential was found, or why it wasn't. */
  detail: string;
  /** The exact command to run by hand, for anyone who prefers to. */
  command: string | null;
}

function resolveCredential(provider: SsoProvider): string | null {
  const home = os.homedir();
  for (const candidate of provider.credentialPaths) {
    const full = path.isAbsolute(candidate)
      ? candidate
      : path.join(home, candidate);
    try {
      if (fs.existsSync(full) && fs.statSync(full).size > 0) return full;
    } catch {
      // Unreadable is indistinguishable from absent for our purposes.
    }
  }
  return null;
}

export function ssoStatus(id: ProviderId): SsoStatus {
  const provider = SSO_PROVIDERS[id];
  if (!provider) {
    return {
      supported: false,
      signedIn: false,
      cli: null,
      description: null,
      detail:
        "No CLI on this machine can hold a credential for this provider. Use an API key instead.",
      command: null,
    };
  }

  const command = `${provider.cli} ${provider.loginArgs.join(" ")}`;
  const fromEnv = provider.envVars?.find((name) => process.env[name]);
  if (fromEnv) {
    return {
      supported: true,
      signedIn: true,
      cli: provider.cli,
      description: provider.description,
      detail: `Signed in via the ${fromEnv} environment variable.`,
      command,
    };
  }

  const credential = resolveCredential(provider);
  return {
    supported: true,
    signedIn: credential !== null,
    cli: provider.cli,
    description: provider.description,
    detail: credential
      ? `${provider.cli} is signed in (credential at ${credential}).`
      : `${provider.cli} is not signed in yet.`,
    command,
  };
}

export interface SsoLoginResult {
  started: boolean;
  message: string;
  /** Always returned, so the user can run it themselves if the spawn fails. */
  command: string | null;
}

/**
 * Opens the CLI's own login flow in a terminal window.
 *
 * These flows are interactive — they print a URL, wait for a paste, or take
 * over the terminal — so they cannot be run headlessly and scraped. Hive
 * launches one in a window of its own and then polls `ssoStatus`, which is
 * the only part of the outcome it can verify.
 */
export function startSso(id: ProviderId): SsoLoginResult {
  const provider = SSO_PROVIDERS[id];
  if (!provider) {
    return {
      started: false,
      message: "This provider has no CLI sign-in on this machine.",
      command: null,
    };
  }

  const command = `${provider.cli} ${provider.loginArgs.join(" ")}`;

  try {
    const child = openInTerminal(provider.cli, provider.loginArgs);
    child.unref();
    return {
      started: true,
      message: `Opened a terminal running \`${command}\`. Finish signing in there, then check the status here.`,
      command,
    };
  } catch (err) {
    return {
      started: false,
      message: `Could not open a terminal: ${
        err instanceof Error ? err.message : String(err)
      }. Run \`${command}\` yourself, then check the status here.`,
      command,
    };
  }
}

export function signOutSso(id: ProviderId): SsoLoginResult {
  const provider = SSO_PROVIDERS[id];
  if (!provider?.logoutArgs) {
    return {
      started: false,
      message: "This CLI has no sign-out command.",
      command: null,
    };
  }

  const command = `${provider.cli} ${provider.logoutArgs.join(" ")}`;
  try {
    const child = openInTerminal(provider.cli, provider.logoutArgs);
    child.unref();
    return {
      started: true,
      message: `Opened a terminal running \`${command}\`.`,
      command,
    };
  } catch (err) {
    return {
      started: false,
      message: `Could not open a terminal: ${
        err instanceof Error ? err.message : String(err)
      }. Run \`${command}\` yourself.`,
      command,
    };
  }
}

/**
 * Launches a command in a *visible* terminal, detached from the server.
 *
 * A plain `spawn` would give the CLI no tty, and every one of these flows
 * needs one. Each platform has exactly one dependable way to get a new
 * window, so they are spelled out rather than abstracted.
 */
function openInTerminal(cli: string, args: string[]) {
  const quoted = [cli, ...args].join(" ");

  if (process.platform === "win32") {
    // `start` is a cmd builtin, so it has to run through cmd itself. The
    // empty "" is the window title `start` otherwise eats from the command.
    return spawn("cmd.exe", ["/c", "start", "", "cmd.exe", "/k", quoted], {
      detached: true,
      stdio: "ignore",
      windowsHide: false,
    });
  }

  if (process.platform === "darwin") {
    return spawn(
      "osascript",
      [
        "-e",
        `tell application "Terminal" to do script "${quoted.replace(/"/g, '\\"')}"`,
        "-e",
        'tell application "Terminal" to activate',
      ],
      { detached: true, stdio: "ignore" },
    );
  }

  // Linux: try the terminals in turn via a shell, since which one exists
  // varies by desktop and there is no portable equivalent of `start`.
  const script = [
    "x-terminal-emulator",
    "gnome-terminal",
    "konsole",
    "xfce4-terminal",
    "xterm",
  ]
    .map((term) => `command -v ${term} >/dev/null 2>&1 && exec ${term} -e ${JSON.stringify(quoted)}`)
    .join(" || ");

  return spawn("sh", ["-c", `${script} || exit 1`], {
    detached: true,
    stdio: "ignore",
  });
}
