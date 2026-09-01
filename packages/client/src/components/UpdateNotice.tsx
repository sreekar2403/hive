import { useState } from "react";
import { ArrowUpCircle, Check, Copy } from "lucide-react";
import { Button, Modal } from "./ui";
import { Markdown } from "./Markdown";
import { useUpdateCheck, type UpdateStatus } from "../state/useUpdateCheck";

/**
 * "A newer Hive exists." A pill in the top bar, and a dialog behind it with
 * the release notes and the one command to run.
 *
 * Hive cannot update itself: it is a git checkout the user owns, running
 * agents against their working tree, and pulling under them mid-task would
 * be the single most hostile thing this app could do. So the notice hands
 * over the command and stays out of the way — dismissible, and silent again
 * until the next version.
 */
export function UpdateNotice() {
  const { status, visible, checking, check, dismiss } = useUpdateCheck();
  const [open, setOpen] = useState(false);

  if (!status || !visible) return null;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title={summary(status)}
        className="flex items-center gap-1.5 rounded-full border border-accent-line bg-accent-soft px-2.5 py-1 text-[12px] font-medium text-accent hover:border-accent transition-colors"
      >
        <ArrowUpCircle className="size-3.5" />
        <span className="hidden sm:inline">Update available</span>
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={
          status.latest
            ? `Hive ${status.latest.version} is available`
            : "Hive has new changes"
        }
        description={summary(status)}
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                dismiss();
                setOpen(false);
              }}
            >
              Remind me later
            </Button>
            <Button variant="ghost" onClick={check} disabled={checking}>
              {checking ? "Checking…" : "Check again"}
            </Button>
            {status.latest?.url ? (
              <Button onClick={() => window.open(status.latest!.url, "_blank")}>
                View release
              </Button>
            ) : null}
          </>
        }
      >
        <div className="space-y-4">
          <UpdateCommand command={status.command} />

          {status.current.dirty ? (
            <p className="text-[13px] text-warn">
              This Hive checkout has uncommitted changes. The command above
              stashes them first so the pull cannot overwrite your work.
            </p>
          ) : null}

          {status.latest?.notes ? (
            <div>
              <h3 className="text-[13px] font-semibold text-ink mb-1.5">
                What changed
              </h3>
              <Markdown className="text-[13px]">{status.latest.notes}</Markdown>
            </div>
          ) : null}

          <p className="text-[12px] text-muted">
            Restart Hive after updating. Running agents finish on the version
            they started on.
          </p>
        </div>
      </Modal>
    </>
  );
}

/** The line that says why we are bothering the user. */
function summary(status: UpdateStatus): string {
  const parts: string[] = [];
  if (status.source === "release" && status.latest) {
    parts.push(`${status.current.version} → ${status.latest.version}`);
  }
  if (status.behindBy && status.behindBy > 0) {
    parts.push(
      `${status.behindBy} new commit${status.behindBy === 1 ? "" : "s"}`,
    );
  }
  return parts.join(" · ") || "New changes are available.";
}

function UpdateCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be refused; the text is selectable anyway.
    }
  };

  return (
    <div className="flex items-center gap-2 rounded-lg border border-line bg-bg px-3 py-2">
      <code className="flex-1 text-[12.5px] text-ink break-all">{command}</code>
      <Button
        size="sm"
        variant="ghost"
        onClick={copy}
        aria-label="Copy command"
      >
        {copied ? (
          <Check className="size-3.5" />
        ) : (
          <Copy className="size-3.5" />
        )}
      </Button>
    </div>
  );
}
