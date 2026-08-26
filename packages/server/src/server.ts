import express, { Express } from "express";
import cors from "cors";
import http from "http";
import path from "path";
import fs from "fs";
import { randomUUID } from "crypto";
import { Orchestrator } from "./orchestrator";
import { Config } from "./config";
import { SharedMemory } from "./sharedMemory";
import { Harness } from "@hive/shared/harness";
import { getDb } from "./db/database";
import scheduleRoutes from "./routes/schedules";
import workflowRoutes from "./routes/workflows";
import projectRoutes from "./routes/projects";
import gitRoutes from "./routes/git";
import logRoutes from "./routes/logs";
import settingsRoutes from "./routes/settings";
import memoryRoutes, { setSharedMemory } from "./routes/memory";
import agentRoutes from "./routes/agents";
import brainRoutes from "./routes/brain";
import modelRoutes from "./routes/models";
import capacityRoutes from "./routes/capacity";
import harnessRoutes from "./routes/harnesses";
import messageRoutes from "./routes/messages";
import { resolveModelRef } from "./models/catalog";
import taskRoutes from "./routes/tasks";
import { startCronRunner } from "./scheduler/cronRunner";
import eventsRouter, { broadcast } from "./routes/events";
import {
  appendMessage,
  ensureSession,
  getSession,
  recentMessages,
} from "./chatSessions";
import { registerTaskSession } from "./telemetry";

// Serve static files from public directory (works in both dev and compiled modes)
const publicDir = (() => {
  const devPath = path.join(__dirname, "public");
  if (fs.existsSync(devPath)) return devPath;
  return path.join(__dirname, "..", "src", "public");
})();

class HiveServer {
  private app: Express;
  private server: ReturnType<typeof http.createServer> | null = null;
  private orchestrator: Orchestrator;
  private sharedMemory: SharedMemory;
  private config: Config;

  constructor(config: Config, harnesses: Map<string, Harness>) {
    this.config = config;
    this.sharedMemory = new SharedMemory(config);
    this.orchestrator = new Orchestrator(config, harnesses);
    this.app = express();
  }

  async start(): Promise<void> {
    const app = this.app;

    app.use(cors());
    app.use(express.json());
    app.use(express.static(publicDir));

    // Chat endpoint
    app.post("/api/chat", async (req, res) => {
      const { message, sessionId, projectId, harness, model, agent } = req.body;

      if (!message) {
        return res.status(400).json({ error: "Message is required" });
      }

      // The client owns its session ids and sends one with every message.
      // Adopting an id we haven't seen (a client that outlived a server
      // restart, say) has to work: the alternative was a 500 from pushing
      // onto a session record that was never created. The record lives in
      // SQLite, so a restart no longer restarts the conversation.
      const session =
        typeof sessionId === "string" && sessionId ? sessionId : this.generateId();
      ensureSession(session, typeof projectId === "string" ? projectId : null);

      // The user's turn is recorded before the run, not after: a task that
      // crashes still happened, and the next message must see it.
      appendMessage(session, { role: "user", content: message });

      // Declared out here so the error path can close the card it opened.
      let kanbanTaskId: string | null = null;

      try {
        // A model picked in the UI arrives as a catalog id
        // (`harness/provider/model`); it names the harness as well as the
        // model, so picking one is enough to pin both.
        const picked =
          typeof model === "string" && model
            ? await resolveModelRef(model)
            : null;
        const chosenHarness =
          (typeof harness === "string" && harness ? harness : null) ??
          picked?.harness ??
          undefined;

        const task = await this.orchestrator.createTask(
          session,
          message,
          chosenHarness,
          typeof projectId === "string" ? projectId : null,
          {
            model: picked?.ref ?? null,
            agent: typeof agent === "string" && agent ? agent : null,
            // Pass conversation history for context. The turn just
            // recorded is dropped — it is the prompt itself, and repeating
            // it as "history" made every message look like a reply to
            // itself.
            conversationHistory: recentMessages(session, 11)
              .slice(0, -1)
              .map((m) => ({ role: m.role, content: m.content })),
          },
        );

        // Every span this run opens is stamped with the conversation, so
        // the Logs screen can show one trace per chat instead of one per
        // message.
        registerTaskSession(task.id, session);

        // Create a corresponding kanban task for tracking
        if (projectId) {
          const db = getDb();
          const now = Date.now();
          kanbanTaskId = randomUUID();
          const branchName = `hive/${projectId}/${kanbanTaskId}`;
          db.prepare(
            `INSERT INTO kanban_tasks
              (id, project_id, prompt, harness, status, branch_name, run_task_id, session_id, model, files, iterations, files_changed, output, error, started_at, completed_at, created_at, updated_at)
             VALUES (@id, @project_id, @prompt, @harness, @status, @branch_name, @run_task_id, @session_id, @model, @files, @iterations, @files_changed, @output, @error, @started_at, @completed_at, @created_at, @updated_at)`,
          ).run({
            id: kanbanTaskId,
            project_id: projectId,
            prompt: message.trim(),
            harness: task.harness,
            run_task_id: task.id,
            session_id: session,
            model: picked?.ref ?? null,
            files: null,
            status: "in_progress",
            branch_name: branchName,
            iterations: 0,
            files_changed: 0,
            output: null,
            error: null,
            started_at: now,
            completed_at: null,
            created_at: now,
            updated_at: now,
          });
        }

        broadcast("task:started", {
          sessionId: session,
          taskId: task.id,
          projectId: task.projectId,
          prompt: task.prompt,
        });

        const result = await this.orchestrator.executeTask(task.id);

        // Update kanban task with result
        if (kanbanTaskId && projectId) {
          const db = getDb();
          const completedAt = Date.now();
          db.prepare(
            `UPDATE kanban_tasks SET
               status = @status,
               iterations = @iterations,
               files_changed = @files_changed,
               files = @files,
               output = @output,
               error = @error,
               completed_at = @completed_at,
               updated_at = @updated_at
             WHERE id = @id`,
          ).run({
            id: kanbanTaskId,
            status: result.status === "completed" ? "done" : "failed",
            iterations: result.iteration,
            files_changed: task.filesChanged.length,
            files: JSON.stringify(task.filesChanged ?? []),
            output: result.output,
            error: result.status === "failed" ? (result.error ?? "Unknown error") : null,
            completed_at: completedAt,
            updated_at: completedAt,
          });
        }

        appendMessage(session, {
          role: "assistant",
          content: result.output,
          taskId: result.id,
          status: result.status,
        });

        broadcast(result.status === "failed" ? "task:failed" : "task:completed", {
          sessionId: session,
          taskId: result.id,
          projectId: result.projectId,
          harness: result.harness,
          status: result.status,
        });

        res.json({
          sessionId: session,
          taskId: result.id,
          status: result.status,
          output: result.output,
          harness: result.harness,
          model: result.model,
          events: result.events,
        });
      } catch (err) {
        // A run that threw leaves its board card mid-flight; close it out
        // rather than stranding the column on "in progress" forever.
        const detail = err instanceof Error ? err.message : String(err);
        if (kanbanTaskId) {
          try {
            const failedAt = Date.now();
            getDb()
              .prepare(
                `UPDATE kanban_tasks
                    SET status = 'failed', error = ?, completed_at = ?, updated_at = ?
                  WHERE id = ?`,
              )
              .run(detail, failedAt, failedAt, kanbanTaskId);
          } catch {
            // The board is a view onto the run, never the reason it failed.
          }
        }
        appendMessage(session, {
          role: "assistant",
          content: `The run could not be completed: ${detail}`,
          status: "failed",
        });
        broadcast("task:failed", {
          sessionId: session,
          error: err instanceof Error ? err.message : String(err),
        });
        res.status(500).json({
          error: "Failed to process request",
          details: err instanceof Error ? err.message : String(err),
        });
      }
    });

    // Session status endpoint
    app.get("/api/session/:sessionId", async (req, res) => {
      const session = getSession(req.params.sessionId);
      if (!session) {
        return res.status(404).json({ error: "Session not found" });
      }
      res.json(session);
    });

    // Workflow CRUD endpoints
    app.use("/api/workflows", workflowRoutes);

    // Schedule CRUD endpoints
    app.use("/api/schedules", scheduleRoutes);

    // Projects — the git working trees Hive operates on
    app.use("/api/projects", projectRoutes);

    // Per-project git inspection (status, diff, branches)
    app.use("/api/git", gitRoutes);

    // Structured logs and execution traces
    app.use("/api/logs", logRoutes);

    // Providers, harnesses and task-model routing
    app.use("/api/settings", settingsRoutes);

    // What this machine can run at once, and what it is running
    app.use("/api/capacity", capacityRoutes);

    // Are the CLIs installed, and do they still speak the stream we parse
    app.use("/api/harnesses", harnessRoutes);

    // Messages between agents working the same session
    app.use("/api/messages", messageRoutes);

    // Shared memory browsing/editing
    setSharedMemory(this.sharedMemory);
    app.use("/api/memory", memoryRoutes);

    // Live agent roster powering the Office floor
    app.use("/api/agents", agentRoutes);

    // Second Brain — soul.md, the learned stores and the knowledge graph
    app.use("/api/brain", brainRoutes);

    // Which models each harness and local server can actually run
    app.use("/api/models", modelRoutes);

    // Kanban task board
    app.use("/api/tasks", taskRoutes);

    // Permission request endpoints
    const permissionManager = this.orchestrator.getPermissionManager();

    app.get("/api/permissions", (req, res) => {
      const sessionId =
        typeof req.query.sessionId === "string" ? req.query.sessionId : undefined;
      res.json(permissionManager.getPending(sessionId));
    });

    app.post("/api/permissions/:id/approve", (req, res) => {
      const ok = permissionManager.approve(req.params.id);
      if (!ok) return res.status(404).json({ error: "Not found" });
      res.json({ approved: true });
    });

    app.post("/api/permissions/:id/deny", (req, res) => {
      const ok = permissionManager.deny(req.params.id, req.body?.reason);
      if (!ok) return res.status(404).json({ error: "Not found" });
      res.json({ approved: false });
    });

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

    const port = this.config.server.port;
    this.server = http.createServer(app);

    // Without a listener here, a busy port surfaces as an unhandled 'error'
    // event and a raw stack trace. Say what happened and how to fix it.
    this.server.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        console.error(
          `Port ${port} is already in use — another Hive server is probably still running.\n` +
            `  Find it:  netstat -ano | findstr :${port}\n` +
            `  Stop it:  taskkill /PID <pid> /F\n` +
            `  Or run Hive on a different port:  PORT=3002 pnpm dev:server`,
        );
      } else {
        console.error(`Server failed to start: ${err.message}`);
      }
      process.exit(1);
    });

    this.server.listen(port, () => {
      console.log(`Hive server running on port ${port}`);
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
