import { BREAK_SPOTS, COFFEE, ERRANDS, type TilePoint } from "./layout";
import type { CarryKind } from "./character";

/**
 * Ambient-life state machine for one idle agent: coffee runs and errands
 * with dry mutters. The pure core decides; the page executes (pixi paths,
 * bubbles, carry layers). Busy agents are always handed straight back.
 */

export type ErrandKind = "plant" | "window" | "dispenser";

export interface DirectorState {
  phase:
    | "idle"
    | "toSideboard"
    | "toMachine"
    | "brewing"
    | "home"
    | "toErrand"
    | "doing"
    | "returning";
  /** Wall-clock ms when a waiting phase ends. */
  until: number;
  spot?: TilePoint;
  errand?: ErrandKind;
}

export type DirectorAction =
  | { type: "walkTo"; target: TilePoint }
  | { type: "say"; text: string }
  | { type: "carry"; kind: CarryKind | null }
  | { type: "clear" };

export interface DirectorInput {
  agentId: string;
  busy: boolean;
  arrived: boolean;
  reduceMotion: boolean;
  now: number;
  rng: () => number;
  homeTile: TilePoint;
  state?: DirectorState;
}

const BREW_MS = 2500;
const ERRAND_MS = 2200;

const COFFEE_LINES = [
  "fueling up",
  "a fresh brew fixes bugs",
  "coffee first, commits second",
];

const ERRAND_MUTTERS: Record<ErrandKind, string[]> = {
  plant: ["the ficus needed me", "growth takes time"],
  window: ["fresh air, fresh diffs", "nice light today"],
  dispenser: ["hydration check", "staying sharp"],
};

function pick<T>(list: readonly T[], rng: () => number): T {
  return list[Math.floor(rng() * list.length) % list.length];
}

/** Roll gates: below 0.12 → coffee run, up to 0.72 → errand, else idle. */
const ROLL_COFFEE_BELOW = 0.12;
const ROLL_ACT_ABOVE = 0.72;

export function decide(input: DirectorInput): {
  state: DirectorState;
  actions: DirectorAction[];
} {
  const { busy, arrived, reduceMotion, rng, homeTile } = input;
  const state: DirectorState = input.state ?? { phase: "idle", until: 0 };

  if (busy || reduceMotion) {
    const hadSomething = state.phase !== "idle" || input.state !== undefined;
    return {
      state: { phase: "idle", until: 0 },
      actions: hadSomething
        ? [{ type: "clear" }, { type: "carry", kind: null }]
        : [{ type: "clear" }],
    };
  }

  switch (state.phase) {
    case "toSideboard":
      if (!arrived) return { state, actions: [] };
      return {
        state: { ...state, phase: "toMachine" },
        actions: [
          { type: "carry", kind: "mug" },
          { type: "walkTo", target: COFFEE.machine },
        ],
      };

    case "toMachine":
      if (!arrived) return { state, actions: [] };
      return {
        state: { ...state, phase: "brewing", until: input.now + BREW_MS },
        actions: [{ type: "say", text: pick(COFFEE_LINES, rng) }],
      };

    case "brewing": {
      if (input.now < state.until) return { state, actions: [] };
      return {
        state: { ...state, phase: "home" },
        actions: [{ type: "walkTo", target: homeTile }],
      };
    }

    case "home":
      if (!arrived) return { state, actions: [] };
      // The mug stays on the desk — the page paints it there.
      return {
        state: { phase: "idle", until: 0 },
        actions: [{ type: "carry", kind: null }],
      };

    case "toErrand":
      if (!arrived) return { state, actions: [] };
      return {
        state: { ...state, phase: "doing", until: input.now + ERRAND_MS },
        actions: [
          {
            type: "say",
            text: pick(ERRAND_MUTTERS[state.errand ?? "plant"], rng),
          },
        ],
      };

    case "doing": {
      if (input.now < state.until) return { state, actions: [] };
      return {
        state: { ...state, phase: "returning" },
        actions: [{ type: "walkTo", target: homeTile }],
      };
    }

    case "returning":
      if (!arrived) return { state, actions: [] };
      return {
        state: { phase: "idle", until: 0 },
        actions: [{ type: "clear" }],
      };

    case "idle":
    default: {
      const roll = rng();
      if (roll < ROLL_COFFEE_BELOW) {
        // Coffee run.
        return {
          state: { ...state, phase: "toSideboard" },
          actions: [{ type: "walkTo", target: COFFEE.sideboard }],
        };
      }
      if (roll >= ROLL_ACT_ABOVE) {
        return { state, actions: [] };
      }
      // Errand: pick deterministically from the roll so tests can force a
      // specific one by stubbing rng.
      const idx = Math.floor(roll * 97) % ERRANDS.length;
      const errand = ERRANDS[idx];
      return {
        state: {
          ...state,
          phase: "toErrand",
          errand: errand.kind,
          spot: errand.stand,
        },
        actions: [{ type: "walkTo", target: errand.stand }],
      };
    }
  }
}

/** Break-room chat spots an initiator can walk to (page-level pairing). */
export function pickChatSpot(rng: () => number): TilePoint {
  return BREAK_SPOTS[
    Math.floor(rng() * BREAK_SPOTS.length) % BREAK_SPOTS.length
  ];
}
