import { Moon, Sun, Wifi, WifiOff } from "lucide-react";
import { ProjectSwitcher } from "./ProjectSwitcher";
import { IconButton, StatusDot } from "./ui";
import { useTheme } from "../themes";
import { useServerStatus } from "../state/useServerStatus";
import { UpdateNotice } from "./UpdateNotice";

/**
 * Global bar: which project you are scoped to, whether the swarm is
 * reachable, and the light/dark toggle. Deliberately thin — page-level
 * actions belong in each page's own header.
 */
export function TopBar() {
  const { resolvedMode, toggleMode } = useTheme();
  const { online, activeTasks } = useServerStatus();

  return (
    <header className="h-14 shrink-0 border-b border-line bg-surface flex items-center justify-between gap-4 px-4">
      <ProjectSwitcher />

      <div className="flex items-center gap-3">
        <UpdateNotice />

        {activeTasks > 0 ? (
          <span className="flex items-center gap-1.5 text-[12px] text-muted">
            <StatusDot tone="accent" pulse />
            <span data-numeric>
              {activeTasks} {activeTasks === 1 ? "agent" : "agents"} working
            </span>
          </span>
        ) : null}

        <span
          className="flex items-center gap-1.5 text-[12px] text-muted"
          title={
            online ? "Connected to Hive server" : "Hive server unreachable"
          }
        >
          {online ? (
            <Wifi className="size-3.5 text-ok" />
          ) : (
            <WifiOff className="size-3.5 text-danger" />
          )}
          <span className="hidden sm:inline">
            {online ? "Connected" : "Offline"}
          </span>
        </span>

        <IconButton
          size="sm"
          onClick={toggleMode}
          aria-label={
            resolvedMode === "dark"
              ? "Switch to light mode"
              : "Switch to dark mode"
          }
        >
          {resolvedMode === "dark" ? (
            <Sun className="size-4" />
          ) : (
            <Moon className="size-4" />
          )}
        </IconButton>
      </div>
    </header>
  );
}
