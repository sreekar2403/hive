import { Container, Graphics, Text, TextStyle } from "pixi.js";
import { ACCENTS, CREAM, INK } from "./retroTheme";

/**
 * Pixel speech bubbles for the office floor: a cream plate, a hard ink
 * outline and a colour tab — no radius, no blur. One class serves tool
 * calls (`< src/app.tsx`), thoughts (`…`) and mutterings alike.
 */

export const TOOL_ICON: Record<string, string> = {
  Read: "<",
  Edit: ">",
  Write: ">",
  Bash: "$",
  Grep: "?",
  Glob: "?",
  WebFetch: "@",
  WebSearch: "@",
  TodoWrite: "=",
};

const DEFAULT_ICON = "*";

export function toolIcon(tool: string): string {
  return TOOL_ICON[tool] ?? DEFAULT_ICON;
}

const PADDING_X = 7;
const PADDING_Y = 4;
const TAB_W = 4;
const MAX_WIDTH = 170;
const OFFSET_Y = -34;
const FADE_IN = 0.12;
const FADE_OUT = 0.28;
const THINK_CYCLE = 0.42;

type BubbleState = "hidden" | "in" | "visible" | "out";

export interface BubbleOptions {
  /** Wrap width in world px. */
  maxWidth?: number;
  /** Vertical offset from the owner's origin (its feet). */
  offsetY?: number;
  /** Dark variant for tool calls (ink plate, cream text). */
  dark?: boolean;
}

export class Bubble {
  readonly view = new Container();

  private readonly bg = new Graphics();
  private readonly label = new Text({
    style: new TextStyle({
      fontFamily: "'VT323', 'Pixelify Sans', monospace",
      fontSize: 16,
      fill: INK[900],
      wordWrap: true,
      breakWords: true,
      padding: 4,
    }),
  });

  private state: BubbleState = "hidden";
  private fade = 0;
  private thinkMode = false;
  private thinkT = 0;
  private owner: Container | null = null;
  private offsetX = 0;
  private offsetY: number;
  private maxWidth: number;
  private dark: boolean;
  private tabColor: number = ACCENTS.sky;
  private bgW = 0;
  private bgH = 0;

  constructor(opts: BubbleOptions = {}) {
    this.maxWidth = opts.maxWidth ?? MAX_WIDTH;
    this.offsetY = opts.offsetY ?? OFFSET_Y;
    this.dark = opts.dark ?? false;

    this.view.eventMode = "none";
    this.view.zIndex = 1_000_000;
    this.view.alpha = 0;
    this.view.visible = false;
    this.label.style.fill = this.dark ? CREAM[50] : INK[900];
    this.label.x = PADDING_X + TAB_W;
    this.label.y = PADDING_Y;
    this.view.addChild(this.bg, this.label);
  }

  /**
   * Pin the bubble above its owner.
   *
   * The bubble follows the owner in *world* space and must live in the
   * world container, not under the owner: it carries a zIndex far above
   * everything on the floor so a speech plate is never buried by a wall, a
   * rack or a signpost. Parenting it to the character instead makes it
   * inherit that transform on top of the world coordinates computed here,
   * which put every bubble at twice its speaker's distance from the map
   * origin — Bullpen agents had their speech drawn over the Server Room.
   * Character.overlays is what keeps the two in the right place.
   */
  attach(owner: Container, offsetX = 8): void {
    this.owner = owner;
    this.offsetX = offsetX;
  }

  detach(): void {
    this.owner = null;
    this.hide();
  }

  show(text: string, tabColor?: number): void {
    if (!text) return;
    this.thinkMode = false;
    const clipped =
      text.length > 120 ? `${text.slice(0, 119).trimEnd()}…` : text;
    this.label.style.wordWrapWidth = this.maxWidth - PADDING_X * 2 - TAB_W;
    this.label.text = clipped;
    this.tabColor = tabColor ?? this.tabColor;
    this.redraw();
    this.reveal();
  }

  think(on: boolean): void {
    if (!on) {
      if (this.thinkMode) this.startFadeOut();
      return;
    }
    this.thinkMode = true;
    this.thinkT = 0;
    this.label.style.wordWrapWidth = this.maxWidth;
    this.label.text = ".";
    this.tabColor = ACCENTS.sky;
    this.redraw();
    this.reveal();
  }

  hide(): void {
    this.state = "hidden";
    this.thinkMode = false;
    this.view.alpha = 0;
    this.view.visible = false;
  }

  /** Advances fades + thinking dots; repositions onto the owner. */
  update(dt: number): void {
    if (this.thinkMode && (this.state === "visible" || this.state === "in")) {
      this.thinkT += dt;
      const phase = Math.floor(this.thinkT / THINK_CYCLE) % 3;
      const next = [".", "..", "..."][phase];
      if (next !== this.label.text) {
        this.label.text = next;
        this.redraw();
      }
    }

    if (this.state === "in") {
      this.fade += dt;
      this.view.alpha = Math.min(this.fade / FADE_IN, 1);
      if (this.view.alpha >= 1) this.state = "visible";
    } else if (this.state === "out") {
      this.fade += dt;
      this.view.alpha = Math.max(1 - this.fade / FADE_OUT, 0);
      if (this.view.alpha <= 0) this.hide();
    }

    if (this.owner && this.view.visible) {
      // Integer positions: the owner glides at fractional steps, and an
      // unrounded bubble resamples its text every frame — visible shimmer.
      this.view.x = Math.round(this.owner.x + this.offsetX - this.bgW / 2);
      this.view.y = Math.round(this.owner.y + this.offsetY - this.bgH);
    }
  }

  startFadeOut(): void {
    if (this.state === "hidden") return;
    this.state = "out";
    this.fade = 0;
  }

  private reveal(): void {
    if (this.state === "hidden" || this.state === "out") {
      this.state = "in";
      this.fade = 0;
      this.view.visible = true;
    } else {
      this.state = "visible";
      this.view.alpha = 1;
    }
  }

  private redraw(): void {
    this.bgW = this.label.width + PADDING_X * 2 + TAB_W;
    this.bgH = this.label.height + PADDING_Y * 2;
    const g = this.bg;
    g.clear();
    g.rect(0, 0, this.bgW, this.bgH).fill({
      color: this.dark ? INK[900] : CREAM[50],
    });
    g.rect(0, 0, this.bgW, this.bgH).stroke({
      color: this.dark ? INK[900] : INK[300],
      width: 1,
    });
    g.rect(0, 0, TAB_W, this.bgH).fill(this.tabColor);
  }
}
