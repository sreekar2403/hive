import { useEffect, useState } from "react";
import { RefreshCw, Wand2 } from "lucide-react";
import { API } from "../../lib/api";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Field,
  Input,
  StatusDot,
  Switch,
} from "../../components/ui";
import {
  HARNESS_IDS,
  HARNESS_LABELS,
  harnessConfigOr,
  type HarnessId,
  type HarnessProbe,
  type SettingsConfig,
} from "./types";

/**
 * The CLI agents Hive drives. Availability is probed live against the
 * server rather than assumed from config, so a wrong path shows up here
 * instead of failing at task time.
 */
export function HarnessesSection({
  draft,
  onChange,
}: {
  draft: SettingsConfig;
  onChange: (updater: (prev: SettingsConfig) => SettingsConfig) => void;
}) {
  const [probes, setProbes] = useState<HarnessProbe[] | null>(null);
  const [probing, setProbing] = useState(false);
  const [resetting, setResetting] = useState(false);

  /**
   * Puts the first-run question back. The dialog is mounted above the router
   * and checks on load, so the page is reloaded rather than the dialog being
   * summoned directly — one code path for "setup is needed", not two.
   */
  const rerunSetup = async () => {
    setResetting(true);
    try {
      await API.post("/api/setup/reset", {});
      window.location.reload();
    } catch {
      setResetting(false);
    }
  };

  const probe = async () => {
    setProbing(true);
    try {
      const data = await API.get<{ harnesses: HarnessProbe[] }>(
        "/api/settings/harnesses",
      );
      setProbes(data.harnesses);
    } catch {
      setProbes([]);
    } finally {
      setProbing(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void probe();
  }, []);

  const set = (id: HarnessId, patch: Partial<SettingsConfig["harnesses"][HarnessId]>) =>
    onChange((prev) => ({
      ...prev,
      harnesses: {
        ...prev.harnesses,
        [id]: { ...harnessConfigOr(prev.harnesses, id), ...patch },
      },
    }));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-[13px] text-muted max-w-[62ch]">
          Hive runs work by driving these command-line agents. A harness has to be
          installed and on your PATH before it can pick up tasks.
        </p>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={rerunSetup}
            disabled={resetting}
          >
            <Wand2 className="size-3.5" />
            {resetting ? "Restarting…" : "Re-run setup"}
          </Button>
          <Button size="sm" onClick={probe} disabled={probing}>
            <RefreshCw
              className={probing ? "size-3.5 animate-spin" : "size-3.5"}
            />
            {probing ? "Checking…" : "Re-check"}
          </Button>
        </div>
      </div>

      {HARNESS_IDS.map((id) => {
        const cfg = harnessConfigOr(draft.harnesses, id);
        const probeResult = probes?.find((p) => p.id === id);
        const available = probeResult?.available;

        return (
          <Card key={id}>
            <CardHeader
              eyebrow={id}
              title={HARNESS_LABELS[id]}
              actions={
                <div className="flex items-center gap-3">
                  {probes === null ? null : (
                    <span className="flex items-center gap-1.5 text-[12px] text-muted">
                      <StatusDot tone={available ? "ok" : "danger"} />
                      {available ? "Available" : "Not found"}
                    </span>
                  )}
                  {probeResult?.version ? (
                    <Badge>{probeResult.version}</Badge>
                  ) : null}
                  <Switch
                    checked={cfg.enabled}
                    onChange={(v) => set(id, { enabled: v })}
                    label={`Enable ${HARNESS_LABELS[id]}`}
                  />
                </div>
              }
            />
            <div className="p-4 grid grid-cols-2 gap-4">
              <Field
                label="Command"
                hint="Executable name or absolute path."
                className="col-span-2"
              >
                {(fid) => (
                  <Input
                    id={fid}
                    className="font-mono text-[12px]"
                    value={cfg.path}
                    onChange={(e) => set(id, { path: e.target.value })}
                  />
                )}
              </Field>
              <Field label="Default model">
                {(fid) => (
                  <Input
                    id={fid}
                    className="font-mono text-[12px]"
                    value={cfg.defaultModel}
                    onChange={(e) => set(id, { defaultModel: e.target.value })}
                    placeholder="claude-sonnet-4"
                  />
                )}
              </Field>
              <Field label="Runs at once" hint="Concurrent tasks for this harness.">
                {(fid) => (
                  <Input
                    id={fid}
                    type="number"
                    min={1}
                    max={16}
                    value={cfg.concurrency}
                    onChange={(e) =>
                      set(id, { concurrency: Math.max(1, Number(e.target.value) || 1) })
                    }
                  />
                )}
              </Field>
              <Field
                label="Extra arguments"
                hint="Space-separated, passed on every run."
                className="col-span-2"
              >
                {(fid) => (
                  <Input
                    id={fid}
                    className="font-mono text-[12px]"
                    value={cfg.args.join(" ")}
                    onChange={(e) =>
                      set(id, {
                        args: e.target.value.split(/\s+/).filter(Boolean),
                      })
                    }
                    placeholder="--no-color"
                  />
                )}
              </Field>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
