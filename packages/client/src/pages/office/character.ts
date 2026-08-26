import {
  Container,
  Graphics,
  Renderer,
  Sprite,
  Text,
  TextStyle,
  Texture,
} from "pixi.js";
import { TILE, tileCenterPx } from "./layout";
import { PX, bakeTexture, u } from "./pixelArt";
import { ACCENTS, CREAM, INK, MOTION } from "./retroTheme";
import { Bubble } from "./bubbles";
import type { TilePoint } from "./types";

/**
 * A floor actor: a palette-combo of pixel-art walk/sit/type frames baked to
 * textures once per character look, driven by a small state machine.
 *
 * Public surface is the old procedural Character's plus the retro additions
 * (sit/carry/glyphs/cheer/bubbles/pips), so the page swap stays mechanical.
 */

export type Facing = "down" | "up" | "left" | "right";
export type CarryKind = "mug" | "paper" | "term" | "globe" | "mag";

const FRAME_W = 32;
const FRAME_H = 38;

interface PaletteCombo {
  shirt: number;
  skin: number;
  hair: number;
}

type FrameSet = {
  walk: Record<"down" | "up" | "side", Texture[]>;
  sit: Texture;
  type: Texture[];
};

const frameCache = new Map<string, FrameSet>();
let rendererRef: Renderer | null = null;

/**
 * The pixi renderer is needed once, before the first actor is created.
 *
 * Baked frames are RenderTextures owned by the GL context of the renderer
 * that made them. Navigating away from the Office destroys the Application,
 * and with it that context — so a cache kept across mounts hands the new
 * renderer dead textures and every character draws as nothing. Whenever the
 * renderer changes, the cache is dropped and the frames are re-baked.
 */
export function initCharacterArt(renderer: Renderer): void {
  if (rendererRef !== renderer) {
    for (const set of frameCache.values()) {
      const all = [
        ...set.walk.down,
        ...set.walk.up,
        ...set.walk.side,
        set.sit,
        ...set.type,
      ];
      for (const tex of all) {
        // The owning context may already be gone; releasing is best-effort.
        try {
          tex.destroy(true);
        } catch {
          /* already torn down with the renderer */
        }
      }
    }
    frameCache.clear();
  }
  rendererRef = renderer;
}

function darken(color: number, factor: number): number {
  const r = Math.floor(((color >> 16) & 0xff) * factor);
  const g = Math.floor(((color >> 8) & 0xff) * factor);
  const b = Math.floor((color & 0xff) * factor);
  return (r << 16) | (g << 8) | b;
}

/* ------------------------------------------------------------------ */
/* Frame painting                                                      */
/* ------------------------------------------------------------------ */

/**
 * Paints one character frame. Authoring grid: 16×19 units (PX=2 → 32×38px),
 * feet on the bottom row, body centred on x=8u.
 */
function paintFrame(
  g: Parameters<typeof u>[0],
  combo: PaletteCombo,
  dir: "down" | "up" | "side",
  pose: "stand" | "stepA" | "stepB" | "sit" | "typeA" | "typeB",
): void {
  const { shirt, skin, hair } = combo;
  const trousers = darken(shirt, 0.55);

  // Ground shadow (every frame carries its own).
  u(g, 4, 17, 7, 1, INK[900], 0.18);

  const seated = pose === "sit" || pose === "typeA" || pose === "typeB";
  const legTop = seated ? 99 : 12; // seated: no visible legs (desk occludes)

  if (!seated) {
    // Legs: two columns; walk frames lift alternate feet by one unit.
    const liftA = pose === "stepA" ? 1 : 0;
    const liftB = pose === "stepB" ? 1 : 0;
    u(g, 6, legTop, 2, 4 - liftA, trousers);
    u(g, 8, legTop, 2, 4 - liftB, trousers);
    if (liftA) u(g, 6, 15 - liftA, 2, 1, INK[900], 0.35);
    if (liftB) u(g, 8, 15 - liftB, 2, 1, INK[900], 0.35);
  }

  // Torso (seated sits one unit lower so the desk line reads right).
  const torsoY = seated ? 8 : 6;
  u(g, 5, torsoY, 6, 6 - (seated ? 1 : 0), shirt);
  u(g, 5, torsoY, 6, 1, CREAM_COLLAR); // collar
  u(g, 5, torsoY + (seated ? 4 : 5), 6, 1, trousers); // belt

  // Arms + hands.
  const armY = torsoY + 1;
  u(g, 4, armY, 1, 3, shirt);
  u(g, 11, armY, 1, 3, shirt);
  const handAY = pose === "typeA" ? armY + 3 : armY + 2;
  const handBY = pose === "typeB" ? armY + 3 : armY + 2;
  u(g, 4, handAY, 1, 1, skin);
  u(g, 11, handBY, 1, 1, skin);

  // Head.
  const headY = torsoY - 4;
  u(g, 5, headY, 6, 4, skin);

  // Hair + face by direction.
  if (dir === "up") {
    u(g, 4, headY - 1, 8, 5, hair); // back of the head is all hair
  } else {
    u(g, 4, headY - 1, 8, 2, hair); // cap
    if (dir === "side") {
      u(g, 4, headY + 1, 2, 3, hair); // hair falls at the back
      u(g, 10, headY + 2, 1, 1, INK[900]); // single eye, forward edge
    } else {
      u(g, 6, headY + 2, 1, 1, INK[900]); // two eyes
      u(g, 9, headY + 2, 1, 1, INK[900]);
    }
  }
}

/** Shirt collars, mugs, glyph fills — the white that reads on a sprite. */
const CREAM_COLLAR = CREAM[50];

function bakeFrame(
  renderer: Renderer,
  combo: PaletteCombo,
  dir: "down" | "up" | "side",
  pose: "stand" | "stepA" | "stepB" | "sit" | "typeA" | "typeB",
): Texture {
  return bakeTexture(renderer, FRAME_W, FRAME_H, (g) =>
    paintFrame(g, combo, dir, pose),
  );
}

function framesFor(combo: PaletteCombo): FrameSet {
  const key = `${combo.shirt}|${combo.skin}|${combo.hair}`;
  const hit = frameCache.get(key);
  if (hit) return hit;
  if (!rendererRef) throw new Error("initCharacterArt must run before actors");
  const set: FrameSet = {
    walk: {
      down: [
        bakeFrame(rendererRef, combo, "down", "stand"),
        bakeFrame(rendererRef, combo, "down", "stepA"),
        bakeFrame(rendererRef, combo, "down", "stepB"),
      ],
      up: [
        bakeFrame(rendererRef, combo, "up", "stand"),
        bakeFrame(rendererRef, combo, "up", "stepA"),
        bakeFrame(rendererRef, combo, "up", "stepB"),
      ],
      side: [
        bakeFrame(rendererRef, combo, "side", "stand"),
        bakeFrame(rendererRef, combo, "side", "stepA"),
        bakeFrame(rendererRef, combo, "side", "stepB"),
      ],
    },
    sit: bakeFrame(rendererRef, combo, "up", "sit"),
    type: [
      bakeFrame(rendererRef, combo, "up", "typeA"),
      bakeFrame(rendererRef, combo, "up", "typeB"),
    ],
  };
  frameCache.set(key, set);
  return set;
}

/* ------------------------------------------------------------------ */
/* Carry artifacts                                                     */
/* ------------------------------------------------------------------ */

function paintCarry(g: Parameters<typeof u>[0], kind: CarryKind): void {
  switch (kind) {
    case "mug":
      u(g, 0, 0, 3, 3, CREAM_COLLAR);
      u(g, 3, 1, 1, 1, CREAM_COLLAR); // handle
      u(g, 0, 0, 3, 1, ACCENTS.coral); // band
      break;
    case "paper":
      u(g, 0, 0, 4, 3, CREAM[100]);
      g.rect(0 * PX, 0, 4 * PX, 1).stroke({ color: INK[900], width: 1 });
      u(g, 1, 1, 2, 1, INK[300]);
      break;
    case "term":
      u(g, 0, 0, 4, 3, INK[900]);
      u(g, 1, 1, 2, 1, 0x89c4f4); // >_ glow
      break;
    case "globe":
      u(g, 0, 0, 4, 4, ACCENTS.sky);
      u(g, 1, 1, 2, 2, ACCENTS.mint);
      break;
    case "mag":
      u(g, 0, 1, 1, 1, ACCENTS.lemon);
      u(g, 2, 0, 1, 3, INK[300]); // magnifier stem
      u(g, 3, 0, 2, 2, ACCENTS.sky, 0.7); // glass
      break;
  }
}

/* ------------------------------------------------------------------ */
/* Actor                                                               */
/* ------------------------------------------------------------------ */

export interface CharacterOptions {
  name: string;
  shirt: number;
  skin: number;
  hair: number;
  tile: TilePoint;
}

export class Character {
  readonly root = new Container();

  private readonly sprite = new Sprite();
  private readonly carry = new Container();
  /**
   * Things that follow this character but are not part of it.
   *
   * Speech and tool bubbles track the character in world space and sort
   * above the entire floor, so they belong to the world container rather
   * than to `root` — the caller adds them next to the character and this
   * class destroys them again. See Bubble.attach().
   */
  readonly overlays: Container[];

  private readonly nameTag: Text;
  private readonly nameTagBg = new Graphics();
  /**
   * Name tags are shown on demand, not always.
   *
   * Five idle agents standing in the Break Room meant five overlapping
   * plates and an unreadable corner. A label earns its space when the
   * character is doing something, or when you are pointing at it.
   */
  private labelPinned = false;
  private labelHovered = false;
  private readonly glyphG = new Graphics();
  private readonly pipsG = new Graphics();
  private readonly toolBubble = new Bubble({ dark: true });
  private readonly sayBubble = new Bubble();

  private frames: FrameSet;
  private combo: PaletteCombo;
  private path: TilePoint[] = [];
  private tile: TilePoint;
  private facing: Facing = "down";
  private frameClock = 0;
  private frameIdx = 0;
  private idlePhase = 0;
  private working = false;
  private seated = false;
  private reduceMotion: boolean;
  private home: TilePoint;
  private nextRoamAt = 0;
  private accentColor: number;

  private carryKind: CarryKind | null = null;
  private glyph: "none" | "blocked" | "success" | "sleep" = "none";
  private glyphT = 0;
  private cheerT = -1;
  private pips: { done: number; total: number } | null = null;

  constructor(opts: CharacterOptions, reduceMotion: boolean) {
    this.tile = opts.tile;
    this.home = opts.tile;
    this.reduceMotion = reduceMotion;
    this.accentColor = opts.shirt;
    this.combo = { shirt: opts.shirt, skin: opts.skin, hair: opts.hair };
    this.frames = framesFor(this.combo);

    this.sprite.texture = this.frames.walk.down[0];
    // Anchors are normalised (0..1): the feet sit 2 device pixels above
    // the frame's bottom edge.
    this.sprite.anchor.set(0.5, (FRAME_H - 2 * PX) / FRAME_H);
    // Facing left mirrors the side frames; right uses them as painted.
    this.sprite.scale.x = 1;

    this.nameTag = new Text({
      text: opts.name,
      style: new TextStyle({
        fontFamily: "'Pixelify Sans', monospace",
        fontSize: 11,
        fill: INK[900],
        align: "center",
        padding: 2,
      }),
    });
    this.nameTag.anchor.set(0.5, 1);
    // Sits clear of the hair: the sprite's head tops out at -FRAME_H + 4.
    this.nameTag.y = -FRAME_H - 1;

    this.root.addChild(
      this.glyphG,
      this.sprite,
      this.carry,
      this.pipsG,
      this.nameTagBg,
      this.nameTag,
    );
    this.toolBubble.attach(this.root, 10);
    this.sayBubble.attach(this.root, -14);

    this.root.eventMode = "static";
    this.root.cursor = "pointer";

    this.overlays = [this.sayBubble.view, this.toolBubble.view];

    const p = tileCenterPx(this.tile);
    this.root.position.set(p.x, p.y);
    this.root.zIndex = p.y;
    this.drawNamePlate();
    this.syncLabel();
  }

  /* ---------------- public surface ---------------- */

  get currentTile(): TilePoint {
    return this.tile;
  }

  get isMoving(): boolean {
    return this.path.length > 0;
  }

  get homeTile(): TilePoint {
    return this.home;
  }

  get isWorking(): boolean {
    return this.working;
  }

  setHome(tile: TilePoint): void {
    this.home = tile;
  }

  setPath(path: TilePoint[]): void {
    this.path = path;
    if (this.seated && path.length) this.standUp();
    if (this.reduceMotion && path.length) {
      const last = path[path.length - 1];
      this.snapTo(last);
    }
  }

  placeAt(tile: TilePoint): void {
    this.path = [];
    this.snapTo(tile);
  }

  setWorking(working: boolean): void {
    if (this.working === working) return;
    this.working = working;
    if (!working) {
      this.setStatusGlyph("none");
      this.think(false);
      this.hideToolBubble();
      if (this.seated) this.standUp();
    }
    this.syncLabel();
  }

  /** Keeps this character's name visible — used for the selected agent. */
  setLabelPinned(pinned: boolean): void {
    this.labelPinned = pinned;
    this.syncLabel();
  }

  setLabelHovered(hovered: boolean): void {
    this.labelHovered = hovered;
    this.syncLabel();
  }

  private syncLabel(): void {
    const visible = this.working || this.labelPinned || this.labelHovered;
    this.nameTag.visible = visible;
    this.nameTagBg.visible = visible;
  }

  /** Re-tints the actor (theme/harness change) — rebakes or reuses frames. */
  retint(shirt: number, skin: number, hair: number, _nameColor: number): void {
    this.combo = { shirt, skin, hair };
    this.frames = framesFor(this.combo);
    this.accentColor = shirt;
    this.applyFrame();
  }

  /** Kept for call-site compatibility; the cream plate no longer re-tints. */
  setNameColor(_color: number): void {}

  setActivityColor(color: number): void {
    this.accentColor = color;
  }

  sitAtDesk(): void {
    if (this.seated) return;
    this.seated = true;
    this.facing = "up"; // desks face north
    this.applyFrame();
  }

  standUp(): void {
    if (!this.seated) return;
    this.seated = false;
    this.applyFrame();
  }

  setCarrying(kind: CarryKind | null): void {
    if (this.carryKind === kind) return;
    this.carryKind = kind;
    this.carry.removeChildren().forEach((c) => c.destroy());
    if (kind) {
      const g = new Graphics();
      paintCarry(g, kind);
      g.x = -6;
      g.y = -22;
      this.carry.addChild(g);
    }
  }

  setStatusGlyph(glyph: "none" | "blocked" | "success" | "sleep"): void {
    this.glyph = glyph;
    this.glyphT = 0;
    this.glyphG.clear();
  }

  cheer(): void {
    if (this.reduceMotion) return;
    this.cheerT = 0;
  }

  say(text: string | null, tabColor?: number): void {
    if (!text) {
      this.sayBubble.startFadeOut();
      return;
    }
    this.sayBubble.show(text, tabColor ?? this.accentColor);
  }

  think(on: boolean): void {
    this.sayBubble.think(on);
  }

  showToolBubble(label: string, icon?: string): void {
    this.toolBubble.show(icon ? `${icon} ${label}` : label, this.accentColor);
  }

  hideToolBubble(): void {
    this.toolBubble.hide();
  }

  setBudgetPips(done: number | null, total: number): void {
    this.pips = done === null ? null : { done, total };
    this.pipsG.clear();
  }

  wantsToRoam(now: number): boolean {
    return (
      !this.reduceMotion &&
      !this.seated &&
      this.path.length === 0 &&
      now >= this.nextRoamAt
    );
  }

  scheduleRoam(now: number, minMs: number, maxMs: number): void {
    this.nextRoamAt = now + minMs + Math.random() * (maxMs - minMs);
  }

  destroy(): void {
    this.sayBubble.detach();
    this.toolBubble.detach();
    // The overlays are not children of root, so they have to go explicitly
    // — guarded, because tearing the whole Application down destroys the
    // world's children first and this then runs over them a second time.
    for (const overlay of this.overlays) {
      if (!overlay.destroyed) overlay.destroy({ children: true });
    }
    if (!this.root.destroyed) this.root.destroy({ children: true });
  }

  /* ---------------- per-frame ---------------- */

  update(dt: number): void {
    if (this.cheerT >= 0) {
      this.cheerT += dt;
      const t = this.cheerT / 0.7;
      if (t >= 1) {
        this.cheerT = -1;
        this.glyphG.clear();
        if (this.glyph !== "none") this.drawStatusGlyph(); // restore glyph
      } else {
        this.root.position.y =
          tileCenterPx(this.tile).y - Math.sin(Math.PI * t) * 6;
        this.drawCheerStars();
      }
    }

    if (this.path.length) {
      const next = this.path[0];
      const target = tileCenterPx(next);
      const dx = target.x - this.root.x;
      const dy = target.y - this.root.y;
      const dist = Math.hypot(dx, dy);
      const step = MOTION.walkTilesPerSec * TILE * dt;

      if (dist <= step) {
        this.root.x = target.x;
        this.root.y = target.y;
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
      this.frameClock += dt * 1000;
      if (this.frameClock >= MOTION.frameMs) {
        this.frameClock %= MOTION.frameMs;
        this.frameIdx = (this.frameIdx + 1) % 3; // idle, A, B cycle
      }
      this.applyFrame();
      this.carry.y = Math.abs(Math.sin(this.frameClock / 40)) * -1.5;
      this.toolBubble.update(dt);
      this.sayBubble.update(dt);
      return;
    }

    // Standing / sitting still.
    this.frameIdx = 0;
    this.applyFrame();
    if (!this.reduceMotion) {
      this.idlePhase += dt * 2.2;
      this.sprite.y = Math.sin(this.idlePhase) * 0.5;
      if (this.working && this.seated) {
        this.frameClock += dt * 1000;
        if (this.frameClock >= MOTION.frameMs * 3) {
          this.frameClock %= MOTION.frameMs * 3;
          this.typeFlip = this.typeFlip === 0 ? 1 : 0;
          this.sprite.texture = this.frames.type[this.typeFlip];
        }
      }
    }

    if (this.glyph !== "none") {
      this.glyphT += dt;
      this.drawStatusGlyph();
    }
    if (this.pips) this.drawPips();

    this.toolBubble.update(dt);
    this.sayBubble.update(dt);
  }

  private typeFlip = 0;

  /* ---------------- internals ---------------- */

  private snapTo(tile: TilePoint): void {
    this.tile = tile;
    const p = tileCenterPx(tile);
    this.root.position.set(p.x, p.y);
    this.root.zIndex = p.y;
  }

  private applyFrame(): void {
    if (this.seated) {
      if (this.working) {
        this.sprite.texture = this.frames.type[this.typeFlip];
      } else {
        this.sprite.texture = this.frames.sit;
      }
      return;
    }
    const set =
      this.facing === "down"
        ? this.frames.walk.down
        : this.facing === "up"
          ? this.frames.walk.up
          : this.frames.walk.side;
    this.sprite.scale.x = this.facing === "left" ? -1 : 1;
    this.sprite.texture = set[this.isMoving ? this.frameIdx : 0];
  }

  private drawNamePlate(): void {
    const w = this.nameTag.width + 8;
    const h = 13;
    this.nameTagBg.clear();
    // A white chip with a hairline, matching the zone signposts. The old
    // near-black plate put a dark rectangle above every head, which on a
    // white floor read as the loudest thing in the room.
    this.nameTagBg
      .rect(-w / 2, this.nameTag.y - h, w, h)
      .fill({ color: CREAM_COLLAR, alpha: 0.96 })
      .stroke({ color: INK[300], width: 1 });
    this.nameTagBg
      .rect(-w / 2, this.nameTag.y - h, 3, h)
      .fill(this.accentColor);
  }

  private drawStatusGlyph(): void {
    const g = this.glyphG;
    const t = this.glyphT;
    g.clear();
    const y = -FRAME_H + 2;
    if (this.glyph === "blocked") {
      const pulse = 0.6 + 0.4 * Math.sin(t * 6);
      u(g, -2, y - 1, 4, 7, ACCENTS.coral, pulse);
      u(g, -1, y, 2, 3, CREAM_COLLAR);
      u(g, -1, y + 4, 2, 1, CREAM_COLLAR);
    } else if (this.glyph === "success") {
      const spin = (t * 2) % 1;
      u(g, -1, y - Math.sin(spin * Math.PI) * 4, 3, 3, ACCENTS.mint);
      u(g, 3, y + 1 - Math.cos(spin * Math.PI) * 3, 2, 2, ACCENTS.lemon);
    } else if (this.glyph === "sleep") {
      const drift = (t % 1.2) / 1.2;
      u(g, 2 + drift * 4, y - drift * 6, 2, 2, INK[300], 1 - drift * 0.8);
    }
  }

  private drawPips(): void {
    if (!this.pips) return;
    const g = this.pipsG;
    g.clear();
    const { done, total } = this.pips;
    const shown = Math.min(total, 6);
    const hot = total > 0 && done / total >= 0.8;
    for (let i = 0; i < shown; i++) {
      const filled = done >= Math.ceil((total * (i + 1)) / shown);
      u(
        g,
        -shown * 2 + i * 4,
        -FRAME_H - 4,
        3,
        2,
        filled ? (hot ? ACCENTS.coral : ACCENTS.mint) : INK[300],
      );
    }
  }

  private drawCheerStars(): void {
    const g = this.glyphG;
    const t = (this.cheerT % 0.35) / 0.35;
    g.clear();
    for (let i = 0; i < 4; i++) {
      const ang = (i / 4) * Math.PI * 2 + this.cheerT * 3;
      const rad = 6 + t * 8;
      u(
        g,
        Math.round(Math.cos(ang) * rad),
        -FRAME_H + Math.round(Math.sin(ang) * rad * 0.6),
        2,
        2,
        i % 2 ? ACCENTS.lemon : ACCENTS.mint,
        1 - t * 0.7,
      );
    }
  }
}
