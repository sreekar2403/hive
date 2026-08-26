import {
  Config,
  HARNESS_IDS,
  HarnessId,
  loadConfig,
  saveConfig,
} from "./config";
import { checkInstalled } from "./harnesses/health";
import { harnessProfile } from "./harnesses/profiles";
import { getCatalog } from "./models/catalog";
import { SecondBrain, buildStarterSoul, suggestedRoutes } from "./secondBrain";
import { log } from "./telemetry";

/**
 * First run.
 *
 * Hive's behaviour depends on two things it cannot guess: which agent CLIs
 * this machine has, and which model the user is willing to spend on routing
 * decisions. The first is discoverable. The second is a preference, and
 * inferring a spending preference silently is exactly the kind of thing a
 * tool should ask about once rather than decide forever.
 *
 * So setup asks one question — which model routes? — and does everything
 * else from what it finds:
 *
 *   - probes all twelve CLIs and enables only the ones that answered
 *   - writes a soul.md seeded with those CLIs and opening routes
 *   - records the chosen router model in soul.md, where the user can edit it
 *
 * After that the Second Brain takes over: it observes which harness actually
 * finishes which category and proposes soul.md entries, which the user
 * approves. Setup is the cold start for a loop that then runs itself.
 */

export interface RouterModelCandidate {
  /** Catalog id, `harness/provider/model`. */
  id: string;
  harness: string;
  model: string;
  label: string;
  /** Why this one is being offered. */
  note: string;
  /** True for the one Hive would choose unprompted. */
  recommended: boolean;
}

export interface SetupStatus {
  /** Whether the first-run question still needs asking. */
  needed: boolean;
  reason: string;
  harnesses: Array<{
    id: string;
    label: string;
    command: string;
    installed: boolean;
    summary: string;
  }>;
  /** Models worth routing with, cheapest and fastest first. */
  routerCandidates: RouterModelCandidate[];
  /** The opening `category → harness` table setup would write. */
  suggestedRoutes: Array<{ category: string; harness: string }>;
  /** Where the global soul.md would be written. */
  soulPath: string;
  soulExists: boolean;
}

/**
 * Model families small and cheap enough to route with, best first.
 *
 * Routing is a classification run on every task, so the right model is the
 * cheapest one that can follow a short instruction — not the best one
 * available. Anything not matching here is still offered, just ranked below
 * these and never recommended.
 */
const ROUTER_PREFERENCES: Array<{ match: string; note: string }> = [
  // Notes describe the *tier*, not the vendor. These match on a substring of
  // the model id, and plenty of providers ship a "flash" or a "mini" — a note
  // reading "fast Gemini tier" beside a DeepSeek model is worse than no note.
  { match: "haiku", note: "small and fast — a good default" },
  { match: "flash-lite", note: "the cheapest tier its provider offers" },
  { match: "flash", note: "a fast, low-cost tier" },
  { match: "mini", note: "a small, low-cost tier" },
  { match: "nano", note: "the smallest tier its provider offers" },
  { match: "small", note: "a small model" },
  { match: "8b", note: "8B parameters — cheap, and free if it runs locally" },
  { match: "7b", note: "7B parameters — cheap, and free if it runs locally" },
  { match: "4b", note: "4B parameters — very small" },
  { match: "3b", note: "3B parameters — very small" },
];

/** How many models to offer. Long lists make a one-off question feel like work. */
const MAX_CANDIDATES = 12;

/** Bumped when setup starts asking something new. */
export const SETUP_VERSION = 1;

/**
 * Has the user been asked yet?
 *
 * Deliberately not a boolean flag on its own: a flag can be true while the
 * thing it claims was done is missing (a deleted soul.md, a config restored
 * from a backup). Setup is complete when the flag is set *and* the soul.md
 * it was supposed to write is actually there.
 */
export function isSetupComplete(config: Config, brain: SecondBrain): boolean {
  if (!config.setup?.completed) return false;
  try {
    return brain.soul.read("global").exists;
  } catch {
    return false;
  }
}

export async function getSetupStatus(
  config: Config,
  brain: SecondBrain,
): Promise<SetupStatus> {
  const probes = await checkInstalled(config);
  const installed = probes.filter((p) => p.installed).map((p) => p.harness);

  const soul = brain.soul.read("global");
  const complete = isSetupComplete(config, brain);

  return {
    needed: !complete,
    reason: complete
      ? "Setup has already run"
      : config.setup?.completed
        ? "Setup ran before, but soul.md is missing"
        : "Hive has not been set up on this machine yet",
    harnesses: HARNESS_IDS.map((id) => {
      const profile = harnessProfile(id);
      return {
        id,
        label: profile.label,
        command: config.harnesses[id]?.path || profile.command,
        installed: installed.includes(id),
        summary: profile.summary,
      };
    }),
    routerCandidates: await routerCandidates(installed),
    suggestedRoutes: suggestedRoutes(installed).map(([category, harness]) => ({
      category,
      harness,
    })),
    soulPath: soul.path,
    soulExists: soul.exists,
  };
}

/**
 * Models worth offering as the router.
 *
 * Only harnesses that are actually installed contribute, because offering a
 * model the machine cannot run turns the one setup question into a dead end.
 */
export async function routerCandidates(
  installed: string[],
): Promise<RouterModelCandidate[]> {
  let catalog;
  try {
    catalog = await getCatalog();
  } catch {
    return [];
  }

  const usable = catalog.options.filter((o) => installed.includes(o.harness));
  const scored = usable.map((option) => {
    const lower = option.model.toLowerCase();
    const rank = ROUTER_PREFERENCES.findIndex((p) => lower.includes(p.match));
    return {
      option,
      rank: rank === -1 ? ROUTER_PREFERENCES.length : rank,
      note:
        rank === -1
          ? "larger model — accurate, but you pay it on every task"
          : ROUTER_PREFERENCES[rank].note,
    };
  });

  scored.sort(
    (a, b) => a.rank - b.rank || a.option.id.localeCompare(b.option.id),
  );

  return scored
    .slice(0, MAX_CANDIDATES)
    .map(({ option, rank, note }, index) => ({
      id: option.id,
      harness: option.harness,
      model: option.model,
      label: `${harnessProfile(option.harness).label} · ${option.model}`,
      note,
      // Recommend the top-ranked entry only when it actually matched a small
      // family. If nothing small is installed, recommend nothing and let the
      // automatic setting stand — see pickRoutingModel in router.ts, which
      // declines rather than spending a frontier model on routing.
      recommended: index === 0 && rank < ROUTER_PREFERENCES.length,
    }));
}

export interface CompleteSetupInput {
  /** Catalog id to route with. Empty string means "decide automatically". */
  routerModel?: string;
  /**
   * Harnesses the user wants on. Omitted means "everything installed" —
   * the recommended answer, and the one the UI preselects.
   */
  enabledHarnesses?: string[];
  /** Overwrite an existing soul.md. Off by default; setup never clobbers. */
  overwriteSoul?: boolean;
}

export interface CompleteSetupResult {
  routerModel: string;
  enabled: string[];
  disabled: string[];
  soulPath: string;
  soulWritten: boolean;
}

/**
 * Applies the setup answers: reconciles which harnesses are on, writes the
 * starter soul.md, and marks setup done.
 *
 * The config write and the soul write are both idempotent, so re-running
 * setup (the user asked to redo it, or soul.md went missing) converges
 * rather than duplicating.
 */
export async function completeSetup(
  config: Config,
  brain: SecondBrain,
  input: CompleteSetupInput = {},
): Promise<CompleteSetupResult> {
  const probes = await checkInstalled(config);
  const installed = probes.filter((p) => p.installed).map((p) => p.harness);

  const wanted = input.enabledHarnesses ?? installed;
  const { enabled, disabled } = reconcileHarnesses(config, installed, wanted);

  const routerModel = input.routerModel?.trim() ?? "";
  config.routing.llm.model = routerModel;
  config.routing.llmModel = routerModel;

  config.setup = {
    completed: true,
    completedAt: Date.now(),
    version: SETUP_VERSION,
  };
  saveConfig(config);

  const soul = brain.soul.read("global");
  const soulWritten = !soul.exists || Boolean(input.overwriteSoul);
  if (soulWritten) {
    brain.soul.write(
      "global",
      buildStarterSoul({ scope: "global", harnesses: enabled, routerModel }),
    );
  }

  log(
    "info",
    "setup",
    `Setup complete: ${enabled.length} harness(es) enabled, routing with ${
      routerModel || "an automatically chosen model"
    }`,
  );

  return {
    routerModel,
    enabled,
    disabled,
    soulPath: soul.path,
    soulWritten,
  };
}

/**
 * Turns on the harnesses that are both installed and wanted, and turns off
 * everything else.
 *
 * The second half is the part that matters: a harness that is not installed
 * must not sit in the config as `enabled`. It would show up in the routing
 * table and the Settings switches as available for work, and the only way to
 * discover otherwise is a task failing at spawn time.
 */
export function reconcileHarnesses(
  config: Config,
  installed: string[],
  wanted: string[],
): { enabled: string[]; disabled: string[] } {
  const enabled: string[] = [];
  const disabled: string[] = [];

  for (const id of HARNESS_IDS) {
    const block = config.harnesses[id as HarnessId];
    if (!block) continue;
    const on = installed.includes(id) && wanted.includes(id);
    block.enabled = on;
    (on ? enabled : disabled).push(id);
  }

  return { enabled, disabled };
}

/**
 * Startup reconciliation, for every run after the first.
 *
 * A CLI can be uninstalled, or a config can be copied between machines. In
 * either case `enabled: true` for a binary that isn't there is a lie the
 * user has to debug. This corrects it on the way up and persists the
 * correction only when something actually changed, so a normal start does
 * not rewrite the config file for nothing.
 */
export function syncHarnessAvailability(
  config: Config,
  installed: string[],
  options: { enableInstalled?: boolean; persist?: boolean } = {},
): { disabled: string[]; enabled: string[] } {
  const disabled: string[] = [];
  const enabled: string[] = [];

  for (const id of HARNESS_IDS) {
    const block = config.harnesses[id as HarnessId];
    if (!block) continue;

    if (!installed.includes(id)) {
      if (block.enabled) {
        block.enabled = false;
        disabled.push(id);
      }
      continue;
    }

    // Before setup has run there is no user preference to respect, and
    // every harness now defaults to off — so without this, a fresh install
    // would have nothing to route to until the setup screen was answered.
    // After setup, an installed-but-off harness is a deliberate choice and
    // is left alone.
    if (options.enableInstalled && !block.enabled) {
      block.enabled = true;
      enabled.push(id);
    }
  }

  if (disabled.length > 0 || enabled.length > 0) {
    // Persisting is opt-in. This mutates the config object it is given, and
    // a function that also writes to disk cannot be called from a test — or
    // from a dry run — without clobbering the user's real hive.config.json.
    if (options.persist) saveConfig(config);
    if (disabled.length > 0) {
      log(
        "info",
        "setup",
        `Disabled ${disabled.join(", ")} — not installed on this machine`,
      );
    }
    if (enabled.length > 0) {
      log("info", "setup", `Enabled ${enabled.join(", ")} — found on PATH`);
    }
  }

  return { disabled, enabled };
}

/**
 * Seeds a project's own soul.md when it is first added.
 *
 * A project soul overrides the global one, so it starts almost empty on
 * purpose: repeating the machine-wide routes here would mean editing the
 * global file no longer changed anything for this project, which is the
 * opposite of how the two scopes are meant to compose.
 */
export function seedProjectSoul(
  config: Config,
  projectPath: string,
  projectName: string,
): { written: boolean; path: string } {
  const brain = new SecondBrain(config, projectPath);
  if (!brain.enabled) {
    return { written: false, path: brain.soul.read("project").path };
  }

  const existing = brain.soul.read("project");
  if (existing.exists) return { written: false, path: existing.path };

  brain.soul.write(
    "project",
    buildStarterSoul({
      scope: "project",
      // Intentionally empty: the global soul carries the routes, and this
      // file exists to record what is different about *this* repository.
      harnesses: [],
      routerModel: "",
      projectName,
    }),
  );

  return { written: true, path: existing.path };
}

/** Convenience for callers that only have the singleton config. */
export function currentSetupBrain(projectPath: string | null = null): {
  config: Config;
  brain: SecondBrain;
} {
  const config = loadConfig();
  return { config, brain: new SecondBrain(config, projectPath) };
}
