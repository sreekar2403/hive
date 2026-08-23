import { Container, Graphics, Text, TextStyle } from "pixi.js";
import { TILE, tileCenterPx } from "./layout";
import type { TilePoint } from "./types";

/** Walk speed in tiles per second. */
const SPEED = 2.6;

export type Facing = "down" | "up" | "left" | "right";

export interface CharacterOptions {
  name: string;
  shirt: number;
  skin: number;
  hair: number;
  tile: TilePoint;
}

/**
 * A procedurally drawn office worker. Everything is pixi Graphics — no
 * image assets — so characters re-tint instantly when the app theme
 * changes and the whole floor stays a single self-contained bundle.
 */
export class Character {
  readonly root = new Container();

  private readonly body = new Container();
  private readonly legs = new Graphics();
  private readonly torso = new Graphics();
  private readonly head = new Graphics();
  private readonly nameTag: Text;
  private readonly nameTagBg = new Graphics();
  private readonly activity = new Graphics();

  private path: TilePoint[] = [];
  private tile: TilePoint;
  private facing: Facing = "down";
  private walkPhase = 0;
  private working = false;
  private reduceMotion = false;

  constructor(opts: CharacterOptions, reduceMotion: boolean) {
    this.tile = opts.tile;
    this.reduceMotion = reduceMotion;

    this.drawLegs(opts.shirt);
    this.drawTorso(opts.shirt);
    this.drawHead(opts.skin, opts.hair);

    this.body.addChild(this.legs, this.torso, this.head);

    this.nameTag = new Text({
      text: opts.name,
      style: new TextStyle({
        fontFamily: "IBM Plex Mono, monospace",
        fontSize: 9,
        fill: 0xffffff,
        align: "center",
      }),
    });
    this.nameTag.anchor.set(0.5, 1);
    this.nameTag.y = -26;

    // Name tags sit over desks and couches, so they need their own ground
    // to stay readable rather than relying on the floor behind them.
    this.drawNameTagBg();

    this.root.addChild(this.activity, this.body, this.nameTagBg, this.nameTag);
    this.root.eventMode = "static";
    this.root.cursor = "pointer";

    const p = tileCenterPx(this.tile);
    this.root.position.set(p.x, p.y);
    // Depth-sort by vertical position so characters overlap believably.
    this.root.zIndex = p.y;
  }

  /* ---------------- drawing ---------------- */

  private drawLegs(shirt: number) {
    const trousers = darken(shirt, 0.55);
    this.legs.clear();
    this.legs.rect(-5, 2, 4, 9).fill(trousers);
    this.legs.rect(1, 2, 4, 9).fill(trousers);
  }

  private drawTorso(shirt: number) {
    this.torso.clear();
    this.torso.roundRect(-7, -8, 14, 12, 2).fill(shirt);
    // Arms
    this.torso.rect(-9, -6, 3, 9).fill(shirt);
    this.torso.rect(6, -6, 3, 9).fill(shirt);
  }

  private drawHead(skin: number, hair: number) {
    this.head.clear();
    this.head.roundRect(-5, -19, 10, 11, 3).fill(skin);
    // Hair cap
    this.head.roundRect(-5.5, -20, 11, 5, 2.5).fill(hair);
  }

  private drawNameTagBg() {
    const w = this.nameTag.width + 6;
    const h = 11;
    // Plate is the inverse of the text so the tag reads in either theme.
    const ink = Number(this.nameTag.style.fill ?? 0xffffff);
    const luminance =
      ((ink >> 16) & 0xff) * 0.299 +
      ((ink >> 8) & 0xff) * 0.587 +
      (ink & 0xff) * 0.114;
    this.nameTagBg.clear();
    this.nameTagBg
      .roundRect(-w / 2, this.nameTag.y - h + 1, w, h, 2)
      .fill({ color: luminance > 140 ? 0x14171b : 0xf4f3ef, alpha: 0.85 });
  }

  /** Re-colours just the name tag, for theme flips. */
  setNameColor(color: number) {
    this.nameTag.style.fill = color;
    this.drawNameTagBg();
  }

  /** Re-tints the sprite when the theme changes. */
  retint(shirt: number, skin: number, hair: number, nameColor: number) {
    this.drawLegs(shirt);
    this.drawTorso(shirt);
    this.drawHead(skin, hair);
    this.nameTag.style.fill = nameColor;
    this.drawNameTagBg();
  }

  /* ---------------- movement ---------------- */

  get currentTile(): TilePoint {
    return this.tile;
  }

  get isMoving(): boolean {
    return this.path.length > 0;
  }

  setPath(path: TilePoint[]) {
    this.path = path;
    if (this.reduceMotion && path.length) {
      // Snap straight to the destination, no walk animation.
      const last = path[path.length - 1];
      this.tile = last;
      const p = tileCenterPx(last);
      this.root.position.set(p.x, p.y);
      this.root.zIndex = p.y;
      this.path = [];
    }
  }

  setWorking(working: boolean) {
    this.working = working;
    if (!working) this.activity.clear();
  }

  /** Advances the walk + idle animation. `dt` is in seconds. */
  update(dt: number) {
    if (this.path.length) {
      const next = this.path[0];
      const target = tileCenterPx(next);
      const dx = target.x - this.root.x;
      const dy = target.y - this.root.y;
      const dist = Math.hypot(dx, dy);
      const step = SPEED * TILE * dt;

      if (dist <= step) {
        this.root.position.set(target.x, target.y);
        this.tile = next;
        this.path.shift();
      } else {
        this.root.x += (dx / dist) * step;
        this.root.y += (dy / dist) * step;
        this.facing =
          Math.abs(dx) > Math.abs(dy)
            ? dx > 0
              ? "right"
              : "left"
            : dy > 0
              ? "down"
              : "up";
      }

      this.root.zIndex = this.root.y;
      this.walkPhase += dt * 9;
      // Two-frame leg swap plus a small bob reads as walking at this scale.
      const swing = Math.sin(this.walkPhase);
      this.legs.x = swing * 1.4;
      this.body.y = Math.abs(swing) * -0.9;
      this.head.x = this.facing === "left" ? -1 : this.facing === "right" ? 1 : 0;
    } else {
      this.legs.x = 0;
      this.body.y = 0;
      this.walkPhase = 0;
    }

    if (this.working && !this.reduceMotion) {
      this.drawActivity();
    }
  }

  /** A small "typing" pulse under a working character. */
  private drawActivity() {
    const t = performance.now() / 260;
    this.activity.clear();
    for (let i = 0; i < 3; i++) {
      const alpha = 0.25 + 0.55 * (0.5 + 0.5 * Math.sin(t - i * 0.7));
      this.activity.circle(-4 + i * 4, -30, 1.4).fill({ color: 0xffffff, alpha });
    }
  }

  setActivityColor(color: number) {
    this.activity.tint = color;
  }

  destroy() {
    this.root.destroy({ children: true });
  }
}

function darken(color: number, factor: number): number {
  const r = Math.floor(((color >> 16) & 0xff) * factor);
  const g = Math.floor(((color >> 8) & 0xff) * factor);
  const b = Math.floor((color & 0xff) * factor);
  return (r << 16) | (g << 8) | b;
}
