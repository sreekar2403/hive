import { Router, Request, Response } from "express";
import { Orchestrator, type AgentTask, type TaskPhase } from "../orchestrator";

/**
 * Live agent roster powering the Office floor, read straight off the
 * process's Orchestrator (Orchestrator.getActive() — see its comment for
 * why this route doesn't need HiveServer to inject anything).
 */
const router: Router = Router();

export interface AgentSnapshot {
  id: string;
  name: string;
  harness: string;
  persona: string;
  phase: TaskPhase;
  taskId: string | null;
  taskPrompt: string | null;
  startedAt: number | null;
  filesTouched: string[];
  lastOutput: string | null;
  /** Loop iterations used so far (null while idle) — drives budget pips. */
  iteration: number | null;
  maxIterations: number;
}

/**
 * A name pool per harness, so two concurrent tasks on the same harness get
 * distinct, stable characters instead of colliding on one name.
 *
 * Every harness needs its own entry. When only three had one, the other
 * nine all fell through to the shared fallback pool and each took seat 0 —
 * so Codex, Gemini and Crush were all called "Hazel" at the same time, on
 * the same floor. A pool keyed by harness is only distinct if every harness
 * is actually in it.
 *
 * Initials are deliberately spread rather than matched to the CLI's first
 * letter: "Cass" for Claude Code and "Cody" for Codex would be technically
 * distinct and useless at a glance. Original names, and deliberately not
 * the sitcom's cast.
 */
export const PERSONA_POOL: Record<string, string[]> = {
  opencode: ["Ollie", "Odette", "Otto"],
  "claude-code": ["Cass", "Cole", "Cora"],
  pi: ["Pia", "Pax", "Poe"],
  codex: ["Dex", "Dara", "Dov"],
  gemini: ["Gem", "Gus", "Greta"],
  qwen: ["Wren", "Wynn", "Wade"],
  "cursor-agent": ["Kit", "Kira", "Knox"],
  aider: ["Ada", "Arlo", "Ash"],
  amp: ["Mira", "Milo", "Moss"],
  goose: ["Nell", "Nico", "Nova"],
  crush: ["Remy", "Rosa", "Rex"],
  copilot: ["Lark", "Leo", "Lena"],
  "ollama-direct": ["Tama", "Tosh", "Tilde"],
  "lmstudio-direct": ["Sena", "Silas", "Sable"],
};

/**
 * A name for a harness with no pool of its own.
 *
 * Derived from the harness id rather than drawn from a shared spare pool.
 * A spare pool is what caused the original bug in a different form: any
 * fixed list is finite, so two unknown harnesses eventually land on the
 * same entry, and hashing into it only makes the collision harder to
 * predict rather than rarer.
 *
 * Naming the CLI after itself is unique by construction — two distinct
 * harness ids cannot produce one name — and for an agent Hive does not
 * recognise, "Cursor Agent" is more use on the floor than a random first
 * name would be anyway.
 */
function fallbackName(harness: string): string {
  const words = harness
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1));

  return words.length > 0 ? words.join(" ") : "Agent";
}

export function personaFor(harness: string, index: number): string {
  const pool = PERSONA_POOL[harness];

  if (!pool) {
    // Unknown harness: one name, numbered per concurrent task.
    const name = fallbackName(harness);
    return index === 0 ? name : `${name} ${index + 1}`;
  }

  const name = pool[index % pool.length];
  const lap = Math.floor(index / pool.length);
  return lap === 0 ? name : `${name} ${lap + 1}`;
}

function lastLine(output: string): string | null {
  const lines = output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.length ? lines[lines.length - 1] : null;
}

/**
 * Which desk (seat) each running task occupies, per harness.
 *
 * The roster's ids used to be the task id when busy and `idle:<harness>`
 * when not, so picking up work destroyed one character and created
 * another — the Office floor had no choice but to pop a new sprite into
 * the destination zone. A seat is stable across that transition: the same
 * agent id goes from idle in the Break Room to busy in the Bullpen, and
 * the floor can walk them there.
 */
const seatsByHarness = new Map<string, Map<string, number>>();

function assignSeats(harness: string, tasks: AgentTask[]): Map<string, number> {
  const seats = seatsByHarness.get(harness) ?? new Map<string, number>();
  seatsByHarness.set(harness, seats);

  const live = new Set(tasks.map((t) => t.id));
  for (const taskId of [...seats.keys()]) {
    if (!live.has(taskId)) seats.delete(taskId);
  }

  const taken = new Set(seats.values());
  for (const task of tasks) {
    if (seats.has(task.id)) continue;
    let seat = 0;
    while (taken.has(seat)) seat++;
    taken.add(seat);
    seats.set(task.id, seat);
  }

  return seats;
}

/** Stable across a task's whole life, and across idle/busy transitions. */
function agentId(harness: string, seat: number): string {
  return `agent:${harness}:${seat}`;
}

function busyAgent(harness: string, task: AgentTask, index: number): AgentSnapshot {
  const name = personaFor(harness, index);
  const orchestrator = Orchestrator.getActive();
  return {
    id: agentId(harness, index),
    name,
    harness,
    persona: `${name} · ${harness}`,
    phase: task.phase,
    taskId: task.id,
    taskPrompt: task.prompt,
    startedAt: task.startedAt,
    filesTouched: task.filesChanged,
    lastOutput: lastLine(task.output),
    iteration: task.iteration ?? null,
    maxIterations: orchestrator?.getLoopBudget() ?? 1,
  };
}

function idleAgent(harness: string): AgentSnapshot {
  const name = personaFor(harness, 0);
  return {
    id: agentId(harness, 0),
    name,
    harness,
    persona: `${name} · ${harness}`,
    phase: "break-room",
    taskId: null,
    taskPrompt: null,
    startedAt: null,
    filesTouched: [],
    lastOutput: null,
    iteration: null,
    maxIterations: Orchestrator.getActive()?.getLoopBudget() ?? 1,
  };
}

/**
 * One character per active task, plus one idle character per registered
 * harness that currently has nothing running — so the floor always shows
 * every harness Hive knows about, busy or in the Break Room.
 */
function buildRoster(): AgentSnapshot[] {
  const orchestrator = Orchestrator.getActive();
  if (!orchestrator) return [];

  const harnessNames = orchestrator.getHarnessNames();

  const active = orchestrator
    .getAllTasks()
    .filter((task) => task.status === "pending" || task.status === "running")
    .sort((a, b) => a.startedAt - b.startedAt);

  const byHarness = new Map<string, AgentTask[]>();
  for (const task of active) {
    const list = byHarness.get(task.harness) ?? [];
    list.push(task);
    byHarness.set(task.harness, list);
  }

  const roster: AgentSnapshot[] = [];
  const covered = new Set<string>();

  for (const harness of harnessNames) {
    covered.add(harness);
    const tasks = byHarness.get(harness) ?? [];
    if (tasks.length === 0) {
      seatsByHarness.get(harness)?.clear();
      roster.push(idleAgent(harness));
    } else {
      const seats = assignSeats(harness, tasks);
      for (const task of tasks) {
        roster.push(busyAgent(harness, task, seats.get(task.id) ?? 0));
      }
    }
  }

  // A task routed to a harness that wasn't registered at startup (the
  // router falls back defensively) still gets a character rather than
  // silently vanishing from the floor.
  for (const [harness, tasks] of byHarness) {
    if (covered.has(harness)) continue;
    const seats = assignSeats(harness, tasks);
    for (const task of tasks) {
      roster.push(busyAgent(harness, task, seats.get(task.id) ?? 0));
    }
  }

  return roster;
}

router.get("/", (_req: Request, res: Response) => {
  res.json({ agents: buildRoster() });
});

export default router;
