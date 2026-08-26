import os from "os";

/**
 * How much work this machine can actually run at once.
 *
 * A harness is a whole CLI process driving a model — each one costs a core
 * and a few hundred megabytes, so "how many agents at once" is a property of
 * the machine, not a number that should be the same on a laptop and a
 * workstation. `loop.maxConcurrentAgents` still wins when it is set
 * explicitly; this is what "auto" resolves to, and what the Settings screen
 * shows as the recommendation.
 */

export interface SystemCapacity {
  cpus: number;
  totalMemMb: number;
  freeMemMb: number;
  platform: string;
  /** Agents this machine can comfortably run at once. */
  recommendedAgents: number;
}

/** Each agent is one CLI process plus its model client. */
const MEM_PER_AGENT_MB = 768;

export function detectSystemCapacity(): SystemCapacity {
  const cpus = Math.max(1, os.cpus()?.length ?? 1);
  const totalMemMb = Math.round(os.totalmem() / (1024 * 1024));
  const freeMemMb = Math.round(os.freemem() / (1024 * 1024));

  // Leave a core for the server, the UI and the machine's owner.
  const byCpu = Math.max(1, cpus - 1);
  // Budget against half of total memory rather than what happens to be free
  // right now, so the limit doesn't swing with whatever else is open.
  const byMemory = Math.max(1, Math.floor(totalMemMb / 2 / MEM_PER_AGENT_MB));

  return {
    cpus,
    totalMemMb,
    freeMemMb,
    platform: os.platform(),
    // Past a handful, the bottleneck stops being this machine and starts
    // being the provider's rate limit.
    recommendedAgents: Math.min(8, Math.min(byCpu, byMemory)),
  };
}

/**
 * The limit to actually enforce. `configured` of 0 (or anything below 1)
 * means "decide for me".
 */
export function effectiveAgentLimit(configured: number | undefined): number {
  if (typeof configured === "number" && configured >= 1) {
    return Math.floor(configured);
  }
  return detectSystemCapacity().recommendedAgents;
}
