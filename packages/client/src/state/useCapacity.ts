import { useEffect, useState } from "react";
import { API, subscribeToEvents } from "../lib/api";

/**
 * What this machine can run at once, and what it is running.
 *
 * Mirrors GET /api/capacity (packages/server/src/routes/capacity.ts).
 */
export interface CapacityInfo {
  system: {
    cpus: number;
    totalMemMb: number;
    freeMemMb: number;
    platform: string;
    recommendedAgents: number;
  };
  /** null when the limit is left to the machine. */
  configuredAgents: number | null;
  effectiveAgents: number;
  load: { running: number; queued: number; limit: number };
}

export function useCapacity(): CapacityInfo | null {
  const [capacity, setCapacity] = useState<CapacityInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      API.get<CapacityInfo>("/api/capacity")
        .then((c) => {
          if (!cancelled) setCapacity(c);
        })
        .catch(() => {
          // A server that isn't up yet just means no readout.
        });
    };
    load();

    // Load changes when work starts and stops, so follow those rather than
    // polling a number that is usually still.
    const unsubscribe = subscribeToEvents((type) => {
      if (
        type === "task:started" ||
        type === "task:completed" ||
        type === "task:failed"
      ) {
        load();
      }
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return capacity;
}
