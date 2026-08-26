import { describe, expect, it } from "vitest";
import { clampCam, stepCamera } from "./camera";

describe("stepCamera", () => {
  it("moves a fraction of the way toward its target", () => {
    const s = { x: 0, y: 0, zoom: 1 };
    const next = stepCamera(s, { x: 100, y: 50, zoom: 2 }, 1 / 60);
    expect(next.x).toBeGreaterThan(0);
    expect(next.x).toBeLessThan(100);
    expect(next.zoom).toBeGreaterThan(1);
  });

  it("converges on the target over time", () => {
    let s = { x: 0, y: 0, zoom: 1 };
    const target = { x: -240, y: 80, zoom: 1.75 };
    for (let i = 0; i < 600; i++) s = stepCamera(s, target, 1 / 60);
    expect(Math.abs(s.x - target.x)).toBeLessThan(0.5);
    expect(Math.abs(s.y - target.y)).toBeLessThan(0.5);
    expect(Math.abs(s.zoom - target.zoom)).toBeLessThan(0.01);
  });
});

describe("clampCam", () => {
  it("centres a map smaller than the view", () => {
    const s = { x: 500, y: 500, zoom: 1 };
    const c = clampCam(s, 400, 300, 800, 600);
    // Container x = view/2 - camX*zoom → centring means camX = map/2.
    expect(c.x).toBe(200);
    expect(c.y).toBe(150);
  });

  it("clamps panning inside a map larger than the view", () => {
    const s = { x: 9999, y: -9999, zoom: 2 };
    const c = clampCam(s, 640, 480, 800, 600);
    // scaledW=1280 > view 800 → camX ∈ [scaledW-view .. ]/zoom bounds:
    // container clamped to [-480..0] ⇒ camX ∈ [view/2 .. (mapW - view/2)]
    expect(c.x).toBeLessThanOrEqual(640 / 2 + 640 / 2);
    expect(c.x).toBeGreaterThan(0);
    expect(c.y).toBeGreaterThanOrEqual(0);
  });
});
