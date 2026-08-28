import { Container, Graphics } from "pixi.js";
import { CREAM, INK } from "./retroTheme";

/**
 * Pixel envelopes that arc across the floor: Reception → agent on task
 * assignment, agent → Mailbox on completion. Self-contained flights the
 * page spawns and ticks; each removes itself when done.
 */

const FLY_HEIGHT = 22;
const ARC_LIFT = 38;
const SPEED = 230; // px/sec; duration derives from distance
const MIN_DURATION = 0.8;
const MAX_DURATION = 2.0;
const FADE_IN = 0.14;
const BURST = 0.34;

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

export interface EnvelopeFlight {
  readonly view: Container;
  /** Advances the animation; true when fully played out. */
  update(dt: number): boolean;
  destroy(): void;
}

export function spawnEnvelope(
  from: { x: number; y: number },
  to: { x: number; y: number },
  tint: number,
): EnvelopeFlight {
  const sx = from.x;
  const sy = from.y - FLY_HEIGHT;
  const ex = to.x;
  const ey = to.y - FLY_HEIGHT;

  const dist = Math.hypot(ex - sx, ey - sy);
  const duration = Math.min(MAX_DURATION, Math.max(MIN_DURATION, dist / SPEED));

  const view = new Container();
  view.zIndex = 1_000_000;
  view.eventMode = "none";

  const body = new Graphics();
  const w = 14;
  const h = 10;
  body
    .rect(-w / 2, -h / 2, w, h)
    .fill({ color: tint })
    .stroke({ color: INK[900], width: 1 });
  body
    .moveTo(-w / 2, -h / 2)
    .lineTo(0, h / 2 - 3)
    .lineTo(w / 2, -h / 2)
    .stroke({ color: INK[900], width: 1 });
  // A cream corner seal so envelopes read against any floor colour.
  body.rect(w / 2 - 4, -h / 2 + 1, 2, 2).fill(CREAM[50]);

  const burst = new Graphics();
  burst.visible = false;
  view.addChild(body, burst);

  let elapsed = 0;
  let bursting = false;
  let burstElapsed = 0;
  let finished = false;

  return {
    view,
    update(dt: number): boolean {
      if (finished) return true;

      if (!bursting) {
        elapsed += dt;
        const t = Math.min(elapsed / duration, 1);
        const e = easeInOut(t);
        const x = sx + (ex - sx) * e;
        const lift = -ARC_LIFT * Math.sin(Math.PI * e);
        const y = sy + (ey - sy) * e + lift;
        view.x = Math.round(x);
        view.y = Math.round(y);
        view.alpha = Math.min(elapsed / FADE_IN, 1);
        body.rotation = Math.sin(elapsed * 6) * 0.12;

        if (t >= 1) {
          bursting = true;
          body.visible = false;
          burst.visible = true;
          view.x = Math.round(ex);
          view.y = Math.round(ey);
        }
        return false;
      }

      // Arrival ring.
      burstElapsed += dt;
      const bt = Math.min(burstElapsed / BURST, 1);
      const r = 3 + bt * 12;
      burst.clear();
      burst.circle(0, 0, r).stroke({ color: tint, width: 2, alpha: 1 - bt });
      view.alpha = 1 - bt;
      if (bt >= 1) finished = true;
      return finished;
    },
    destroy(): void {
      view.destroy({ children: true });
    },
  };
}
