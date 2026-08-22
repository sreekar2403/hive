import express from "express";
import http from "http";
import path from "path";
import fs from "fs";
import { Orchestrator } from "./orchestrator";
import { Config } from "./config";
import { SharedMemory } from "./sharedMemory";
import { Harness } from "@hive/shared/harness";
import scheduleRoutes from "./routes/schedules";
import workflowRoutes from "./routes/workflows";
import { startCronRunner } from "./scheduler/cronRunner";
import eventsRouter from "./routes/events";

const app = express();
app.use(express.json());

// Serve static files from public directory (works in both dev and compiled modes)
const publicDir = (() => {
  const devPath = path.join(__dirname, "public");
  if (fs.existsSync(devPath)) return devPath;
  return path.join(__dirname, "..", "src", "public");
})();
app.use(express.static(publicDir));

class HiveServer {
  private server: ReturnType<typeof http.createServer> | null = null;
  private orchestrator: Orchestrator;
  private sharedMemory: SharedMemory;
  private config: Config;
  private sessions: Map<string, any>;

  constructor(config: Config, harnesses: Map<string, Harness>) {
    this.config = config;
    this.sessions = new Map();
    this.sharedMemory = new SharedMemory(config);
    this.orchestrator = new Orchestrator(config, harnesses);
  }

  async start(): Promise<void> {
    // Chat endpoint
    app.post("/api/chat", async (req, res) => {
      const { message, sessionId } = req.body;

      if (!message) {
        return res.status(400).json({ error: "Message is required" });
      }

      const session = sessionId || this.generateId();
      if (!sessionId) {
        this.sessions.set(session, {
          createdAt: Date.now(),
          messages: [],
        });
      }

      try {
        // Create and execute task
        const task = await this.orchestrator.createTask(session, message);
        const result = await this.orchestrator.executeTask(task.id);

        // Store session message
        const sessionData = this.sessions.get(session);
        sessionData.messages.push({
          role: "user",
          content: message,
          timestamp: Date.now(),
        });

        sessionData.messages.push({
          role: "assistant",
          content: result.output,
          taskId: result.id,
          status: result.status,
          timestamp: Date.now(),
        });

        res.json({
          sessionId: session,
          taskId: result.id,
          status: result.status,
          output: result.output,
        });
      } catch (err) {
        res.status(500).json({
          error: "Failed to process request",
          details: err instanceof Error ? err.message : String(err),
        });
      }
    });

    // Session status endpoint
    app.get("/api/session/:sessionId", async (req, res) => {
      const session = this.sessions.get(req.params.sessionId);
      if (!session) {
        return res.status(404).json({ error: "Session not found" });
      }
      res.json(session);
    });

    // Shared memory endpoint
    app.get("/api/memory/:sessionId", async (req, res) => {
      const memory = await this.sharedMemory.list(req.params.sessionId);
      res.json(memory);
    });

    // Workflow CRUD endpoints
    app.use("/api/workflows", workflowRoutes);

    // Schedule CRUD endpoints
    app.use("/api/schedules", scheduleRoutes);

    // SSE events endpoint
    app.use("/api/events", eventsRouter);

    // Root - serve the chat UI
    app.get("/", (req, res) => {
      res.sendFile(path.join(publicDir, "index.html"));
    });

    // Health check
    app.get("/health", (req, res) => {
      res.json({ status: "ok" });
    });

    this.server = http.createServer(app);
    this.server.listen(this.config.server.port, () => {
      console.log(`Hive server running on port ${this.config.server.port}`);
      startCronRunner();
    });
  }

  stop(): void {
    this.server?.close();
  }

  private generateId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }
}

export { HiveServer };
