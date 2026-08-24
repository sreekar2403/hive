import { useCallback, useEffect, useState } from "react";
import { API } from "../lib/api";

/**
 * The models this machine can actually run, as discovered by the server
 * (packages/server/src/models/catalog.ts).
 *
 * Discovery spawns three CLIs and probes two local servers, so the result
 * is fetched once per app session and shared: the Chat picker and the
 * Settings screen read the same copy, and only an explicit refresh pays
 * for it again.
 */

export interface ModelOption {
  id: string;
  provider: string;
  model: string;
  ref: string;
  contextLabel: string | null;
  thinking: boolean | null;
  harness: string;
}

export interface CatalogSource {
  id: string;
  kind: "harness" | "provider";
  label: string;
  ok: boolean;
  error: string | null;
  models: Array<Omit<ModelOption, "harness">>;
  checkedAt: number;
}

export interface Catalog {
  sources: CatalogSource[];
  options: ModelOption[];
  generatedAt: number;
}

const EMPTY: Catalog = { sources: [], options: [], generatedAt: 0 };

let shared: Catalog | null = null;
let inFlight: Promise<Catalog> | null = null;
const subscribers = new Set<(catalog: Catalog) => void>();

function publish(catalog: Catalog) {
  shared = catalog;
  for (const notify of subscribers) notify(catalog);
}

function load(force: boolean): Promise<Catalog> {
  if (!force && shared) return Promise.resolve(shared);
  if (inFlight && !force) return inFlight;

  inFlight = API.get<Catalog>(`/api/models${force ? "?refresh=1" : ""}`)
    .then((catalog) => {
      publish(catalog);
      return catalog;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

export function useModelCatalog() {
  const [catalog, setCatalog] = useState<Catalog>(() => shared ?? EMPTY);
  const [loading, setLoading] = useState(!shared);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    subscribers.add(setCatalog);
    return () => {
      subscribers.delete(setCatalog);
    };
  }, []);

  const refresh = useCallback(async (force = false) => {
    setLoading(true);
    setError(null);
    try {
      await load(force);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not list models");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (shared) return;
    // Fetching the catalog is exactly the external-system sync effects are
    // meant for; the setState happens in the promise callback.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh(false);
  }, [refresh]);

  return { catalog, loading, error, refresh };
}
