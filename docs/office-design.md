# Office floor — design canon

The `/office` page is a retro-pixel diorama of what the swarm is doing. Every
visual on it is drawn in code: **zero binary assets**. This file is the canon
for anyone changing it — the shipped design spec lives at
`docs/superpowers/specs/2026-08-25-office-retro-pixel-design.md`, the build
plan at `docs/superpowers/plans/2026-08-25-office-retro-pixel.md`.

Source lives in `packages/client/src/pages/office/`, composed by
`packages/client/src/pages/OfficeFloorPage.tsx`.

## The one rule

**No file invents a hex value.** Colours come from `retroTheme.ts`, chrome
colours from the `--rp-*` custom properties in `retro.css`. If a colour is
missing, add it to the token file rather than inlining it at the call site.

## Tokens

`retroTheme.ts` (pixi, numeric) and `retro.css` (`--rp-*`, DOM) hold the same
palette in two dialects:

| Group     | Members                                            | Used for                            |
| --------- | -------------------------------------------------- | ----------------------------------- |
| `CREAM`   | 50 / 100 / 200 / 300                               | the paper ramp: white → light grey  |
| `PAPER`   | 100                                                | dialog fill                         |
| `INK`     | 900 / 700 / 500 / 300 / 100                        | text, outlines (900 is the "black") |
| `ACCENTS` | coral, mint, sky, lemon, lilac, peach              | identity — shirts, zone stripes     |
| `STATUS`  | idle, thinking, working, waiting, blocked, success | agent state, badges, glyphs         |
| `WORLD`   | grass/wood light+dark, path, wall, desk top/edge   | the floor, and the furniture on it  |

Identity is stable, not decorative: `accentFor(harness)` maps
`opencode → sky`, `claude-code → coral`, `pi → lilac`, everything else lemon.
The same accent paints the agent's shirt, its roster dot and its envelopes, so
you can follow one agent across the whole page by colour alone.

**The floor is always daylight, and that daylight is white.** It renders the
same palette regardless of the app theme (spec decision D1). `.hive-retro`
therefore remaps the app's own theme tokens (`--hive-text`, `--hive-surface`,
…) onto this palette — a shared component like `PageHeader` paints with
`--hive-text`, which is near-white in dark mode and would vanish against it.

**Structure is carried by value, not hue.** The floor is a paper model of an
office, so its three surfaces sit a shade apart rather than a colour apart:
rooms are white, corridors a step below, the open floor outside a step below
that. Furniture has its own pair (`WORLD.deskTop` / `deskEdge`) precisely
because it must _not_ match the floor it stands on. The only saturated things
on the floor are the agents and the zone tints that identify their stage —
everything else gets out of their way.

**Chrome on the floor is a white card with a hairline** (`rp-card`), not the
triple-inset SNES panel (`rp-panel`). The heavy frame is kept for the approval
dialog, where interrupting you is the point; two heavy frames stacked over a
diorama is what made this view feel crowded.

**Labels appear on demand.** A character's name tag shows while it is working,
while it is selected, or while you point at it. Permanently labelling every
agent meant five overlapping plates as soon as the Break Room filled up.

## Type

Three fonts, loaded once in `packages/client/index.html`, scoped by the
`.hive-retro` wrapper class:

- **Press Start 2P** 14px/20 — `rp-title` only. Titles, never body copy.
- **Pixelify Sans** 13–16px — body text, labels, in-world signage.
- **VT323** 16px/18 — `rp-mono`: numbers, tool names, bubble text.

## Pixel discipline

- `PX = 2` in `pixelArt.ts` is the pixel unit. Authoring coordinates are in
  units, not screen pixels; `u(g, x, y, w, h, color)` paints one unit rect.
  A tile is `32 / PX = 16` units.
- Integer positions only — the camera rounds its world position every frame.
  A fractional offset shimmers under zoom.
- No border-radius, no blur, no gradients. Borders are layered inset
  box-shadows (`rp-panel`), shadows are hard 4px offsets.
- Static art bakes to a `RenderTexture` with `scaleMode = "nearest"`
  (`bakeTexture`), so zooming keeps hard edges instead of smearing.
- Chrome spacing snaps to 4px; in-world spacing snaps to the tile grid.

## Motion

`MOTION` in `retroTheme.ts` owns the numbers:

- `frameMs: 125` — 8fps sprite animation. Everything animated moves at 8fps;
  60fps motion reads as the wrong medium.
- `walkTilesPerSec: 2.6` — walk speed.
- `uiSnapMs: 200` — chrome snap-in.
- `cheerMinBusyMs: 45_000` — a task shorter than this earns no celebration.

**`prefers-reduced-motion` is honoured everywhere**: paths teleport, the idle
bob stops, particles are suppressed and the ambient director is disabled. Any
new motion must check `reduceMotion` at its source.

The camera (`camera.ts`) is lerped, never cut: `fitToScreen()` is the default,
selection focuses, a phase change _nudges_ (a decaying pan that does not steal
control). Manual wheel/drag latches `manual` and stops fit-on-resize.

## Copy

- Short, dry, human. "Nobody has clocked in", not "No agents available".
- Agents are named. "Cass is waiting on you", never "the agent is waiting".
- Status words are lowercase in badges (`working`, `idle`, `needs you`).
- Zone sublabels say what the _stage_ means, not what the code does:
  Intake → "Task queued", Conference Room → "Awaiting review".

## How to add a prop

1. Add the name to `PropKind` in `pixelArt.ts`.
2. Draw it in `drawProp`, in authoring units, using `WORLD`/`INK` tokens and
   `u()` / `boxOutline()`. It receives its footprint in tiles (`wTiles`,
   `hTiles`) — fill that box, don't hardcode a size.
3. Place it in `FURNITURE` in `layout.ts`, and block its footprint in
   `buildWalkableGrid` if agents shouldn't walk through it.
4. `layout.test.ts` asserts every zone slot stays reachable — run it.

Anything drawn in a container that also holds text **must not set `zIndex`**
on its children: in pixi v8 a child zIndex makes the parent sort, which will
happily paint a sign's plank over the sign's own label. Sort at the container
level (its foot line: `y * TILE`), not inside it.

## How to add a character frame

Frames are baked once per (shirt, skin, hair) combo in `character.ts` and
cached: `walk` (4 directions × 3 frames), `sit`, `type` (2 frames). To add a
pose, extend `FrameSet`, bake it in `framesFor`, and drive it from
`applyFrame()` — never mutate the sprite's texture from outside the actor.

Sprite anchors are **normalised (0–1)**. The feet anchor is
`(FRAME_H - 2 * PX) / FRAME_H`; passing raw pixels there launches the sprite
off-screen and leaves only its nametag visible.

## Testing conventions

Pure logic is unit-tested in node (no pixi, no DOM); the pixi and React
bindings live at the edges and are checked by eye:

| Module         | Tested                                                       |
| -------------- | ------------------------------------------------------------ |
| `layout.ts`    | grid dims, furniture blocking, rooms reachable via doors     |
| `camera.ts`    | `stepCamera` convergence, `clampCam` edges                   |
| `live.ts`      | `mapHarnessEvent` table, taskId→agentId routing              |
| `director.ts`  | FSM transitions, coffee sequence, cheer gate, reduced motion |
| `approvals.ts` | store against a stubbed `fetch`                              |

Keep it that way: if a new behaviour needs a canvas to be tested, the logic is
in the wrong file. Extract the decision, test it, and let the binding stay thin.

Run `pnpm test`, `pnpm lint` and `pnpm exec tsc --noEmit -p packages/client`
before calling a floor change done — then open the page and look at it. Three
of the bugs shipped into this file's first draft (invisible sprites, blank
signs, an invisible title in dark mode) type-checked and passed every test.
