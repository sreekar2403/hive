import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Application, Container } from "pixi.js";
import { Building2, Clock, FileCode2, Maximize2 } from "lucide-react";
import {
  Badge,
  Button,
  EmptyState,
  IconButton,
  PageHeader,
  StatusDot,
  useTheme,
} from "../components/ui";
import { cn } from "../lib/cn";
import {
  COLS,
  ROWS,
  TILE,
  ZONES,
  ZONES_BY_ID,
  buildWalkableGrid,
} from "./office/layout";
import { Character } from "./office/character";
import { findPath } from "./office/pathfinding";
import { ENTRY_TILE, pickRoamTile } from "./office/roaming";
import { buildFloor, readPalette, type Palette } from "./office/scene";
import { useOfficeState } from "./office/useOfficeState";
import type { AgentSnapshot, TaskPhase, TilePoint } from "./office/types";

const AGENT_VAR: Record<string, string> = {
  opencode: "--hive-agent-opencode",
  "claude-code": "--hive-agent-claude",
  pi: "--hive-agent-pi",
};

const SKINS = [0xe8c39e, 0xc68863, 0x8d5524, 0xf1d2b6, 0xa9714b];
const HAIRS = [0x2c2418, 0x4a3728, 0x6b4423, 0x1a1a1a, 0x8b6f47];

/** Stable per-agent variation so a character looks the same across reloads. */
function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function OfficeFloorPage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const worldRef = useRef<Container | null>(null);
  const charactersRef = useRef<Map<string, Character>>(new Map());
  const gridRef = useRef<boolean[][]>(buildWalkableGrid());
  const paletteRef = useRef<Palette | null>(null);
  const occupancyRef = useRef<Map<string, string>>(new Map());
  /** Which zone each character has been sent to, so re-syncs don't re-path. */
  const assignmentsRef = useRef<Map<string, TaskPhase>>(new Map());
  /** The first roster sync places everyone; later arrivals walk in. */
  const seededRef = useRef(false);

  const { theme } = useTheme();
  const { agents, loading, error } = useOfficeState();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const selected = agents.find((a) => a.id === selectedId) ?? null;

  const reduceMotion = useMemo(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    [],
  );

  /* ---------------- pixi lifecycle ---------------- */

  const fitToView = useCallback(() => {
    const app = appRef.current;
    const world = worldRef.current;
    const parent = containerRef.current;
    if (!app || !world || !parent) return;
    const scale = Math.min(
      parent.clientWidth / (COLS * TILE),
      parent.clientHeight / (ROWS * TILE),
    );
    world.scale.set(scale);
    world.position.set(
      (parent.clientWidth - COLS * TILE * scale) / 2,
      (parent.clientHeight - ROWS * TILE * scale) / 2,
    );
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;
    const parent = containerRef.current;

    const app = new Application();
    appRef.current = app;
    // Captured for cleanup: the refs themselves may be reassigned by then.
    const characters = charactersRef.current;
    const occupancy = occupancyRef.current;
    const assignments = assignmentsRef.current;
    let cancelled = false;
    let initialized = false;

    (async () => {
      await app.init({
        background: 0x000000,
        backgroundAlpha: 0,
        antialias: true,
        resizeTo: parent,
      });
      initialized = true;

      // Zone signs size themselves to their text. Measuring before IBM
      // Plex Mono loads yields fallback-font widths and clipped plates.
      try {
        await document.fonts.ready;
      } catch {
        // Font Loading API unavailable — fall back to whatever is measured.
      }

      // React 19 StrictMode mounts, unmounts and remounts effects in dev.
      // If cleanup already ran while init() was pending, destroying a
      // half-initialised Application throws, so bail out here instead.
      if (cancelled) {
        app.destroy(true, { children: true });
        return;
      }

      parent.appendChild(app.canvas as HTMLCanvasElement);

      const palette = readPalette(parent, theme === "dark");
      paletteRef.current = palette;

      const world = new Container();
      world.sortableChildren = true;
      worldRef.current = world;

      world.addChild(buildFloor(palette));
      app.stage.addChild(world);

      fitToView();
      setReady(true);

      app.ticker.add((ticker) => {
        const dt = ticker.deltaMS / 1000;
        const now = performance.now();

        for (const [id, character] of charactersRef.current) {
          character.update(dt);

          // Thinking looks like pacing: a character who has arrived takes
          // a few steps around their own room now and then rather than
          // standing perfectly still until the next phase change.
          if (!character.wantsToRoam(now)) continue;
          const phase = assignmentsRef.current.get(id);
          const zone = phase ? ZONES_BY_ID[phase] : null;
          if (!zone) continue;

          const home = character.homeTile;
          const at = character.currentTile;
          const away = at.x !== home.x || at.y !== home.y;
          const target =
            away && Math.random() < 0.45
              ? home
              : pickRoamTile(gridRef.current, zone, home);

          if (target) {
            character.setPath(findPath(gridRef.current, at, target));
          }
          // Busy agents fidget; idle ones in the break room drift slowly.
          character.scheduleRoam(
            now,
            character.isWorking ? 2400 : 7000,
            character.isWorking ? 6000 : 16000,
          );
        }
      });
    })();

    return () => {
      cancelled = true;
      if (initialized) {
        app.ticker.stop();
        app.destroy(true, { children: true });
      }
      appRef.current = null;
      worldRef.current = null;
      for (const c of characters.values()) c.destroy();
      characters.clear();
      occupancy.clear();
      assignments.clear();
      seededRef.current = false;
      setReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Repaint the static floor when the theme flips, leaving the pixi
  // Application and the characters in place.
  useEffect(() => {
    const world = worldRef.current;
    const parent = containerRef.current;
    if (!ready || !world || !parent) return;

    // ThemeProvider stamps data-theme in its own effect, and a parent's
    // effect runs after its children's — so reading the CSS variables
    // synchronously here would still see the previous theme's values.
    const frame = requestAnimationFrame(() => {
      const palette = readPalette(parent, theme === "dark");
      paletteRef.current = palette;

      // The floor is whichever child sits at zIndex 0; characters carry
      // their y as zIndex, so it is always the first child after sorting.
      const oldFloor = world.children[0];
      world.addChildAt(buildFloor(palette), 0);
      oldFloor?.destroy({ children: true });

      // Name tags are drawn against the floor, so they re-tint too.
      for (const character of charactersRef.current.values()) {
        character.setNameColor(palette.ink);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [theme, ready]);

  useEffect(() => {
    const onResize = () => fitToView();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [fitToView]);

  /* ---------------- sync characters to roster ---------------- */

  useEffect(() => {
    const world = worldRef.current;
    const parent = containerRef.current;
    if (!ready || !world || !parent) return;

    const palette = paletteRef.current ?? readPalette(parent, theme === "dark");
    const cs = getComputedStyle(parent);
    const characters = charactersRef.current;
    const occupancy = occupancyRef.current;
    const seen = new Set<string>();

    /** Picks a free standing slot in the zone, so agents don't stack up. */
    const claimSlot = (phase: TaskPhase, agentId: string): TilePoint => {
      const zone = ZONES_BY_ID[phase] ?? ZONES_BY_ID["break-room"];
      for (const slot of zone.slots) {
        const key = `${slot.x},${slot.y}`;
        const holder = occupancy.get(key);
        if (!holder || holder === agentId) {
          // Leaving a zone frees the desk held there, otherwise a
          // long-lived agent slowly reserves a slot in every room.
          for (const [otherKey, otherHolder] of occupancy) {
            if (otherHolder === agentId && otherKey !== key) {
              occupancy.delete(otherKey);
            }
          }
          occupancy.set(key, agentId);
          return slot;
        }
      }
      return zone.slots[hashCode(agentId) % zone.slots.length];
    };

    for (const agent of agents) {
      seen.add(agent.id);
      const shirtVar = AGENT_VAR[agent.harness] ?? "--hive-agent-hive";
      const shirtRaw = cs.getPropertyValue(shirtVar).trim();
      const shirt = parseInt(shirtRaw.replace("#", ""), 16) || 0xe8a33d;
      const h = hashCode(agent.id);

      const slot = claimSlot(agent.phase, agent.id);
      let character = characters.get(agent.id);
      const isNew = !character;

      if (!character) {
        // Everyone already on the floor when the page opens is simply
        // placed. Anyone who turns up later walks in through the door.
        const start = seededRef.current ? ENTRY_TILE : slot;
        character = new Character(
          {
            name: agent.name,
            shirt,
            skin: SKINS[h % SKINS.length],
            hair: HAIRS[(h >> 3) % HAIRS.length],
            tile: start,
          },
          reduceMotion,
        );
        character.setHome(slot);
        character.scheduleRoam(performance.now(), 1500, 5000);
        character.root.on("pointertap", () => setSelectedId(agent.id));
        characters.set(agent.id, character);
        world.addChild(character.root);
      }

      character.retint(
        shirt,
        SKINS[h % SKINS.length],
        HAIRS[(h >> 3) % HAIRS.length],
        palette.ink,
      );
      character.setActivityColor(shirt);
      character.setWorking(agent.taskId !== null && agent.phase !== "break-room");

      // Walk to the zone that matches this agent's phase. Only a change
      // of zone re-routes: a character pacing around their desk (see the
      // roam loop in the ticker) must not be yanked back on every poll.
      const assigned = assignmentsRef.current.get(agent.id);
      if (isNew || assigned !== agent.phase) {
        assignmentsRef.current.set(agent.id, agent.phase);
        character.setHome(slot);
        const at = character.currentTile;
        if (at.x !== slot.x || at.y !== slot.y) {
          character.setPath(findPath(gridRef.current, at, slot));
        }
      }
    }

    seededRef.current = true;

    // Remove characters whose agents are gone.
    for (const [id, character] of characters) {
      if (seen.has(id)) continue;
      character.destroy();
      characters.delete(id);
      assignmentsRef.current.delete(id);
      for (const [key, holder] of occupancy) {
        if (holder === id) occupancy.delete(key);
      }
      if (selectedId === id) setSelectedId(null);
    }
  }, [agents, ready, reduceMotion, selectedId, theme]);

  /* ---------------- render ---------------- */

  const busy = agents.filter((a) => a.taskId !== null);

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 pt-6">
        <PageHeader
          eyebrow="Floor"
          title="Office"
          description="Where each agent stands is the stage its task has reached."
          actions={
            <IconButton onClick={fitToView} aria-label="Fit floor to view">
              <Maximize2 className="size-4" />
            </IconButton>
          }
        />
      </div>

      <div className="flex-1 min-h-0 flex border-t border-line">
        <div className="flex-1 min-w-0 relative bg-bg">
          <div ref={containerRef} className="absolute inset-0" />

          {!loading && agents.length === 0 ? (
            <div className="absolute inset-0 flex items-center justify-center bg-bg/80">
              <EmptyState
                icon={<Building2 />}
                title={error ? "The swarm is unreachable" : "The office is empty"}
                description={
                  error
                    ? "Start the Hive server to see agents on the floor."
                    : "Agents appear here as soon as they pick up work. Start a task from Chat."
                }
              />
            </div>
          ) : null}

          {/* Legend: the zone→phase mapping is the whole point of this view. */}
          <div className="absolute bottom-3 right-3 bg-surface/95 border border-line rounded-lg shadow-card px-3 py-2.5">
            <div className="eyebrow mb-1.5">Zone = stage</div>
            <ul className="grid grid-cols-2 gap-x-4 gap-y-1">
              {ZONES.map((z) => (
                <li key={z.id} className="flex items-center gap-1.5 text-[11px]">
                  <span
                    className="size-1.5 rounded-full shrink-0"
                    style={{ background: `var(--hive-${tintVar(z.tint)})` }}
                  />
                  <span className="text-ink">{z.label}</span>
                  <span className="text-faint truncate">{z.sublabel.split("·")[0]}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <aside className="w-72 shrink-0 border-l border-line bg-surface flex flex-col">
          <div className="px-4 py-3 border-b border-line">
            <div className="eyebrow mb-1">On the floor</div>
            <div className="text-sm text-ink">
              <span data-numeric>{busy.length}</span> working ·{" "}
              <span data-numeric>{agents.length - busy.length}</span> idle
            </div>
          </div>

          {selected ? (
            <AgentDetail agent={selected} onClose={() => setSelectedId(null)} />
          ) : (
            <div className="flex-1 overflow-y-auto p-2">
              {agents.length === 0 ? (
                <p className="px-2 py-3 text-[13px] text-muted">
                  Nobody has clocked in yet.
                </p>
              ) : (
                agents.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => setSelectedId(a.id)}
                    className="w-full flex items-center gap-2.5 px-2 py-2 rounded-md text-left hover:bg-surface-2 transition-colors"
                  >
                    <span
                      className="size-2.5 rounded-full shrink-0"
                      style={{
                        background: `var(${AGENT_VAR[a.harness] ?? "--hive-agent-hive"})`,
                      }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] text-ink truncate">
                        {a.name}
                      </span>
                      <span className="block font-mono text-[10px] text-faint truncate">
                        {a.harness}
                      </span>
                    </span>
                    <Badge tone={a.taskId ? "accent" : "neutral"}>
                      {ZONES_BY_ID[a.phase]?.label ?? a.phase}
                    </Badge>
                  </button>
                ))
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function tintVar(tint: string): string {
  const map: Record<string, string> = {
    info: "info",
    ok: "success",
    warn: "warn",
    accent: "accent",
    danger: "danger",
    neutral: "text-faint",
  };
  return map[tint] ?? "text-faint";
}

function AgentDetail({
  agent,
  onClose,
}: {
  agent: AgentSnapshot;
  onClose: () => void;
}) {
  const zone = ZONES_BY_ID[agent.phase];
  // Ticks once a second so the elapsed time stays live, and keeps the
  // impure Date.now() call out of render.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!agent.startedAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [agent.startedAt]);
  const elapsed = agent.startedAt ? now - agent.startedAt : null;

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-4 py-3 border-b border-line flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="eyebrow">{agent.harness}</div>
          <div className="text-sm font-semibold text-ink truncate">{agent.name}</div>
        </div>
        <Button size="sm" onClick={onClose}>
          Back
        </Button>
      </div>

      <div className="p-4 flex flex-col gap-4">
        <div>
          <div className="eyebrow mb-1.5">Stage</div>
          <div className="flex items-center gap-2">
            <StatusDot tone={agent.taskId ? "accent" : "neutral"} pulse={!!agent.taskId} />
            <span className="text-[13px] text-ink">{zone?.label ?? agent.phase}</span>
          </div>
          <p className="text-[12px] text-muted mt-1">{zone?.sublabel}</p>
        </div>

        {agent.taskPrompt ? (
          <div>
            <div className="eyebrow mb-1.5">Task</div>
            <p className="text-[13px] text-ink leading-relaxed">{agent.taskPrompt}</p>
          </div>
        ) : (
          <p className="text-[13px] text-muted">
            Nothing assigned — waiting in the break room.
          </p>
        )}

        {elapsed !== null ? (
          <div className="flex items-center gap-1.5 text-[12px] text-muted">
            <Clock className="size-3.5" />
            <span data-numeric>{formatDuration(elapsed)}</span>
          </div>
        ) : null}

        {agent.filesTouched.length > 0 ? (
          <div>
            <div className="eyebrow mb-1.5">
              Files touched ({agent.filesTouched.length})
            </div>
            <ul className="flex flex-col gap-1">
              {agent.filesTouched.slice(0, 8).map((f) => (
                <li
                  key={f}
                  className="flex items-center gap-1.5 font-mono text-[11px] text-muted truncate"
                >
                  <FileCode2 className="size-3 shrink-0 text-faint" />
                  {f}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {agent.lastOutput ? (
          <div>
            <div className="eyebrow mb-1.5">Last output</div>
            <pre
              className={cn(
                "font-mono text-[11px] text-muted bg-surface-2 border border-line",
                "rounded-md p-2 whitespace-pre-wrap break-words max-h-32 overflow-y-auto",
              )}
            >
              {agent.lastOutput}
            </pre>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}
