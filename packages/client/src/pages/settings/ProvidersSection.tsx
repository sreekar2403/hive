import { useState } from "react";
import { CheckCircle2, Eye, EyeOff, Loader2, XCircle } from "lucide-react";
import { Badge, Button, Card, CardHeader, Field, Input, Switch } from "../../components/ui";
import { API } from "../../lib/api";
import {
  PROVIDER_IDS,
  PROVIDER_KEY_PLACEHOLDERS,
  PROVIDER_LABELS,
  type ProviderId,
  type SettingsConfig,
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

  const setEnabled = (id: ProviderId, enabled: boolean) => {
    onChange((prev) => ({
      ...prev,
      providers: {
        ...prev.providers,
        [id]: { ...prev.providers[id], enabled },
      },
    }));
  };

  const setBaseUrl = (id: ProviderId, baseUrl: string) => {
    onChange((prev) => ({
      ...prev,
      providers: {
        ...prev.providers,
        [id]: { ...prev.providers[id], baseUrl },
      },
    }));
  };

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
      {PROVIDER_IDS.map((id) => {
        const provider = draft.providers[id];
        const test = tests[id] ?? { status: "idle" };
        const isRevealed = revealed[id] ?? false;
        const keyValue = keyDrafts[id] ?? "";

        return (
          <Card key={id}>
            <CardHeader
              eyebrow="Provider"
              title={PROVIDER_LABELS[id]}
              actions={
                <Switch
                  checked={provider.enabled}
                  onChange={(next) => setEnabled(id, next)}
                  label={`Enable ${PROVIDER_LABELS[id]}`}
                />
              }
            />
            <div className="p-4 flex flex-col gap-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field
                  label="API key"
                  hint={
                    provider.hasKey
                      ? `Configured (${provider.keyHint})`
                      : id === "ollama"
                        ? "Not required for a local Ollama endpoint"
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
                        onClick={() => setRevealed((prev) => ({ ...prev, [id]: !isRevealed }))}
                        aria-label={isRevealed ? "Hide key" : "Reveal key"}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-faint hover:text-muted"
                      >
                        {isRevealed ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                      </button>
                    </div>
                  )}
                </Field>

                <Field label="Base URL" hint="Leave blank to use the provider's default endpoint.">
                  {(fieldId) => (
                    <Input
                      id={fieldId}
                      value={provider.baseUrl}
                      onChange={(e) => setBaseUrl(id, e.target.value)}
                      placeholder={
                        id === "ollama" ? "http://localhost:11434" : "https://…"
                      }
                    />
                  )}
                </Field>
              </div>

              <div className="flex items-center gap-3">
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => void testProvider(id)}
                  disabled={test.status === "testing"}
                >
                  {test.status === "testing" ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : null}
                  Test connection
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
