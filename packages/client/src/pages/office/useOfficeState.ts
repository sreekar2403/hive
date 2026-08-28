import { useEffect, useState } from "react";
import { API, subscribeToEvents } from "../../lib/api";
import type { AgentSnapshot } from "./types";

/**
 * Live roster for the Office floor. Driven by the SSE stream so a phase
 * change moves a character immediately, with a slow poll as a safety net
 * in case the stream drops.
 */
export function useOfficeState() {
  const [agents, setAgents] = useState<AgentSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const data = await API.get<{ agents: AgentSnapshot[] }>("/api/agents");
        if (cancelled) return;
        setAgents(data.agents);
        setError(null);
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Could not reach the swarm",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    const interval = setInterval(load, 8000);

    const unsubscribe = subscribeToEvents((type) => {
      if (
        type === "agent:update" ||
        type === "task:started" ||
        type === "task:completed" ||
        type === "task:failed"
      ) {
        void load();
      }
    });

    return () => {
      cancelled = true;
      clearInterval(interval);
      unsubscribe();
    };
  }, []);

  return { agents, loading, error };
}
