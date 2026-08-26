import { Container } from "pixi.js";

/**
 * Smooth lerp camera for the office floor: fit-to-screen default, focus
 * zoom on selection, gentle nudges toward off-screen activity, wheel zoom,
 * drag panning, and hard edge clamping.
 *
 * The math core (stepCamera/clampCam) is pure and unit-tested; this class
 * only binds it to a pixi Container plus DOM-ish input the page forwards.
 */

export interface CamState {
  /** World point under the view centre. */
  x: number;
  y: number;
  zoom: number;
}

const LERP = 0.12;
const MAX_ZOOM = 3;
const NUDGE_STRENGTH = 0.4;

/** One exponential-lerp step toward `target`. */
export function stepCamera(s: CamState, target: CamState, dt: number): CamState {
  // Frame-rate independent lerp factor.
  const k = 1 - Math.pow(1 - LERP, dt * 60);
  return {
    x: s.x + (target.x - s.x) * k,
    y: s.y + (target.y - s.y) * k,
    zoom: s.zoom + (target.zoom - s.zoom) * k,
  };
}

/** Keeps the map filling the view: centred when smaller, clamped when larger. */
export function clampCam(
  s: CamState,
  mapW: number,
  mapH: number,
  viewW: number,
  viewH: number,
): CamState {
  const out = { ...s };
  const scaledW = mapW * out.zoom;
  const scaledH = mapH * out.zoom;

  if (scaledW <= viewW) {
    // Centre: container x = view/2 - camX*zoom ⇒ camX = mapW/2.
    out.x = mapW / 2;
  } else {
    const minX = viewW / 2 / out.zoom;
    const maxX = (mapW - viewW / 2) / out.zoom;
    out.x = Math.min(Math.max(out.x, minX), Math.max(minX, maxX));
  }
  if (scaledH <= viewH) {
    out.y = mapH / 2;
  } else {
    const minY = viewH / 2 / out.zoom;
    const maxY = (mapH - viewH / 2) / out.zoom;
    out.y = Math.min(Math.max(out.y, minY), Math.max(minY, maxY));
  }
  return out;
}

export class Camera {
  private readonly world: Container;
  private current: CamState = { x: 0, y: 0, zoom: 1 };
  private target: CamState = { x: 0, y: 0, zoom: 1 };
  private mapW = 0;
  private mapH = 0;
  private viewW = 0;
  private viewH = 0;
  private manual = false;

  /** Decaying pan offsets for nudgeToward. */
  private nudgeDX = 0;
  private nudgeDY = 0;
  private nudgeLeft = 0;
  private nudgeTotal = 0;

  private panLast: { x: number; y: number } | null = null;

  constructor(world: Container) {
    this.world = world;
  }

  setMapSize(w: number, h: number): void {
    this.mapW = w;
    this.mapH = h;
  }

  resize(vw: number, vh: number): void {
    this.viewW = vw;
    this.viewH = vh;
    if (!this.manual) this.fitToScreen();
  }

  minZoom(): number {
    if (!this.viewW || !this.viewH) return 1;
    return Math.min(this.viewW / this.mapW, this.viewH / this.mapH);
  }

  fitToScreen(): void {
    this.manual = false;
    this.target = { x: this.mapW / 2, y: this.mapH / 2, zoom: this.minZoom() };
  }

  focusOn(x: number, y: number, zoom?: number): void {
    this.manual = true;
    this.target = {
      x,
      y,
      zoom: Math.min(MAX_ZOOM, Math.max(this.minZoom(), zoom ?? 1.75)),
    };
  }

  /** Gentle decaying pan toward a world point without stealing control. */
  nudgeToward(x: number, y: number, ms = 1200): void {
    if (this.manual) return;
    this.nudgeDX = (x - this.target.x) * NUDGE_STRENGTH;
    this.nudgeDY = (y - this.target.y) * NUDGE_STRENGTH;
    this.nudgeLeft = ms / 1000;
    this.nudgeTotal = this.nudgeLeft;
  }

  /** Zoom toward a screen point (wheel). sx/sy are view-local pixels. */
  wheel(dy: number, sx: number, sy: number): void {
    this.manual = true;
    const factor = dy > 0 ? 0.85 : 1.18;
    const z = Math.min(MAX_ZOOM, Math.max(this.minZoom(), this.target.zoom * factor));
    // Keep the world point under the cursor fixed while zooming.
    const wx = (sx - this.viewW / 2) / this.current.zoom + this.current.x;
    const wy = (sy - this.viewH / 2) / this.current.zoom + this.current.y;
    this.target = {
      x: wx - (sx - this.viewW / 2) / z,
      y: wy - (sy - this.viewH / 2) / z,
      zoom: z,
    };
  }

  startPan(sx: number, sy: number): void {
    this.manual = true;
    this.panLast = { x: sx, y: sy };
  }

  pan(sx: number, sy: number): void {
    if (!this.panLast) return;
    const dx = (sx - this.panLast.x) / this.current.zoom;
    const dy = (sy - this.panLast.y) / this.current.zoom;
    this.panLast = { x: sx, y: sy };
    this.target = {
      x: this.target.x - dx,
      y: this.target.y - dy,
      zoom: this.target.zoom,
    };
  }

  endPan(): void {
    this.panLast = null;
  }

  get isPanning(): boolean {
    return this.panLast !== null;
  }

  update(dt: number): void {
    let next = stepCamera(this.current, this.target, dt);

    if (this.nudgeLeft > 0 && !this.manual) {
      this.nudgeLeft -= dt;
      const ease = Math.max(this.nudgeLeft / this.nudgeTotal, 0);
      next = { ...next, x: next.x + this.nudgeDX * ease, y: next.y + this.nudgeDY * ease };
      if (this.nudgeLeft <= 0) {
        this.nudgeDX = 0;
        this.nudgeDY = 0;
      }
    }

    this.current = clampCam(next, this.mapW, this.mapH, this.viewW, this.viewH);
    this.world.scale.set(this.current.zoom);
    this.world.position.set(
      Math.round(this.viewW / 2 - this.current.x * this.current.zoom),
      Math.round(this.viewH / 2 - this.current.y * this.current.zoom),
    );
  }
}
