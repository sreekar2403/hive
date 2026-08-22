import { useEffect, useRef } from "react";
import { Application, Graphics, Text, Container } from "pixi.js";

const TILE_SIZE = 48;
const GRID_COLS = 16;
const GRID_ROWS = 12;

const furniture = [
  { x: 2, y: 2, w: 2, h: 1, color: 0x8b4513, label: "Desk 1" },
  { x: 5, y: 2, w: 2, h: 1, color: 0x8b4513, label: "Desk 2" },
  { x: 8, y: 2, w: 2, h: 1, color: 0x8b4513, label: "Desk 3" },
  { x: 11, y: 2, w: 2, h: 1, color: 0x8b4513, label: "Desk 4" },
  { x: 2, y: 5, w: 2, h: 1, color: 0x8b4513, label: "Desk 5" },
  { x: 5, y: 5, w: 2, h: 1, color: 0x8b4513, label: "Desk 6" },
  { x: 10, y: 7, w: 4, h: 3, color: 0x4a5568, label: "Meeting Room" },
  { x: 1, y: 8, w: 2, h: 1, color: 0x92400e, label: "Coffee" },
  { x: 13, y: 1, w: 2, h: 2, color: 0x1e3a5f, label: "Server Room" },
];

// Desk positions (center of each desk) for agents to target
const deskTargets = [
  { x: 3, y: 2 }, // Desk 1 center
  { x: 6, y: 2 }, // Desk 2 center
  { x: 9, y: 2 }, // Desk 3 center
  { x: 12, y: 2 }, // Desk 4 center
  { x: 3, y: 5 }, // Desk 5 center
  { x: 6, y: 5 }, // Desk 6 center
  { x: 12, y: 8 }, // Meeting Room center-ish
  { x: 2, y: 8 }, // Coffee center
  { x: 14, y: 2 }, // Server Room center
];

const agents = [
  { id: "opencode", name: "opencode", initials: "OC", color: 0x00d4aa },
  { id: "claude-code", name: "claude-code", initials: "CC", color: 0xff6b35 },
  { id: "pi", name: "pi", initials: "PI", color: 0x6366f1 },
  { id: "hive", name: "hive", initials: "HV", color: 0xf59e0b },
];

export function OfficeFloorPage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const agentsRef = useRef<
    Array<{
      container: Container;
      graphics: Graphics;
      label: Text;
      statusDot: Graphics;
      targetX: number;
      targetY: number;
      currentX: number;
      currentY: number;
      waitTimer: number;
      isMoving: boolean;
      agentData: (typeof agents)[0];
    }>
  >([]);

  useEffect(() => {
    if (!containerRef.current) return;
    const parent = containerRef.current;

    const app = new Application();
    appRef.current = app;

    (async () => {
      await app.init({
        background: 0x0a0a0a,
        resizeTo: parent,
        antialias: true,
      });
      parent.appendChild(app.canvas as HTMLCanvasElement);

      const world = new Container();
      world.x = parent.clientWidth / 2 - (GRID_COLS * TILE_SIZE) / 2;
      world.y = parent.clientHeight / 2 - (GRID_ROWS * TILE_SIZE) / 2;
      app.stage.addChild(world);

      const floor = new Graphics();
      for (let r = 0; r < GRID_ROWS; r++) {
        for (let c = 0; c < GRID_COLS; c++) {
          const color = (r + c) % 2 === 0 ? 0x1a1a2e : 0x16213e;
          floor
            .rect(c * TILE_SIZE, r * TILE_SIZE, TILE_SIZE - 1, TILE_SIZE - 1)
            .fill(color);
        }
      }
      world.addChild(floor);

      furniture.forEach((item) => {
        const g = new Graphics();
        g.rect(
          item.x * TILE_SIZE,
          item.y * TILE_SIZE,
          item.w * TILE_SIZE - 1,
          item.h * TILE_SIZE - 1,
        ).fill(item.color);
        g.eventMode = "static";
        g.cursor = "pointer";
        g.on("pointerover", () => {
          g.alpha = 0.8;
          g.tint = 0x60a5fa;
        });
        g.on("pointerout", () => {
          g.alpha = 1;
          g.tint = 0xffffff;
        });
        world.addChild(g);

        const label = new Text({
          text: item.label,
          style: { fontSize: 10, fill: 0xffffff, fontFamily: "monospace" },
        });
        label.x = item.x * TILE_SIZE + 4;
        label.y = item.y * TILE_SIZE + 4;
        world.addChild(label);
      });

      const wall = new Graphics();
      wall
        .rect(0, 0, GRID_COLS * TILE_SIZE, GRID_ROWS * TILE_SIZE)
        .stroke({ width: 2, color: 0x374151 });
      world.addChild(wall);

      // Create agent avatars
      agents.forEach((agentData, index) => {
        const agentContainer = new Container();

        // Initial random position
        const startTarget = deskTargets[index % deskTargets.length];
        const startX = startTarget.x * TILE_SIZE + TILE_SIZE / 2;
        const startY = startTarget.y * TILE_SIZE + TILE_SIZE / 2;

        // Agent circle graphics
        const graphics = new Graphics();
        const radius = 16;
        graphics.circle(0, 0, radius).fill(agentData.color);
        // Add a subtle border
        graphics
          .circle(0, 0, radius)
          .stroke({ width: 2, color: 0xffffff, alpha: 0.3 });
        agentContainer.addChild(graphics);

        // Agent initials text
        const initialsText = new Text({
          text: agentData.initials,
          style: {
            fontSize: 14,
            fill: 0x0a0a0a,
            fontFamily: "monospace",
            fontWeight: "bold",
          },
        });
        initialsText.anchor.set(0.5);
        initialsText.y = 1; // slight vertical center adjustment
        agentContainer.addChild(initialsText);

        // Agent name label below avatar
        const label = new Text({
          text: agentData.name,
          style: {
            fontSize: 10,
            fill: 0xe5e7eb,
            fontFamily: "monospace",
            fontWeight: "500",
          },
        });
        label.anchor.set(0.5, 0);
        label.y = radius + 4;
        agentContainer.addChild(label);

        // Status indicator dot (green = active, yellow = idle)
        const statusDot = new Graphics();
        statusDot.circle(radius + 4, -radius + 4, 5).fill(0x22c55e); // start as active (green)
        agentContainer.addChild(statusDot);

        // Set initial position
        agentContainer.x = startX;
        agentContainer.y = startY;

        world.addChild(agentContainer);

        agentsRef.current.push({
          container: agentContainer,
          graphics,
          label,
          statusDot,
          targetX: startX,
          targetY: startY,
          currentX: startX,
          currentY: startY,
          waitTimer: 0,
          isMoving: false,
          agentData,
        });
      });

      // Animation ticker for smooth agent movement
      const lerpFactor = 0.02; // movement speed
      const waitTimeRange = [3000, 5000]; // 3-5 seconds wait at desk

      app.ticker.add((ticker) => {
        const deltaTime = ticker.deltaTime * (1000 / 60); // convert to ms approx

        agentsRef.current.forEach((agent) => {
          const dx = agent.targetX - agent.currentX;
          const dy = agent.targetY - agent.currentY;
          const distance = Math.sqrt(dx * dx + dy * dy);

          if (distance > 1) {
            // Moving toward target
            agent.isMoving = true;
            agent.currentX += dx * lerpFactor;
            agent.currentY += dy * lerpFactor;
            agent.container.x = agent.currentX;
            agent.container.y = agent.currentY;

            // Update status to active (green)
            agent.statusDot.clear();
            agent.statusDot.circle(20, -12, 5).fill(0x22c55e);
          } else if (agent.isMoving) {
            // Just arrived at target
            agent.isMoving = false;
            agent.waitTimer = 0;

            // Update status to idle (yellow)
            agent.statusDot.clear();
            agent.statusDot.circle(20, -12, 5).fill(0xeab308);
          } else {
            // Waiting at desk
            agent.waitTimer += deltaTime;
            const waitDuration =
              waitTimeRange[0] +
              Math.random() * (waitTimeRange[1] - waitTimeRange[0]);

            if (agent.waitTimer >= waitDuration) {
              // Pick new random target
              const newTarget =
                deskTargets[Math.floor(Math.random() * deskTargets.length)];
              agent.targetX = newTarget.x * TILE_SIZE + TILE_SIZE / 2;
              agent.targetY = newTarget.y * TILE_SIZE + TILE_SIZE / 2;
            }
          }
        });
      });
    })();

    return () => {
      // Clean up ticker
      if (appRef.current?.ticker) {
        appRef.current.ticker.removeAll();
      }
      app.destroy(true, { children: true });
      appRef.current = null;
      agentsRef.current = [];
    };
  }, []);

  return <div ref={containerRef} className="w-full h-full" />;
}
