import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  Building2,
  MessageSquare,
  Kanban,
  GitBranch,
  Calendar,
  Database,
  GitCompare,
  Shield,
  FileText,
  Settings,
  Brain,
} from "lucide-react";
import { cn } from "../lib/cn";

/*
  Nav is grouped by what you are doing, not by feature name: watching the
  swarm work, directing it, then inspecting what it did.
*/
const NAV_GROUPS = [
  {
    label: "Floor",
    items: [
      { path: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
      { path: "/office", label: "Office", icon: Building2 },
      { path: "/chat", label: "Chat", icon: MessageSquare },
    ],
  },
  {
    label: "Direct",
    items: [
      { path: "/kanban", label: "Kanban", icon: Kanban },
      { path: "/workflows", label: "Workflows", icon: GitBranch },
      { path: "/schedule", label: "Schedule", icon: Calendar },
      { path: "/memory", label: "Memory", icon: Database },
    ],
  },
  {
    label: "Inspect",
    items: [
      { path: "/brain", label: "Second Brain", icon: Brain },
      { path: "/git-diff", label: "Changes", icon: GitCompare },
      { path: "/permissions", label: "Permissions", icon: Shield },
      { path: "/logs", label: "Logs", icon: FileText },
      { path: "/settings", label: "Settings", icon: Settings },
    ],
  },
] as const;

export function Sidebar() {
  return (
    <aside className="w-[13.5rem] shrink-0 bg-surface border-r border-line flex flex-col h-full">
      <div className="h-14 flex items-center gap-2.5 px-4 border-b border-line shrink-0">
        <HiveMark />
        <span className="text-[15px] font-semibold tracking-tight text-ink">
          Hive
        </span>
      </div>

      <nav className="flex-1 overflow-y-auto py-3 px-2.5 flex flex-col gap-5">
        {NAV_GROUPS.map((group) => (
          <div key={group.label}>
            <div className="eyebrow px-2 mb-1.5">{group.label}</div>
            <div className="flex flex-col gap-0.5">
              {group.items.map(({ path, label, icon: Icon, ...rest }) => (
                <NavLink
                  key={path}
                  to={path}
                  end={"end" in rest ? rest.end : undefined}
                  className={({ isActive }) =>
                    cn(
                      "group relative flex items-center gap-2.5 h-8 px-2 rounded-md text-[13px] transition-colors",
                      isActive
                        ? "bg-accent-soft text-ink font-medium"
                        : "text-muted hover:bg-surface-2 hover:text-ink",
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      {/* The active marker reads as a ledger tab. */}
                      <span
                        className={cn(
                          "absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full transition-colors",
                          isActive ? "bg-accent" : "bg-transparent",
                        )}
                      />
                      <Icon
                        className={cn(
                          "size-4 shrink-0 transition-colors",
                          isActive
                            ? "text-accent"
                            : "text-faint group-hover:text-muted",
                        )}
                        aria-hidden="true"
                      />
                      <span className="truncate">{label}</span>
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="px-4 py-3 border-t border-line shrink-0">
        <span className="font-mono text-[10px] text-faint">v0.1.0</span>
      </div>
    </aside>
  );
}

/** Hexagon mark — a hive cell, drawn rather than imported as an asset. */
function HiveMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-5 shrink-0" aria-hidden="true">
      <path
        d="M12 2.5 20.5 7v10L12 21.5 3.5 17V7z"
        fill="none"
        stroke="var(--hive-accent)"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
      <path
        d="M12 8.25 16.25 10.6v4.7L12 17.65 7.75 15.3v-4.7z"
        fill="var(--hive-accent)"
        opacity="0.9"
      />
    </svg>
  );
}
