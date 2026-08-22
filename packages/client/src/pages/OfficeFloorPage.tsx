import { useEffect, useRef } from 'react';
import { Application, Graphics, Text, Container } from 'pixi.js';

const TILE_SIZE = 48;
const GRID_COLS = 16;
const GRID_ROWS = 12;

const furniture = [
  { x: 2, y: 2, w: 2, h: 1, color: 0x8B4513, label: 'Desk 1' },
  { x: 5, y: 2, w: 2, h: 1, color: 0x8B4513, label: 'Desk 2' },
  { x: 8, y: 2, w: 2, h: 1, color: 0x8B4513, label: 'Desk 3' },
  { x: 11, y: 2, w: 2, h: 1, color: 0x8B4513, label: 'Desk 4' },
  { x: 2, y: 5, w: 2, h: 1, color: 0x8B4513, label: 'Desk 5' },
  { x: 5, y: 5, w: 2, h: 1, color: 0x8B4513, label: 'Desk 6' },
  { x: 10, y: 7, w: 4, h: 3, color: 0x4A5568, label: 'Meeting Room' },
  { x: 1, y: 8, w: 2, h: 1, color: 0x92400E, label: 'Coffee' },
  { x: 13, y: 1, w: 2, h: 2, color: 0x1E3A5F, label: 'Server Room' },
];

export function OfficeFloorPage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const parent = containerRef.current;

    const app = new Application();
    appRef.current = app;

    (async () => {
      await app.init({ background: 0x0a0a0a, resizeTo: parent, antialias: true });
      parent.appendChild(app.canvas as HTMLCanvasElement);

      const world = new Container();
      world.x = parent.clientWidth / 2 - (GRID_COLS * TILE_SIZE) / 2;
      world.y = parent.clientHeight / 2 - (GRID_ROWS * TILE_SIZE) / 2;
      app.stage.addChild(world);

      const floor = new Graphics();
      for (let r = 0; r < GRID_ROWS; r++) {
        for (let c = 0; c < GRID_COLS; c++) {
          const color = (r + c) % 2 === 0 ? 0x1a1a2e : 0x16213e;
          floor.rect(c * TILE_SIZE, r * TILE_SIZE, TILE_SIZE - 1, TILE_SIZE - 1).fill(color);
        }
      }
      world.addChild(floor);

      furniture.forEach((item) => {
        const g = new Graphics();
        g.rect(item.x * TILE_SIZE, item.y * TILE_SIZE, item.w * TILE_SIZE - 1, item.h * TILE_SIZE - 1)
          .fill(item.color);
        g.eventMode = 'static';
        g.cursor = 'pointer';
        g.on('pointerover', () => { g.alpha = 0.8; g.tint = 0x60A5FA; });
        g.on('pointerout', () => { g.alpha = 1; g.tint = 0xFFFFFF; });
        world.addChild(g);

        const label = new Text({ text: item.label, style: { fontSize: 10, fill: 0xFFFFFF, fontFamily: 'monospace' } });
        label.x = item.x * TILE_SIZE + 4;
        label.y = item.y * TILE_SIZE + 4;
        world.addChild(label);
      });

      const wall = new Graphics();
      wall.rect(0, 0, GRID_COLS * TILE_SIZE, GRID_ROWS * TILE_SIZE).stroke({ width: 2, color: 0x374151 });
      world.addChild(wall);
    })();

    return () => {
      app.destroy(true, { children: true });
      appRef.current = null;
    };
  }, []);

  return <div ref={containerRef} className="w-full h-full" />;
}
