import type { CSSProperties, ReactNode } from "react";
import { Handle, Position } from "@xyflow/react";
import { Badge } from "../../../components/ui";
import { cn } from "../../../lib/cn";
import type { NodeStatus } from "../types";

const STATUS_TONE: Record<NodeStatus, "neutral" | "accent" | "ok" | "danger"> = {
  idle: "neutral",
  running: "accent",
  ok: "ok",
  failed: "danger",
};

const STATUS_LABEL: Record<NodeStatus, string> = {
  idle: "Idle",
  running: "Running",
  ok: "OK",
  failed: "Failed",
};

export interface HandleSpec {
  type: "source" | "target";
  position: Position;
  id?: string;
  style?: CSSProperties;
}

/**
 * Visual chrome shared by every node type: icon chip, title/subtitle,
 * status chip, optional detail body, and typed handles. Individual node
 * components only decide what goes in the icon/subtitle/body slots.
 */
export function NodeShell({
  icon: Icon,
  title,
  subtitle,
  status = "idle",
  selected,
  handles,
  children,
  width = 236,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  subtitle?: string;
  status?: NodeStatus;
  selected?: boolean;
  handles: HandleSpec[];
  children?: ReactNode;
  width?: number;
}) {
  return (
    <div
      className={cn(
        "relative rounded-lg border bg-surface shadow-card transition-colors",
        selected
          ? "border-accent-line ring-2 ring-accent-soft"
          : "border-line hover:border-line-strong",
      )}
      style={{ width }}
    >
      <div className="flex items-start gap-2 px-2.5 py-2">
        <span
          className={cn(
            "flex items-center justify-center size-6 rounded-md shrink-0",
            selected ? "bg-accent-soft text-accent" : "bg-surface-2 text-muted",
          )}
        >
          <Icon className="size-3.5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[12.5px] font-medium text-ink truncate">{title}</div>
          {subtitle ? (
            <div className="text-[11px] text-muted truncate">{subtitle}</div>
          ) : null}
        </div>
        <Badge tone={STATUS_TONE[status]} className={status === "running" ? "motion-safe:animate-pulse" : undefined}>
          {STATUS_LABEL[status]}
        </Badge>
      </div>

      {children ? (
        <div className="px-2.5 pb-2.5 -mt-0.5 text-[11px] text-muted">{children}</div>
      ) : null}

      {handles.map((h, i) => (
        <Handle
          key={h.id ?? `${h.type}-${i}`}
          type={h.type}
          position={h.position}
          id={h.id}
          style={h.style}
          className="hive-handle"
        />
      ))}
    </div>
  );
}

/** Truncates long free text for the compact canvas card view. */
export function truncate(value: string | undefined, max = 56): string {
  if (!value) return "";
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}
