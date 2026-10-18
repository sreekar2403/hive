import { useCallback, useEffect, useState } from "react";
import { API } from "../../lib/api";
import type { ActivityStats } from "./heatmap";

/**
 * Loads /api/stats/activity for a scope. `projectId === null` means all
 * projects — the Dashboard's Project/All toggle flips that value and this
 * hook re-fetches.
 */
export function useActivityStats(
  projectId: string | null,
  enabled: boolean,
) {
  const [stats, setStats] = useState<ActivityStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!enabled) {
      setStats(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const qs =
        projectId != null
          ? `?projectId=${encodeURIComponent(projectId)}`
          : "";
      const data = await API.get<ActivityStats>(`/api/stats/activity${qs}`);
      setStats(data);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not load activity",
      );
      setStats(null);
    } finally {
      setLoading(false);
    }
  }, [projectId, enabled]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  return { stats, loading, error, reload: load };
}
