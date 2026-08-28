import { useEffect, useState } from "react";
import { Check, Copy, FileText, Pencil, Trash2, X } from "lucide-react";
import { cn } from "../../lib/cn";
import {
  Badge,
  Button,
  EmptyState,
  IconButton,
  Modal,
  Textarea,
} from "../../components/ui";
import {
  formatBytes,
  formatTimestamp,
  looksLikeJson,
  tryParseJson,
} from "./format";
import { JsonTree } from "./JsonTree";
import type { MemoryEntry } from "./types";

export function ValuePane({
  sessionId,
  entryKey,
  entry,
  loading,
  onSave,
  onDelete,
  className,
}: {
  sessionId: string | null;
  entryKey: string | null;
  entry: MemoryEntry | null;
  loading: boolean;
  onSave: (value: string) => Promise<void>;
  onDelete: () => Promise<void>;
  className?: string;
}) {
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [draft, setDraft] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Reset local edit state whenever a different entry is loaded (including
  // the fresh copy the server hands back right after a successful save).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMode("view");
    setSaveError(null);
    setDraft(entry?.value ?? "");
  }, [entry]);

  const handleCopy = async () => {
    if (!entry) return;
    try {
      await navigator.clipboard.writeText(entry.value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be denied/unavailable; nothing else to do.
    }
  };

  const handleSave = async () => {
    setSaveError(null);
    if (looksLikeJson(draft) && tryParseJson(draft) === undefined) {
      setSaveError(
        "This looks like JSON but doesn't parse — fix the syntax before saving.",
      );
      return;
    }
    setSaving(true);
    try {
      await onSave(draft);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Could not save value");
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setMode("view");
    setSaveError(null);
    setDraft(entry?.value ?? "");
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await onDelete();
      setDeleteOpen(false);
    } finally {
      setDeleting(false);
    }
  };

  if (!sessionId || !entryKey) {
    return (
      <div className={cn("flex flex-col min-h-0", className)}>
        <EmptyState
          icon={<FileText />}
          title="No key selected"
          description="Choose a key from the list to view its value."
          className="h-full"
        />
      </div>
    );
  }

  if (loading || !entry) {
    return (
      <div className={cn("flex flex-col min-h-0", className)}>
        <div className="flex-1 flex items-center justify-center text-[13px] text-muted">
          {loading ? "Loading…" : "Could not load this entry."}
        </div>
      </div>
    );
  }

  const parsed = mode === "view" ? tryParseJson(entry.value) : undefined;
  const isJson = mode === "view" && parsed !== undefined;

  return (
    <div className={cn("flex flex-col min-h-0", className)}>
      <div className="px-4 pt-3 pb-2.5 border-b border-line shrink-0">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="font-mono text-sm text-ink truncate">
              {entry.key}
            </div>
            <div className="mt-1 flex items-center gap-2 text-[11px] text-muted">
              <Badge tone={isJson ? "info" : "neutral"}>
                {isJson ? "JSON" : "Text"}
              </Badge>
              <span data-numeric>
                {formatBytes(Buffer_byteLength(entry.value))}
              </span>
              <span>Updated {formatTimestamp(entry.updatedAt)}</span>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {mode === "view" ? (
              <>
                <IconButton
                  size="sm"
                  onClick={handleCopy}
                  aria-label="Copy value"
                >
                  {copied ? (
                    <Check className="size-4 text-ok" aria-hidden="true" />
                  ) : (
                    <Copy className="size-4" aria-hidden="true" />
                  )}
                </IconButton>
                <IconButton
                  size="sm"
                  onClick={() => setMode("edit")}
                  aria-label="Edit value"
                >
                  <Pencil className="size-4" aria-hidden="true" />
                </IconButton>
                <IconButton
                  size="sm"
                  onClick={() => setDeleteOpen(true)}
                  aria-label="Delete entry"
                  className="text-danger hover:bg-danger-soft hover:border-danger"
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </IconButton>
              </>
            ) : (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleCancel}
                  disabled={saving}
                >
                  <X className="size-3.5" aria-hidden="true" />
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => void handleSave()}
                  disabled={saving}
                >
                  <Check className="size-3.5" aria-hidden="true" />
                  {saving ? "Saving…" : "Save"}
                </Button>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto min-h-0 p-4">
        {mode === "edit" ? (
          <div className="flex flex-col gap-2 h-full">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="flex-1 min-h-[240px] font-mono text-xs resize-none"
              aria-label="Edit value"
              spellCheck={false}
            />
            {saveError ? (
              <p className="text-[12px] text-danger">{saveError}</p>
            ) : null}
          </div>
        ) : isJson ? (
          <JsonTree value={parsed} />
        ) : (
          <pre className="font-mono text-xs text-ink whitespace-pre-wrap break-all leading-relaxed">
            {entry.value}
          </pre>
        )}
      </div>

      <Modal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Delete entry"
        description={`Permanently delete "${entry.key}" from this session. This can't be undone.`}
        footer={
          <>
            <Button
              variant="default"
              onClick={() => setDeleteOpen(false)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => void handleDelete()}
              disabled={deleting}
            >
              {deleting ? "Deleting…" : "Delete entry"}
            </Button>
          </>
        }
      >
        <p className="text-[13px] text-muted">
          The key <span className="font-mono text-ink">{entry.key}</span> will
          be removed from{" "}
          <span className="font-mono text-ink">{sessionId}</span>.
        </p>
      </Modal>
    </div>
  );
}

/** Byte length of a UTF-8 string without pulling in a Buffer polyfill in the browser. */
function Buffer_byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}
