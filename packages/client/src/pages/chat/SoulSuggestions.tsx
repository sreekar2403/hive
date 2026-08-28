import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, XCircle, FileText, RefreshCw } from "lucide-react";
import { API } from "../../lib/api";
import { Badge, Button, Card, CardHeader } from "../../components/ui";
import { cn } from "../../lib/cn";

interface SoulSuggestion {
  id: string;
  scope: "global" | "project";
  section: string;
  entry: string;
  rationale: string;
  confidence: number;
  status: "pending" | "approved" | "rejected";
  createdAt: number;
}

export function SoulSuggestions({
  projectId,
  onRefresh,
}: {
  projectId: string | null;
  onRefresh?: () => void;
}) {
  const [suggestions, setSuggestions] = useState<{
    pending: SoulSuggestion[];
    resolved: SoulSuggestion[];
  }>({
    pending: [],
    resolved: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSuggestions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const scope = projectId ? "project" : "global";
      const res = await API.get<{
        pending: SoulSuggestion[];
        resolved: SoulSuggestion[];
      }>(`/api/brain/suggestions?scope=${scope}&projectId=${projectId || ""}`);
      setSuggestions(res);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load suggestions",
      );
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchSuggestions();
  }, [fetchSuggestions]);

  const approve = async (id: string) => {
    const scope = projectId ? "project" : "global";
    try {
      await API.post(`/api/brain/suggestions/${id}/approve`, { scope });
      fetchSuggestions();
      onRefresh?.();
    } catch (err) {
      console.error("Failed to approve suggestion:", err);
    }
  };

  const reject = async (id: string) => {
    const scope = projectId ? "project" : "global";
    try {
      await API.post(`/api/brain/suggestions/${id}/reject`, { scope });
      fetchSuggestions();
    } catch (err) {
      console.error("Failed to reject suggestion:", err);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardHeader
          title="Soul.md Suggestions"
          actions={<RefreshCw className="size-3.5 animate-spin" />}
        />
        <div className="p-4 text-center text-muted">Loading suggestions…</div>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader title="Soul.md Suggestions" />
        <div className="p-4 px-3 py-2 rounded-md border border-danger bg-danger-soft text-[12px] text-danger">
          {error}
        </div>
      </Card>
    );
  }

  const allSuggestions = [...suggestions.pending, ...suggestions.resolved];

  if (allSuggestions.length === 0) {
    return (
      <Card>
        <CardHeader title="Soul.md Suggestions" />
        <EmptyState
          icon={<FileText />}
          title="No suggestions yet"
          description="Run a learning batch to generate soul.md suggestions for your approval."
        />
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        title="Soul.md Suggestions"
        eyebrow="Second Brain"
        actions={
          <Button
            size="sm"
            variant="ghost"
            onClick={fetchSuggestions}
            disabled={loading}
          >
            <RefreshCw
              className={loading ? "size-3.5 animate-spin" : "size-3.5"}
            />
            Refresh
          </Button>
        }
      />
      <div className="p-4 space-y-3">
        {suggestions.pending.length > 0 && (
          <div>
            <h3 className="text-sm font-medium text-ink mb-2">
              Pending ({suggestions.pending.length})
            </h3>
            {suggestions.pending.map((s) => (
              <SuggestionCard
                key={s.id}
                suggestion={s}
                onApprove={approve}
                onReject={reject}
              />
            ))}
          </div>
        )}

        {suggestions.resolved.length > 0 && (
          <div>
            <h3 className="text-sm font-medium text-ink mb-2">
              Resolved ({suggestions.resolved.length})
            </h3>
            {suggestions.resolved.slice(0, 10).map((s) => (
              <SuggestionCard
                key={s.id}
                suggestion={s}
                onApprove={approve}
                onReject={reject}
              />
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

function SuggestionCard({
  suggestion,
  onApprove,
  onReject,
}: {
  suggestion: SoulSuggestion;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
}) {
  const isPending = suggestion.status === "pending";

  return (
    <div
      className={cn(
        "p-3 rounded-lg border bg-surface-2",
        isPending && "border-accent-line bg-accent-soft",
      )}
    >
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Badge
              tone={
                suggestion.status === "approved"
                  ? "ok"
                  : suggestion.status === "rejected"
                    ? "danger"
                    : "accent"
              }
            >
              {suggestion.status}
            </Badge>
            <Badge tone="info">{suggestion.section}</Badge>
            <span className="font-mono text-[10px] text-faint">
              confidence: {suggestion.confidence.toFixed(2)}
            </span>
          </div>
          <p className="text-[13px] text-ink">{suggestion.entry}</p>
          <p className="text-[11px] text-muted mt-1">{suggestion.rationale}</p>
        </div>
        {isPending && (
          <div className="flex items-center gap-2 shrink-0">
            <Button
              size="sm"
              variant="primary"
              onClick={() => onApprove(suggestion.id)}
            >
              <CheckCircle2 className="size-3.5" />
              Approve
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={() => onReject(suggestion.id)}
            >
              <XCircle className="size-3.5" />
              Reject
            </Button>
          </div>
        )}
        {!isPending && (
          <span className="text-[11px] text-muted shrink-0">
            {suggestion.status === "approved"
              ? "Added to soul.md"
              : "Dismissed"}
          </span>
        )}
      </div>
    </div>
  );
}

function EmptyState({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="p-8 text-center">
      <div className="mb-3 text-faint">{icon}</div>
      <p className="text-sm font-medium text-ink">{title}</p>
      <p className="text-[13px] text-muted mt-1">{description}</p>
    </div>
  );
}

export default SoulSuggestions;
