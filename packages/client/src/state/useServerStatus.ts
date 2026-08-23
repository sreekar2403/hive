import { useEffect, useState } from "react";
import { API, subscribeToEvents } from "../lib/api";

/**
 * Tracks whether the Hive server is reachable and how many tasks are
 * currently in flight, driven by the SSE stream with a polled fallback so
 * the indicator stays honest if the stream drops.
 */
export function useServerStatus() {
  const [online, setOnline] = useState(false);
  const [activeTasks, setActiveTasks] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const ping = async () => {
      try {
        await API.get("/health");
        if (!cancelled) setOnline(true);
      } catch {
        if (!cancelled) {
          setOnline(false);
          setActiveTasks(0);
        }
      }
    };

    void ping();
    const interval = setInterval(ping, 10000);

    const unsubscribe = subscribeToEvents((type) => {
      if (cancelled) return;
      setOnline(true);
      if (type === "task:started") setActiveTasks((n) => n + 1);
      if (type === "task:completed" || type === "task:failed") {
        setActiveTasks((n) => Math.max(0, n - 1));
      }
    });

    return () => {
      cancelled = true;
      clearInterval(interval);
      unsubscribe();
    };
  }, []);

  return { online, activeTasks };
}
