import { useCallback, useState } from "react";
import {
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  LogIn,
  LogOut,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Field,
  Input,
  SegmentedControl,
  Switch,
} from "../../components/ui";
import { API } from "../../lib/api";
import {
  PROVIDER_IDS,
  PROVIDER_KEY_PLACEHOLDERS,
  PROVIDER_LABELS,
  type AuthMode,
  type ProviderId,
  type SettingsConfig,
  type SsoStatus,
} from "./types";

type TestState =
  | { status: "idle" }
  | { status: "testing" }
  | { status: "success"; message: string }
  | { status: "error"; message: string };

export function ProvidersSection({
  draft,
  keyDrafts,
  onChange,
  onKeyChange,
}: {
  draft: SettingsConfig;
  keyDrafts: Partial<Record<ProviderId, string>>;
  onChange: (updater: (prev: SettingsConfig) => SettingsConfig) => void;
  onKeyChange: (id: ProviderId, value: string) => void;
}) {
  const [revealed, setRevealed] = useState<Partial<Record<ProviderId, boolean>>>({});
  const [tests, setTests] = useState<Partial<Record<ProviderId, TestState>>>({});

  const patch = useCallback(
    (id: ProviderId, fields: Partial<SettingsConfig["providers"][ProviderId]>) => {
      onChange((prev) => ({
        ...prev,
        providers: {
          ...prev.providers,
          [id]: { ...prev.providers[id], ...fields },
        },
      }));
    },
    [onChange],
  );

  const testProvider = async (id: ProviderId) => {
    setTests((prev) => ({ ...prev, [id]: { status: "testing" } }));
    try {
      const result = await API.post<{ success: boolean; message: string }>(
        `/api/settings/providers/${id}/test`,
        { apiKey: keyDrafts[id] || undefined, baseUrl: draft.providers[id].baseUrl },
      );
      setTests((prev) => ({
        ...prev,
        [id]: result.success
          ? { status: "success", message: result.message }
          : { status: "error", message: result.message },
      }));
    } catch (err) {
      setTests((prev) => ({
        ...prev,
        [id]: {
          status: "error",
          message: err instanceof Error ? err.message : "Test failed",
        },
      }));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[13px] text-muted max-w-[62ch]">
        A provider can be reached with an API key, or by signing in — where a
        harness CLI already holds an OAuth credential, Hive uses that and needs
        no key at all.
      </p>

      {PROVIDER_IDS.map((id) => {
        const provider = draft.providers[id];
        const test = tests[id] ?? { status: "idle" };
        const isRevealed = revealed[id] ?? false;
        const keyValue = keyDrafts[id] ?? "";
        const mode: AuthMode = provider.authMode ?? "api-key";
        const ssoAvailable = provider.sso?.supported ?? false;

        return (
          <Card key={id}>
            <CardHeader
              eyebrow="Provider"
              title={PROVIDER_LABELS[id]}
              actions={
                <div className="flex items-center gap-3">
                  {/* Only offered where a CLI can actually hold a
                      credential — see auth/sso.ts. */}
                  {ssoAvailable ? (
                    <SegmentedControl<AuthMode>
                      value={mode}
                      onChange={(next) => patch(id, { authMode: next })}
                      options={[
                        {
                          value: "api-key",
                          label: (
                            <span className="inline-flex items-center gap-1">
                              <KeyRound className="size-3" />
                              API key
                            </span>
                          ),
                        },
                        {
                          value: "sso",
                          label: (
                            <span className="inline-flex items-center gap-1">
                              <ShieldCheck className="size-3" />
                              Sign in
                            </span>
                          ),
                        },
                      ]}
                    />
                  ) : null}
                  <Switch
                    checked={provider.enabled}
                    onChange={(next) => patch(id, { enabled: next })}
                    label={`Enable ${PROVIDER_LABELS[id]}`}
                  />
                </div>
              }
            />
            <div className="p-4 flex flex-col gap-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {mode === "sso" && ssoAvailable ? (
                  <SsoPanel id={id} status={provider.sso} />
                ) : (
                  <Field
                    label="API key"
                    hint={
                      provider.hasKey
                        ? `Configured (${provider.keyHint})`
                        : id === "ollama" || id === "lmstudio"
                          ? "Not required for a local endpoint"
                          : "Not configured"
                    }
                  >
                    {(fieldId) => (
                      <div className="relative">
                        <Input
                          id={fieldId}
                          type={isRevealed ? "text" : "password"}
                          value={keyValue}
                          onChange={(e) => onKeyChange(id, e.target.value)}
                          placeholder={PROVIDER_KEY_PLACEHOLDERS[id]}
                          autoComplete="off"
                          className="pr-9"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setRevealed((prev) => ({ ...prev, [id]: !isRevealed }))
                          }
                          aria-label={isRevealed ? "Hide key" : "Reveal key"}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-faint hover:text-muted"
                        >
                          {isRevealed ? (
                            <EyeOff className="size-4" />
                          ) : (
                            <Eye className="size-4" />
                          )}
                        </button>
                      </div>
                    )}
                  </Field>
                )}

                <Field
                  label="Base URL"
                  hint="Leave blank to use the provider's default endpoint."
                >
                  {(fieldId) => (
                    <Input
                      id={fieldId}
                      value={provider.baseUrl}
                      onChange={(e) => patch(id, { baseUrl: e.target.value })}
                      placeholder={
                        id === "ollama" ? "http://localhost:11434" : "https://…"
                      }
                    />
                  )}
                </Field>
              </div>

              <div className="flex items-center gap-3 flex-wrap">
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => void testProvider(id)}
                  disabled={test.status === "testing"}
                >
                  {test.status === "testing" ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : null}
                  {mode === "sso" ? "Check sign-in" : "Test connection"}
                </Button>

                {test.status === "success" ? (
                  <Badge tone="ok">
                    <CheckCircle2 className="size-3" /> {test.message}
                  </Badge>
                ) : test.status === "error" ? (
                  <Badge tone="danger">
                    <XCircle className="size-3" /> {test.message}
                  </Badge>
                ) : null}
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

/**
 * The sign-in flow lives in a terminal Hive doesn't own, so this panel
 * reports observed state and re-checks on demand rather than pretending to
 * track the flow's progress.
 */
function SsoPanel({ id, status }: { id: ProviderId; status: SsoStatus }) {
  const [live, setLive] = useState<SsoStatus>(status);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      setLive(await API.get<SsoStatus>(`/api/settings/providers/${id}/sso`));
    } catch {
      setNote("Could not reach the Hive server to check.");
    } finally {
      setBusy(false);
    }
  }, [id]);

  const act = useCallback(
    async (action: "login" | "logout") => {
      setBusy(true);
      setNote(null);
      try {
        const result = await API.post<{ message: string; status: SsoStatus }>(
          `/api/settings/providers/${id}/sso/${action}`,
        );
        setNote(result.message);
        setLive(result.status);
      } catch (err) {
        setNote(err instanceof Error ? err.message : "That did not work.");
      } finally {
        setBusy(false);
      }
    },
    [id],
  );

  return (
    <div className="flex flex-col gap-2">
      <span className="text-[12px] font-medium text-ink">Sign-in status</span>

      <div className="flex items-center gap-2 flex-wrap">
        {live.signedIn ? (
          <Badge tone="ok">
            <CheckCircle2 className="size-3" /> Signed in
          </Badge>
        ) : (
          <Badge tone="warn">
            <XCircle className="size-3" /> Not signed in
          </Badge>
        )}
        {live.cli ? (
          <span className="font-mono text-[10px] text-faint">via {live.cli}</span>
        ) : null}
      </div>

      <p className="text-[11px] text-muted">{live.detail}</p>

      <div className="flex items-center gap-2 flex-wrap">
        <Button
          size="sm"
          variant={live.signedIn ? "default" : "primary"}
          onClick={() => void act("login")}
          disabled={busy}
        >
          <LogIn className="size-3.5" />
          {live.signedIn ? "Sign in again" : "Sign in"}
        </Button>
        {live.signedIn ? (
          <Button size="sm" onClick={() => void act("logout")} disabled={busy}>
            <LogOut className="size-3.5" />
            Sign out
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" onClick={() => void refresh()} disabled={busy}>
          <RefreshCw className={busy ? "size-3.5 animate-spin" : "size-3.5"} />
          Re-check
        </Button>
      </div>

      {note ? <p className="text-[11px] text-muted">{note}</p> : null}

      {live.command ? (
        <p className="text-[11px] text-faint">
          Or run{" "}
          <code className="font-mono text-[10px] text-muted">{live.command}</code>{" "}
          yourself, then re-check.
        </p>
      ) : null}
    </div>
  );
}
