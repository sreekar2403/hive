import { useCallback, useEffect, useState } from "react";
import { API } from "../../lib/api";
import type { SettingsConfig } from "./types";

/**
 * Loads /api/settings and tracks an editable draft separately from the
 * last saved snapshot. There are no credentials in this payload — harness
 * CLIs hold their own — so a draft is safe to round-trip as-is.
 */
export function useSettings() {
  const [settings, setSettings] = useState<SettingsConfig | null>(null);
  const [draft, setDraft] = useState<SettingsConfig | null>(null);
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

  const dirty =
    settings !== null &&
    draft !== null &&
    JSON.stringify(settings) !== JSON.stringify(draft);

  /** Applies a patch to the draft without touching the last-saved snapshot. */
  const update = useCallback(
    (updater: (prev: SettingsConfig) => SettingsConfig) => {
      setDraft((prev) => (prev ? updater(prev) : prev));
    },
    [],
  );

  const discard = useCallback(() => {
    setDraft(settings);
  }, [settings]);

  const save = useCallback(async () => {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await API.put<SettingsConfig>("/api/settings", draft);
      setSettings(updated);
      setDraft(updated);
      setSavedAt(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save settings");
      throw err;
    } finally {
      setSaving(false);
    }
  }, [draft]);

  return {
    settings,
    draft,
    loading,
    error,
    saving,
    dirty,
    savedAt,
    update,
    discard,
    save,
    reload: load,
  };
}
