import { useCallback, useEffect, useMemo, useState } from "react";
import { API } from "../../lib/api";
import {
  PROVIDER_IDS,
  type AuthMode,
  type ProviderId,
  type SettingsConfig,
} from "./types";

/**
 * Loads /api/settings, tracks an editable draft separately from the last
 * saved snapshot, and knows how to turn that draft back into a PUT payload
 * — including freshly typed (never-yet-saved) provider API keys, which live
 * outside the draft since the server never sends the real key back.
 */
export function useSettings() {
  const [settings, setSettings] = useState<SettingsConfig | null>(null);
  const [draft, setDraft] = useState<SettingsConfig | null>(null);
  const [keyDrafts, setKeyDrafts] = useState<Partial<Record<ProviderId, string>>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await API.get<SettingsConfig>("/api/settings");
      setSettings(data);
      setDraft(data);
      setKeyDrafts({});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load settings");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const hasPendingKeys = useMemo(
    () => Object.values(keyDrafts).some((v) => v),
    [keyDrafts],
  );

  const dirty =
    settings !== null &&
    draft !== null &&
    (JSON.stringify(settings) !== JSON.stringify(draft) || hasPendingKeys);

  /** Applies a patch to the draft without touching the last-saved snapshot. */
  const update = useCallback((updater: (prev: SettingsConfig) => SettingsConfig) => {
    setDraft((prev) => (prev ? updater(prev) : prev));
  }, []);

  const setProviderKeyDraft = useCallback((id: ProviderId, value: string) => {
    setKeyDrafts((prev) => ({ ...prev, [id]: value }));
  }, []);

  const discard = useCallback(() => {
    setDraft(settings);
    setKeyDrafts({});
  }, [settings]);

  const save = useCallback(async () => {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      const providers: Record<
        string,
        { enabled: boolean; baseUrl: string; authMode: AuthMode; apiKey?: string }
      > = {};
      for (const id of PROVIDER_IDS) {
        providers[id] = {
          enabled: draft.providers[id].enabled,
          baseUrl: draft.providers[id].baseUrl,
          authMode: draft.providers[id].authMode ?? "api-key",
        };
        const newKey = keyDrafts[id];
        if (newKey) providers[id].apiKey = newKey;
      }

      const payload = {
        providers,
        harnesses: draft.harnesses,
        routing: draft.routing,
        permission: draft.permission,
        loop: draft.loop,
        storage: draft.storage,
        general: draft.general,
      };

      const updated = await API.put<SettingsConfig>("/api/settings", payload);
      setSettings(updated);
      setDraft(updated);
      setKeyDrafts({});
      setSavedAt(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save settings");
      throw err;
    } finally {
      setSaving(false);
    }
  }, [draft, keyDrafts]);

  return {
    settings,
    draft,
    keyDrafts,
    loading,
    error,
    saving,
    dirty,
    savedAt,
    update,
    setProviderKeyDraft,
    discard,
    save,
    reload: load,
  };
}
