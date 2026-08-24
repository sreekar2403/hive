import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { loadConfig } from "./config";
import { git, isGitRepo } from "./gitUtils";

/**
 * The general workspace: a project that is always present and belongs to
 * no repository in particular.
 *
 * Every other screen in Hive is scoped to a project, which used to mean
 * there was nowhere to ask a question that isn't about a repo — "how do I
 * write a cron expression", "summarise this error" — without first
 * attaching some unrelated folder and polluting its working tree. This
 * gives those questions a home: a real directory on disk that a harness
 * can be pointed at, owned by Hive rather than by the user's code.
 *
 * It is synthesised rather than stored in the `projects` table so that it
 * cannot be renamed away, deleted, or duplicated, and so a fresh install
 * has a usable chat before any project is added.
 */

export const GENERAL_PROJECT_ID = "__general__";

export function isGeneralProject(id: string | null | undefined): boolean {
  return id === GENERAL_PROJECT_ID;
}

/** Where the general workspace lives. Configurable; `~/.hive/workspace` by default. */
export function rootDirectory(): string {
  const configured = loadConfig().general.rootDirectory?.trim();
  if (configured) {
    return path.resolve(expandHome(configured));
  }
  return path.join(os.homedir(), ".hive", "workspace");
}

/** Expands a leading `~` so a hand-edited config can use one. */
function expandHome(input: string): string {
  if (input === "~") return os.homedir();
  if (input.startsWith("~/") || input.startsWith("~\\")) {
    return path.join(os.homedir(), input.slice(2));
  }
  return input;
}

/**
 * Creates the workspace on first use and makes it a git repository.
 *
 * The git init is not incidental: a harness's changed-file detection runs
 * `git diff`/`git status` against its cwd, so without a repository here
 * every general-workspace answer would report zero files changed even
 * when the agent wrote one.
 */
export function ensureRootDirectory(): string {
  const dir = rootDirectory();
  try {
    fs.mkdirSync(dir, { recursive: true });

    if (!isGitRepo(dir)) {
      git("git init", dir);
      git('git commit --allow-empty -m "Hive general workspace" --no-gpg-sign', dir);
    }

    const readme = path.join(dir, "README.md");
    if (!fs.existsSync(readme)) {
      fs.writeFileSync(readme, GENERAL_README, "utf8");
    }
  } catch {
    // A read-only home directory shouldn't take the server down; the
    // workspace simply reports itself as missing in the projects list.
  }
  return dir;
}

const GENERAL_README = `# Hive general workspace

Scratch space for work that isn't about any particular repository.

Chats started here run with this folder as their working directory, so an
agent can write notes, sketch a script, or try something out without
touching your projects. Nothing here is required — delete anything you
don't want.
`;

/** The general workspace shaped like a row from the projects table. */
export function generalProject() {
  const dir = ensureRootDirectory();
  const exists = fs.existsSync(dir);
  return {
    id: GENERAL_PROJECT_ID,
    name: "General",
    path: dir,
    color: "#8b8ef0",
    created_at: 0,
    updated_at: 0,
    exists,
    isGitRepo: exists ? isGitRepo(dir) : false,
    branch: exists ? "main" : null,
    /** Marks it as synthesised: the UI hides rename/remove for it. */
    virtual: true as const,
  };
}
