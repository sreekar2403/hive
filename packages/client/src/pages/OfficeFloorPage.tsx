import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Application, Container, Graphics } from "pixi.js";
import { Building2, ChevronDown, ChevronUp, Maximize2 } from "lucide-react";
import {
  Badge,
  Button,
  EmptyState,
  IconButton,
  PageHeader,
} from "../components/ui";
import { cn } from "../lib/cn";
import { subscribeToEvents } from "../lib/api";
import {
  BREAK_SPOTS,
  COLS,
  MAILBOX,
  ROWS,
  TILE,
  ZONES,
  ZONES_BY_ID,
  buildWalkableGrid,
} from "./office/layout";
import { ENTRY_TILE, pickRoamTile } from "./office/roaming";
import { buildFloor } from "./office/scene";
import { Character, initCharacterArt } from "./office/character";
import { Camera } from "./office/camera";
import { LiveActivityStore } from "./office/live";
import { decide, type DirectorState } from "./office/director";
import { findPath } from "./office/pathfinding";
import { drawScreenOn } from "./office/pixelArt";
import { spawnEnvelope, type EnvelopeFlight } from "./office/envelopes";
import {
  MOTION,
  STATUS,
  ZONE_TINT_COLOR,
  accentFor,
} from "./office/retroTheme";
import {
  getApprovalsStore,
  PermissionDialog,
  useApprovals,
  type PendingPermission,
} from "./office/approvals";
import { useOfficeState } from "./office/useOfficeState";
import { useCapacity } from "../state/useCapacity";
import type { AgentSnapshot, TaskPhase, TilePoint } from "./office/types";
import "./office/retro.css";

const SKINS = [0xe8c39e, 0xc68863, 0x8d5524, 0xf1d2b6, 0xa9714b];
const HAIRS = [0x2c2418, 0x4a3728, 0x6b4423, 0x1a1a1a, 0x8b6f47];

/** Stable per-agent variation so a character looks the same across reloads. */
function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** A zone's tint as CSS, so the legend's chips match the floor's stripes. */
function tintHex(tint: string): string {
  const value = ZONE_TINT_COLOR[tint] ?? 0x878c99;
  return `#${value.toString(16).padStart(6, "0")}`;
}

/**
 * Sends an envelope across the floor.
 *
 * `spawnEnvelope` builds the flight but does not place it — the caller owns
 * where it lives. Both call sites had already resolved the world container
 * and then never added the view to it, so every envelope animated
 * faithfully outside the scene graph and nobody ever saw one.
 */
function flyEnvelope(
  world: Container,
  from: TilePoint | { x: number; y: number },
  to: { x: number; y: number },
  tint: number,
): EnvelopeFlight {
  const flight = spawnEnvelope(from, to, tint);
  world.addChild(flight.view);
  return flight;
}

const CHEER_LINES = ["done!", "nailed it", "that's a wrap", "shipped"];
const MUTTER_MS = 2600;

export function OfficeFloorPage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const worldRef = useRef<Container | null>(null);
  const cameraRef = useRef<Camera | null>(null);
  const charactersRef = useRef<Map<string, Character>>(new Map());
  const gridRef = useRef<boolean[][]>(buildWalkableGrid());
  const occupancyRef = useRef<Map<string, string>>(new Map());
  /** Which zone each character has been sent to, so re-syncs don't re-path. */
  const assignmentsRef = useRef<Map<string, TaskPhase>>(new Map());
  /** The first roster sync places everyone; later arrivals walk in. */
  const seededRef = useRef(false);

  const liveStoreRef = useRef<LiveActivityStore | null>(null);
  liveStoreRef.current ??= new LiveActivityStore();
  const directorStateRef = useRef<Map<string, DirectorState>>(new Map());
  const directorNextRef = useRef<Map<string, number>>(new Map());
  const walkTargetRef = useRef<Map<string, TilePoint>>(new Map());
  const mutterTimerRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );
  const screenFxRef = useRef<
    Map<string, { g: Graphics; desk: TilePoint; clock: number }>
  >(new Map());
  const envelopesRef = useRef<EnvelopeFlight[]>([]);
  const agentsRef = useRef<AgentSnapshot[]>([]);
  const suppressTapRef = useRef(false);

  /**
   * Where each character stood when the floor was last torn down. Leaving the
   * page destroys the pixi Application, so without this every agent would be
   * re-seeded at its zone slot and visibly walk back to where it already was.
   */
  const placementsRef = useRef<Map<string, TilePoint>>(new Map());
  const STORAGE_KEY = "hive.office.assignments";

  type StoredPlacement = { phase: TaskPhase; x?: number; y?: number };

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) return;
      const parsed = JSON.parse(stored) as Record<
        string,
        string | StoredPlacement
      >;
      for (const [agentId, value] of Object.entries(parsed)) {
        // Older builds stored a bare phase string.
        if (typeof value === "string") {
          assignmentsRef.current.set(agentId, value as TaskPhase);
          continue;
        }
        if (value?.phase) assignmentsRef.current.set(agentId, value.phase);
        if (
          typeof value?.x === "number" &&
          typeof value?.y === "number" &&
          gridRef.current[value.y]?.[value.x]
        ) {
          placementsRef.current.set(agentId, { x: value.x, y: value.y });
        }
      }
    } catch {
      // Ignore corrupted storage
    }
  }, []);

  const saveAssignments = useCallback(() => {
    try {
      const obj: Record<string, StoredPlacement> = {};
      for (const [agentId, phase] of assignmentsRef.current) {
        const live = charactersRef.current.get(agentId)?.currentTile;
        const at = live ?? placementsRef.current.get(agentId);
        if (live) placementsRef.current.set(agentId, { x: live.x, y: live.y });
        obj[agentId] = at ? { phase, x: at.x, y: at.y } : { phase };
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
    } catch {
      // Ignore storage errors
    }
  }, []);

  /** Latest saver, reachable from the mount-scoped pixi cleanup. */
  const saveAssignmentsRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    saveAssignmentsRef.current = saveAssignments;
  }, [saveAssignments]);

  // A hard reload never runs the unmount path, so checkpoint on a slow timer
  // and when the page is hidden.
  useEffect(() => {
    const tick = setInterval(() => saveAssignmentsRef.current?.(), 5000);
    const onHide = () => saveAssignmentsRef.current?.();
    window.addEventListener("pagehide", onHide);
    return () => {
      clearInterval(tick);
      window.removeEventListener("pagehide", onHide);
      onHide();
    };
  }, []);

  const { agents, loading, error } = useOfficeState();
  const capacity = useCapacity();
  useEffect(() => {
    agentsRef.current = agents;
  }, [agents]);
  const { pending, approve, deny } = useApprovals();
  const [activeRequest, setActiveRequest] = useState<PendingPermission | null>(
    null,
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  /*
    "Expand" folds away the page header and the roster so the floor gets
    the whole pane, with Fit kept as its own control.
  */
  const [expanded, setExpanded] = useState(false);
  const [legendOpen, setLegendOpen] = useState(true);

  const selected = agents.find((a) => a.id === selectedId) ?? null;

  const reduceMotion = useMemo(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    [],
  );

  /* ---------------- pixi lifecycle ---------------- */

  const runDirectorTick = useCallback(
    (id: string, char: Character, now: number) => {
      const target = walkTargetRef.current.get(id);
      const arrived =
        !target ||
        (char.currentTile.x === target.x && char.currentTile.y === target.y);
      if (!arrived) return;

      const st = directorStateRef.current.get(id);
      if (
        st &&
        (st.phase === "brewing" || st.phase === "doing") &&
        now < st.until
      ) {
        return;
      }
      if (!st || st.phase === "idle") {
        const nextAt = directorNextRef.current.get(id) ?? 0;
        if (now < nextAt) return;
        directorNextRef.current.set(id, now + 5000 + Math.random() * 7000);
      }

      const result = decide({
        agentId: id,
        busy: char.isWorking,
        arrived: true,
        reduceMotion,
        now,
        rng: Math.random,
        homeTile: char.homeTile,
        state: st,
      });
      directorStateRef.current.set(id, result.state);

      let newTarget: TilePoint | undefined;
      for (const action of result.actions) {
        switch (action.type) {
          case "walkTo": {
            newTarget = action.target;
            char.setPath(
              findPath(gridRef.current, char.currentTile, action.target),
            );
            break;
          }
          case "say": {
            char.say(action.text, STATUS.thinking);
            const prev = mutterTimerRef.current.get(id);
            if (prev) clearTimeout(prev);
            mutterTimerRef.current.set(
              id,
              setTimeout(() => char.say(null), MUTTER_MS),
            );
            break;
          }
          case "carry":
            char.setCarrying(action.kind);
            break;
          case "clear":
            char.setCarrying(null);
            char.say(null);
            break;
        }
      }
      if (newTarget) walkTargetRef.current.set(id, newTarget);
      else walkTargetRef.current.delete(id);
    },
    [reduceMotion],
  );

  useEffect(() => {
    if (!containerRef.current) return;
    const parent = containerRef.current;

    const app = new Application();
    appRef.current = app;
    const characters = charactersRef.current;
    const occupancy = occupancyRef.current;
    const assignments = assignmentsRef.current;
    // Stable per-mount maps, aliased so cleanup can't race a ref reassign.
    const screens = screenFxRef.current;
    const mutters = mutterTimerRef.current;
    const dirStates = directorStateRef.current;
    const dirNext = directorNextRef.current;
    const walkTargets = walkTargetRef.current;
    let cancelled = false;
    let initialized = false;

    (async () => {
      await app.init({
        backgroundAlpha: 0,
        antialias: false, // hard pixels only
        resizeTo: parent,
      });
      initialized = true;

      // Signposts measure text; wait for the pixel fonts to be usable.
      try {
        await document.fonts.ready;
      } catch {
        // Font Loading API unavailable — fall back to whatever is measured.
      }

      if (cancelled) {
        app.destroy(true, { children: true });
        return;
      }

      parent.appendChild(app.canvas as HTMLCanvasElement);
      initCharacterArt(app.renderer);

      const world = new Container();
      world.sortableChildren = true;
      worldRef.current = world;

      // Flatten static floor children into the world so their zIndex values
      // sort against the characters (walls occlude whoever is behind them).
      const floor = buildFloor();
      while (floor.children.length > 0) {
        world.addChild(floor.children[0]);
      }
      app.stage.addChild(world);

      const camera = new Camera(world);
      cameraRef.current = camera;
      camera.setMapSize(COLS * TILE, ROWS * TILE);
      camera.resize(parent.clientWidth, parent.clientHeight);

      setReady(true);

      /* ---- input: wheel zoom, drag pan, tap select ---- */

      const onWheel = (e: WheelEvent) => {
        e.preventDefault();
        const rect = parent.getBoundingClientRect();
        camera.wheel(e.deltaY, e.clientX - rect.left, e.clientY - rect.top);
      };
      let downPos: { x: number; y: number } | null = null;
      const onPointerDown = (e: PointerEvent) => {
        if (e.button !== 0 && e.button !== 1) return;
        downPos = { x: e.clientX, y: e.clientY };
        suppressTapRef.current = false;
      };
      const onPointerMove = (e: PointerEvent) => {
        if (!downPos) return;
        const dx = e.clientX - downPos.x;
        const dy = e.clientY - downPos.y;
        if (!camera.isPanning && Math.hypot(dx, dy) > 6) {
          camera.startPan(e.clientX, e.clientY);
          suppressTapRef.current = true;
        }
        if (camera.isPanning) camera.pan(e.clientX, e.clientY);
      };
      const onPointerUp = () => {
        downPos = null;
        camera.endPan();
        // Let pixi's pointertap fire before clearing the suppression.
        setTimeout(() => (suppressTapRef.current = false), 0);
      };

      parent.addEventListener("wheel", onWheel, { passive: false });
      parent.addEventListener("pointerdown", onPointerDown);
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);

      /* ---- main tick ---- */

      app.ticker.add((ticker) => {
        const dt = ticker.deltaMS / 1000;
        const now = performance.now();
        camera.update(dt);

        for (const [id, character] of charactersRef.current) {
          character.update(dt);

          // Sit down once parked at a working desk; stand to walk or rest.
          const home = character.homeTile;
          const at = character.currentTile;
          const parked = at.x === home.x && at.y === home.y;
          if (
            character.isWorking &&
            parked &&
            !character.isMoving &&
            assignmentsRef.current.get(id) !== "break-room"
          ) {
            character.sitAtDesk();
          } else if (!character.isWorking || character.isMoving || !parked) {
            character.standUp();
          }

          // Desk screen life while actually seated at work.
          const fx = screens.get(id);
          if (character.isWorking && parked && !character.isMoving) {
            const desk = { x: at.x, y: at.y - 1 };
            if (!fx) {
              const g = new Graphics();
              g.position.set(desk.x * TILE, desk.y * TILE);
              g.zIndex = desk.y * TILE + TILE - 2;
              world.addChild(g);
              screens.set(id, { g, desk, clock: 0 });
            } else {
              fx.clock += dt;
              if (fx.clock > 0.12) {
                fx.clock = 0;
                fx.g.clear();
                drawScreenOn(fx.g, 4, 2, now / 1000);
              }
            }
          } else if (fx) {
            fx.g.destroy();
            screens.delete(id);
          }

          // Roaming: working agents fidget near their desks, idle ones drift.
          if (!character.wantsToRoam(now)) continue;
          const phase = assignmentsRef.current.get(id);
          const zone = phase ? ZONES_BY_ID[phase] : null;
          if (!zone) continue;

          const away = !parked;
          const roamTarget =
            away && Math.random() < 0.45
              ? home
              : pickRoamTile(gridRef.current, zone, home);
          if (roamTarget) {
            character.setPath(findPath(gridRef.current, at, roamTarget));
          }
          character.scheduleRoam(
            now,
            character.isWorking ? 2400 : 7000,
            character.isWorking ? 6000 : 16000,
          );

          // Ambient life (coffee runs / errands) for anyone idle.
          runDirectorTick(id, character, now);
        }

        // Envelopes fly themselves; drop finished ones.
        envelopesRef.current = envelopesRef.current.filter((fl) => {
          const done = fl.update(dt);
          if (done) fl.destroy();
          return !done;
        });
      });

      const cleanupInput = () => {
        parent.removeEventListener("wheel", onWheel);
        parent.removeEventListener("pointerdown", onPointerDown);
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
      };
      // Stash for the unmount path below.
      (
        parent as HTMLDivElement & { __cleanupInput?: () => void }
      ).__cleanupInput = cleanupInput;
    })();

    return () => {
      cancelled = true;
      (
        parent as HTMLDivElement & { __cleanupInput?: () => void }
      ).__cleanupInput?.();
      if (initialized) {
        app.ticker.stop();
        app.destroy(true, { children: true });
      }
      appRef.current = null;
      worldRef.current = null;
      cameraRef.current = null;
      for (const [, fx] of screens) fx.g.destroy();
      screens.clear();
      for (const fl of envelopesRef.current) fl.destroy();
      envelopesRef.current = [];
      for (const t of mutters.values()) clearTimeout(t);
      mutters.clear();
      saveAssignmentsRef.current?.();
      for (const c of characters.values()) c.destroy();
      characters.clear();
      occupancy.clear();
      assignments.clear();
      dirStates.clear();
      dirNext.clear();
      walkTargets.clear();
      seededRef.current = false;
      setReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------------- SSE wiring ---------------- */

  useEffect(() => {
    const store = liveStoreRef.current!;

    const unsubEvents = subscribeToEvents((type, data) => {
      if (type === "agent:activity") {
        store.ingest(type, data);
        return;
      }
      if (type === "permission:request" || type === "permission:resolved") {
        window.dispatchEvent(new CustomEvent(`hive:${type}`));
        void getApprovalsStore().refresh();
        return;
      }
      if (type === "agent:update") {
        const payload = data as { taskId?: string; iteration?: number };
        if (!payload?.taskId || payload.iteration === undefined) return;
        const agentId = store.agentForTask(payload.taskId);
        const agent = agentsRef.current.find((a) => a.id === agentId);
        const character = agentId
          ? charactersRef.current.get(agentId)
          : undefined;
        if (character && agent) {
          character.setBudgetPips(payload.iteration, agent.maxIterations ?? 10);
        }
        return;
      }
      if (type === "task:completed") {
        const payload = data as {
          taskId?: string;
          harness?: string;
          projectId?: string;
        };
        const taskId = payload?.taskId;
        if (!taskId) return;
        const agentId = store.agentForTask(taskId);
        const character = agentId
          ? charactersRef.current.get(agentId)
          : undefined;
        if (!character || !agentId) return;
        const snapshot = agentsRef.current.find((a) => a.id === agentId);
        const busyMs = snapshot?.startedAt
          ? Date.now() - snapshot.startedAt
          : 0;
        if (busyMs >= MOTION.cheerMinBusyMs) {
          character.cheer();
          character.setStatusGlyph("success");
          character.say(
            CHEER_LINES[Math.floor(Math.random() * CHEER_LINES.length)],
            STATUS.success,
          );
          setTimeout(() => character.setStatusGlyph("none"), 3000);
          const world = worldRef.current;
          if (world) {
            envelopesRef.current.push(
              flyEnvelope(
                world,
                { x: character.root.x, y: character.root.y },
                {
                  x: (MAILBOX.x + 0.5) * TILE,
                  y: (MAILBOX.y + 0.5) * TILE,
                },
                STATUS.success,
              ),
            );
          }
        }
        return;
      }
      if (type === "task:started") {
        const payload = data as { taskId?: string };
        const taskId = payload?.taskId;
        if (!taskId) return;
        // Give the roster a beat to place the newcomer, then send the
        // assignment envelope from Reception.
        setTimeout(() => {
          const agentId = store.agentForTask(taskId);
          const character = agentId
            ? charactersRef.current.get(agentId)
            : undefined;
          const world = worldRef.current;
          if (!character || !world) return;
          const entry = ENTRY_TILE;
          envelopesRef.current.push(
            flyEnvelope(
              world,
              { x: (entry.x + 0.5) * TILE, y: (entry.y + 0.5) * TILE },
              { x: character.root.x, y: character.root.y },
              STATUS.working,
            ),
          );
        }, 1500);
      }
    });

    const unsubVisuals = store.subscribe((agentId, visual) => {
      const character = charactersRef.current.get(agentId);
      if (!character) return;
      if (!visual) {
        character.hideToolBubble();
        character.think(false);
        return;
      }
      if (visual.kind === "tool") {
        character.showToolBubble(visual.label ?? "", visual.icon);
        character.think(false);
      } else if (visual.kind === "thinking") {
        character.think(true);
      } else if (visual.kind === "error") {
        character.showToolBubble(visual.label ?? "hit a snag", "!");
        character.think(false);
      }
      // "output" visuals stay off the floor — the desk screen tells that story.
    });

    return () => {
      unsubEvents();
      unsubVisuals();
    };
  }, []);

  /* ---------------- camera helpers ---------------- */

  const fitToView = useCallback(() => {
    cameraRef.current?.fitToScreen();
  }, []);

  useEffect(() => {
    const parent = containerRef.current;
    if (!parent || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      appRef.current?.renderer?.resize(parent.clientWidth, parent.clientHeight);
      cameraRef.current?.resize(parent.clientWidth, parent.clientHeight);
    });
    observer.observe(parent);
    return () => observer.disconnect();
  }, [ready]);

  // Escape is the expected way out of anything that has taken over the pane.
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);

  // Focus the camera on selection.
  useEffect(() => {
    if (!ready || !selectedId) return;
    const character = charactersRef.current.get(selectedId);
    if (character) {
      cameraRef.current?.focusOn(character.root.x, character.root.y);
    }
  }, [selectedId, ready]);

  /* ---------------- sync characters to roster ---------------- */

  useEffect(() => {
    const world = worldRef.current;
    if (!ready || !world) return;

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
          // Leaving a zone frees the desk held there.
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
      const shirt = accentFor(agent.harness);
      const h = hashCode(agent.id);

      const slot = claimSlot(agent.phase, agent.id);
      let character = characters.get(agent.id);
      const isNew = !character;

      if (!character) {
        // Coming back to the page: resume from where this agent was standing,
        // so returning looks like the floor was never left. Genuinely new
        // arrivals walk in from Reception.
        const remembered = placementsRef.current.get(agent.id);
        const start = remembered
          ? remembered
          : seededRef.current
            ? ENTRY_TILE
            : slot;
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
        placementsRef.current.set(agent.id, start);
        character.root.on("pointertap", () => {
          if (suppressTapRef.current) return;
          setSelectedId(agent.id);
        });
        // Idle characters keep their name tag hidden; pointing at one is
        // how you ask who it is.
        character.root.on("pointerover", () =>
          character?.setLabelHovered(true),
        );
        character.root.on("pointerout", () =>
          character?.setLabelHovered(false),
        );
        characters.set(agent.id, character);
        world.addChild(character.root);
        // Bubbles ride above the whole floor, so they are siblings of the
        // character rather than children of it. See Character.overlays.
        for (const overlay of character.overlays) world.addChild(overlay);
      }

      character.retint(
        shirt,
        SKINS[h % SKINS.length],
        HAIRS[(h >> 3) % HAIRS.length],
        0xffffff,
      );
      character.setWorking(
        agent.taskId !== null && agent.phase !== "break-room",
      );
      character.setLabelPinned(selectedId === agent.id);
      if (agent.iteration != null) {
        character.setBudgetPips(agent.iteration, agent.maxIterations ?? 10);
      } else {
        character.setBudgetPips(null, 1);
      }
      // Awaiting review + something actually pending — blocked pulse.
      character.setStatusGlyph(
        agent.phase === "conference" && pending.length > 0 ? "blocked" : "none",
      );

      const assigned = assignmentsRef.current.get(agent.id);
      if (isNew || assigned !== agent.phase) {
        assignmentsRef.current.set(agent.id, agent.phase);
        saveAssignments();
        character.setHome(slot);
        const at = character.currentTile;
        if (at.x !== slot.x || at.y !== slot.y) {
          character.setPath(findPath(gridRef.current, at, slot));
        } else if (!isNew) {
          // Phase change nudges the eye without stealing camera control.
          cameraRef.current?.nudgeToward(
            character.root.x,
            character.root.y,
            900,
          );
        }
      }
    }

    seededRef.current = true;

    // Remove characters whose agents are gone.
    let assignmentsChanged = false;
    for (const [id, character] of characters) {
      if (seen.has(id)) continue;
      character.destroy();
      characters.delete(id);
      assignmentsRef.current.delete(id);
      assignmentsChanged = true;
      for (const [key, holder] of occupancy) {
        if (holder === id) occupancy.delete(key);
      }
      if (selectedId === id) setSelectedId(null);
    }
    if (assignmentsChanged) saveAssignments();

    // Feed the live layer the fresh routing table.
    liveStoreRef.current?.handleRoster(
      agents.map((a) => ({ id: a.id, taskId: a.taskId })),
    );
  }, [agents, ready, reduceMotion, selectedId, pending, saveAssignments]);

  /* ---------------- render ---------------- */

  const busy = agents.filter((a) => a.taskId !== null);

  return (
    <div className="hive-retro h-full flex flex-col">
      {expanded ? null : (
        <div className="px-6 pt-6">
          <PageHeader
            eyebrow="Floor"
            title={<span className="rp-title text-[14px]">Office</span>}
            description="Where each agent stands is the stage its task has reached."
            actions={
              <div className="flex items-center gap-2">
                {capacity ? (
                  <span
                    className="font-mono text-[11px] text-muted"
                    title={`This machine: ${capacity.system.cpus} cores, ${Math.round(capacity.system.totalMemMb / 1024)} GB. Change the limit in Settings → Execution.`}
                    data-numeric
                  >
                    {capacity.load.running}/{capacity.load.limit} desks
                    {capacity.load.queued > 0
                      ? ` · ${capacity.load.queued} queued`
                      : ""}
                  </span>
                ) : null}
                {pending.length > 0 ? (
                  <Button
                    size="sm"
                    onClick={() => setActiveRequest(pending[0])}
                  >
                    {pending.length} need{pending.length === 1 ? "s" : ""} you
                  </Button>
                ) : null}
                <Button size="sm" onClick={fitToView}>
                  Fit
                </Button>
                <IconButton
                  onClick={() => setExpanded(true)}
                  aria-label="Expand the floor"
                  title="Expand the floor"
                >
                  <Maximize2 className="size-4" />
                </IconButton>
              </div>
            }
          />
        </div>
      )}

      <div className="flex-1 min-h-0 flex border-t border-[var(--rp-ink-300)]">
        <div className="flex-1 min-w-0 relative bg-[var(--rp-cream-100)]">
          <div ref={containerRef} className="absolute inset-0" />

          {expanded ? (
            <div className="absolute top-3 right-3 flex items-center gap-1.5">
              <button className="rp-btn rp-small" onClick={fitToView}>
                Fit
              </button>
              <button
                className="rp-btn rp-small"
                onClick={() => setExpanded(false)}
              >
                Collapse
              </button>
            </div>
          ) : null}

          {!loading && agents.length === 0 ? (
            <div className="absolute inset-0 flex items-center justify-center bg-[var(--rp-cream-100)]/85">
              <EmptyState
                icon={<Building2 />}
                title={
                  error ? "The swarm is unreachable" : "The office is empty"
                }
                description={
                  error
                    ? "Start the Hive server to see agents on the floor."
                    : "Agents appear here as soon as they pick up work. Start a task from Chat."
                }
              />
            </div>
          ) : null}

          {pending.length > 0 && expanded ? (
            <button
              className="rp-btn rp-btn--coral absolute top-3 left-3"
              onClick={() => setActiveRequest(pending[0])}
            >
              {pending.length} need{pending.length === 1 ? "s" : ""} you
            </button>
          ) : null}

          {/*
            Legend: the zone=phase mapping is the whole point of this view,
            but it is reference material — it sits quietly in the corner and
            folds away once you know it. Each chip carries its zone's actual
            tint, which the old all-grey squares did not.
          */}
          <div className="absolute bottom-3 right-3 rp-card">
            <button
              className="rp-card__head"
              onClick={() => setLegendOpen((open) => !open)}
              aria-expanded={legendOpen}
              title={legendOpen ? "Hide the legend" : "Show the legend"}
            >
              <span className="eyebrow rp-small">Zone = stage</span>
              {legendOpen ? (
                <ChevronDown className="size-3" />
              ) : (
                <ChevronUp className="size-3" />
              )}
            </button>
            {legendOpen ? (
              <ul className="grid grid-cols-2 gap-x-4 gap-y-1 px-2.5 pb-2">
                {ZONES.map((z) => (
                  <li key={z.id} className="flex items-center gap-1.5 rp-small">
                    <span
                      className="size-2 shrink-0"
                      style={{ background: tintHex(z.tint) }}
                    />
                    <span>{z.label}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          {activeRequest ? (
            <PermissionDialog
              request={activeRequest}
              onApprove={approve}
              onDeny={deny}
              onClose={() => setActiveRequest(null)}
            />
          ) : null}
        </div>

        <aside
          className={cn(
            "w-72 shrink-0 border-l border-[var(--rp-ink-300)] bg-[var(--rp-cream-50)] flex flex-col",
            expanded && "hidden",
          )}
        >
          <div className="px-4 py-3 border-b border-[var(--rp-ink-300)]">
            <div
              className="eyebrow mb-1 rp-small"
              style={{ color: "var(--rp-ink-500)" }}
            >
              On the floor
            </div>
            <div className="text-sm">
              <span data-numeric>{busy.length}</span> working ·{" "}
              <span data-numeric>{agents.length - busy.length}</span> idle ·{" "}
              {BREAK_SPOTS.length > 0 && pending.length === 0
                ? "calm"
                : "needs you"}
            </div>
          </div>

          {selected ? (
            <AgentDetail agent={selected} onClose={() => setSelectedId(null)} />
          ) : (
            <div className="flex-1 overflow-y-auto rp-scroll p-2">
              {agents.length === 0 ? (
                <p
                  className="px-2 py-3 rp-small"
                  style={{ color: "var(--rp-ink-500)" }}
                >
                  Nobody has clocked in yet.
                </p>
              ) : (
                agents.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => setSelectedId(a.id)}
                    className="w-full flex items-center gap-2.5 px-2 py-2 mb-1 border border-transparent text-left hover:border-[var(--rp-ink-300)] hover:bg-[var(--rp-cream-200)] transition-none"
                  >
                    <span
                      className="size-3 shrink-0"
                      style={{ background: cssHex(accentFor(a.harness)) }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] truncate">
                        {a.name}
                        {a.dispatchedBy ? (
                          /* A sub-agent, so the roster says whose. Without
                             this a fan-out reads as unrelated agents that
                             happened to start together. */
                          <span
                            className="ml-1 rp-mono text-[11px]"
                            style={{ color: "var(--rp-ink-500)" }}
                            title="Dispatched as part of a split request"
                          >
                            ↳ sub-agent
                          </span>
                        ) : null}
                      </span>
                      <span
                        className="block rp-mono text-[13px] truncate"
                        style={{ color: "var(--rp-ink-500)" }}
                      >
                        {a.harness}
                      </span>
                    </span>
                    <Badge tone={a.taskId ? "accent" : "neutral"}>
                      {a.coordinating
                        ? `coordinating ${a.coordinating}`
                        : (ZONES_BY_ID[a.phase]?.label ?? a.phase)}
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

function cssHex(n: number): string {
  return `#${n.toString(16).padStart(6, "0")}`;
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
    <div className="flex-1 overflow-y-auto rp-scroll">
      <div className="px-4 py-3 border-b border-[var(--rp-ink-300)] flex items-start justify-between gap-2 bg-[var(--rp-cream-100)]">
        <div className="min-w-0">
          <div
            className="eyebrow rp-small"
            style={{ color: "var(--rp-ink-500)" }}
          >
            {agent.harness}
          </div>
          <div className="text-sm truncate">{agent.name}</div>
        </div>
        <button className="rp-btn rp-small h-6 px-2" onClick={onClose}>
          Back
        </button>
      </div>

      <div className="p-4 flex flex-col gap-4">
        <div>
          <div
            className="eyebrow mb-1.5 rp-small"
            style={{ color: "var(--rp-ink-500)" }}
          >
            Stage
          </div>
          <div className="flex items-center gap-2">
            <span
              className="inline-block size-2"
              style={{
                background: agent.taskId ? "#ffd93d" : "#a899b5",
              }}
            />
            <span className="text-[13px]">{zone?.label ?? agent.phase}</span>
          </div>
          <p
            className="text-[12px] mt-1"
            style={{ color: "var(--rp-ink-500)" }}
          >
            {zone?.sublabel}
          </p>
        </div>

        {agent.taskPrompt ? (
          <div>
            <div
              className="eyebrow mb-1.5 rp-small"
              style={{ color: "var(--rp-ink-500)" }}
            >
              Task
            </div>
            <p className="text-[13px] leading-relaxed">{agent.taskPrompt}</p>
          </div>
        ) : (
          <p className="text-[13px]" style={{ color: "var(--rp-ink-500)" }}>
            Nothing assigned — waiting in the break room.
          </p>
        )}

        {elapsed !== null ? (
          <div
            className="rp-mono text-[15px]"
            style={{ color: "var(--rp-ink-500)" }}
          >
            {formatDuration(elapsed)} on the clock
          </div>
        ) : null}

        {agent.filesTouched.length > 0 ? (
          <div>
            <div
              className="eyebrow mb-1.5 rp-small"
              style={{ color: "var(--rp-ink-500)" }}
            >
              Files touched ({agent.filesTouched.length})
            </div>
            <ul className="flex flex-col gap-1">
              {agent.filesTouched.slice(0, 8).map((f) => (
                <li
                  key={f}
                  className="rp-mono text-[14px] truncate"
                  style={{ color: "#3d2e4a" }}
                >
                  {f}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {agent.lastOutput ? (
          <div>
            <div
              className="eyebrow mb-1.5 rp-small"
              style={{ color: "var(--rp-ink-500)" }}
            >
              Last output
            </div>
            <pre
              className="rp-mono text-[14px] rp-panel rp-panel--inset px-2 py-1 whitespace-pre-wrap break-words max-h-32 overflow-y-auto"
              style={{ color: "#3d2e4a" }}
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
