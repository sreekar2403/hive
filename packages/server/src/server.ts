import express, { Express } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import http from "http";
import path from "path";
import fs from "fs";
import { Orchestrator } from "./orchestrator";
import { Config } from "./config";
import { SharedMemory } from "./sharedMemory";
import { Harness } from "@hive/shared/harness";

const chatSchema = z.object({
  message: z
    .string()
    .min(1, "Message is required")
    .max(20000, "Message too long (max 20000 chars)"),
  sessionId: z.string().max(200).optional(),
  projectId: z.string().max(200).nullable().optional(),
  harness: z.string().max(100).optional(),
  model: z.string().max(300).optional(),
  agent: z.string().max(100).optional(),
  attachments: z.array(z.string().max(300)).max(10).optional(),
});
import scheduleRoutes from "./routes/schedules";
import workflowRoutes from "./routes/workflows";
import projectRoutes from "./routes/projects";
import gitRoutes from "./routes/git";
import logRoutes from "./routes/logs";
import settingsRoutes from "./routes/settings";
import setupRoutes from "./routes/setup";
import memoryRoutes, { setSharedMemory } from "./routes/memory";
import { setGenerateDeps } from "./workflows/generate";
import agentRoutes from "./routes/agents";
import brainRoutes from "./routes/brain";
import modelRoutes from "./routes/models";
import capacityRoutes from "./routes/capacity";
import harnessRoutes from "./routes/harnesses";
import messageRoutes from "./routes/messages";
import { resolveModelRef } from "./models/catalog";
import { pruneAttachments, resolveAttachments } from "./attachments";
import { createKanbanCard, finishKanbanCard } from "./kanban";
import taskRoutes from "./routes/tasks";
import statsRoutes from "./routes/stats";
import updateRoutes, { startUpdateWatcher } from "./routes/updates";
import attachmentRoutes from "./routes/attachments";
import { startCronRunner } from "./scheduler/cronRunner";
import { recoverInterruptedRuns } from "./workflows/executor";
import eventsRouter, { broadcast } from "./routes/events";
import {
  appendMessage,
  ensureSession,
  getHarnessSession,
  getSession,
  recentMessages,
} from "./chatSessions";
import { registerTaskSession } from "./telemetry";
import { assertBindingIsSafe, authMiddleware, corsOptions } from "./auth";
import { getDb } from "./db/database";
import { getConfigPath } from "./config";
import { runGit } from "./branches";

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
  private harnesses: Map<string, Harness>;

  constructor(config: Config, harnesses: Map<string, Harness>) {
    this.config = config;
    this.harnesses = harnesses;
    this.sharedMemory = new SharedMemory(config);
    this.orchestrator = new Orchestrator(config, harnesses);
    this.app = express();
    setGenerateDeps({ config, harnesses });
  }

  async start(): Promise<void> {
    const app = this.app;

    // Log the resolved config path so operators can see which
    // hive.config.json is in effect. Warn if process.cwd() differs from
    // the config's directory — starting from elsewhere silently loads a
    // different (or no) config.
    const configPath = getConfigPath();
    console.log(`Using config: ${configPath}`);
    if (path.dirname(configPath) !== process.cwd()) {
      console.warn(
        `[config] hive.config.json resolved from ${configPath}, but ` +
          `process.cwd() is ${process.cwd()}. Start Hive from the repo root ` +
          "or run `hive` (which guarantees the right cwd) to avoid silent config drift.",
      );
    }

    // Attachments live in temp and are never referenced again once their
    // run is over, but nothing else would ever delete them — a daily
    // screenshot habit would quietly fill a disk.
    try {
      const removed = pruneAttachments();
      if (removed > 0) {
        console.log(`Removed ${removed} expired attachment(s)`);
      }
    } catch {
      // A reaper that cannot delete is not a reason to refuse to boot.
    }

    app.use(
      helmet({
        contentSecurityPolicy: false,
        crossOriginEmbedderPolicy: false,
      }),
    );
    app.use(cors(corsOptions(this.config)));
    // Attachments arrive as base64 in a JSON body, so the default 100kb
    // limit would reject every screenshot. The ceiling is the per-file limit
    // plus room for base64's ~33% overhead and the rest of the envelope.
    app.use(express.json({ limit: "32mb" }));
    // Basic abuse protection — generous for local use, but stops a retry storm
    // or a misbehaving script from hammering the model loop.
    app.use(
      "/api/v1/",
      rateLimit({
        windowMs: 60 * 1000,
        max: 120,
        standardHeaders: true,
        legacyHeaders: false,
      }),
    );
    app.use(
      "/api/v1/chat",
      rateLimit({
        windowMs: 60 * 1000,
        max: 20,
        standardHeaders: true,
        legacyHeaders: false,
        message: { error: "Too many chat requests, please slow down." },
      }),
    );
    // Gates /api/* whenever a token is configured; /health stays open.
    // Compatibility shim: redirect pre-v1 /api/* to /api/v1/* so existing
    // clients and MCP clients keep working after the versioned mount.
    // Placed before auth so unauthenticated callers are redirected rather
    // than rejected with 401.
    app.use("/api", (req, res) => {
      if (req.path.startsWith("/api/v1")) return;
      res.redirect(308, req.originalUrl.replace(/^\/api/, "/api/v1"));
    });
    app.use(authMiddleware(this.config));
    app.use(express.static(publicDir));

    // Chat endpoint
    app.post("/api/v1/chat", async (req, res) => {
      const parsed = chatSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: parsed.error.issues[0]?.message ?? "Invalid request",
        });
      }
      const {
        message,
        sessionId,
        projectId,
        harness,
        model,
        agent,
        attachments: attachmentIds,
      } = parsed.data;

      // The client owns its session ids and sends one with every message.
      // Adopting an id we haven't seen (a client that outlived a server
      // restart, say) has to work: the alternative was a 500 from pushing
      // onto a session record that was never created. The record lives in
      // SQLite, so a restart no longer restarts the conversation.
      const session =
        typeof sessionId === "string" && sessionId
          ? sessionId
          : this.generateId();
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
            // Ids, resolved to real paths here. One that has aged out is
            // skipped rather than failing the message — the person's text
            // is still worth running.
            attachments: resolveAttachments(attachmentIds),
            // Pass conversation history for context. The turn just
            // recorded is dropped — it is the prompt itself, and repeating
            // it as "history" made every message look like a reply to
            // itself.
            conversationHistory: recentMessages(session, 11)
              .slice(0, -1)
              .map((m) => ({ role: m.role, content: m.content })),
            // Resume candidate for the chat's native session. Whether it
            // is used is decided downstream where the actual harness is
            // known: the LoopEngine resumes only when the run lands on
            // the same harness (a switch runs fresh), and only when the
            // adapter declares a verified resume mechanism.
            resume: (() => {
              const stored = getHarnessSession(session);
              return stored
                ? { harness: stored.harness, sessionId: stored.nativeSessionId }
                : null;
            })(),
          },
        );

        // Every span this run opens is stamped with the conversation, so
        // the Logs screen can show one trace per chat instead of one per
        // message.
        registerTaskSession(task.id, session);

        // The board card for the request itself. A fan-out opens one more
        // per sub-agent from inside the Orchestrator, which is the only
        // place that knows they exist — see kanban.ts.
        if (projectId) {
          kanbanTaskId = createKanbanCard({
            projectId,
            prompt: message,
            harness: task.harness,
            runTaskId: task.id,
            sessionId: session,
            model: picked?.ref ?? null,
            branchName: `hive/${projectId}/${task.id}`,
          });
          // A fan-out's sub-agents hang their own cards off this one, and
          // the Orchestrator is the only place that knows they exist.
          task.kanbanCardId = kanbanTaskId;
        }

        broadcast("task:started", {
          sessionId: session,
          taskId: task.id,
          projectId: task.projectId,
          prompt: task.prompt,
        });

        const result = await this.orchestrator.executeTask(task.id);

        if (kanbanTaskId) {
          finishKanbanCard(kanbanTaskId, {
            status: result.status === "completed" ? "done" : "failed",
            iterations: result.iteration,
            files: task.filesChanged ?? [],
            output: result.output,
            error:
              result.status === "failed"
                ? (result.error ?? "Unknown error")
                : null,
          });
        }

        appendMessage(session, {
          role: "assistant",
          content: result.output,
          taskId: result.id,
          status: result.status,
        });

        broadcast(
          result.status === "failed" ? "task:failed" : "task:completed",
          {
            sessionId: session,
            taskId: result.id,
            projectId: result.projectId,
            harness: result.harness,
            status: result.status,
          },
        );

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
            finishKanbanCard(kanbanTaskId, {
              status: "failed",
              error: detail,
            });
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
    app.get("/api/v1/session/:sessionId", async (req, res) => {
      const session = getSession(req.params.sessionId);
      if (!session) {
        return res.status(404).json({ error: "Session not found" });
      }
      res.json(session);
    });

    // Workflow CRUD endpoints
    app.use("/api/v1/workflows", workflowRoutes);

    // Schedule CRUD endpoints
    app.use("/api/v1/schedules", scheduleRoutes);

    // Projects — the git working trees Hive operates on
    app.use("/api/v1/projects", projectRoutes);

    // Per-project git inspection (status, diff, branches)
    app.use("/api/v1/git", gitRoutes);

    // Structured logs and execution traces
    app.use("/api/v1/logs", logRoutes);

    // Providers, harnesses and task-model routing
    app.use("/api/v1/settings", settingsRoutes);

    // First-run setup: the router-model question and the soul.md it seeds.
    app.use("/api/v1/setup", setupRoutes);

    // What this machine can run at once, and what it is running
    app.use("/api/v1/capacity", capacityRoutes);

    // Are the CLIs installed, and do they still speak the stream we parse
    app.use("/api/v1/harnesses", harnessRoutes);

    // Messages between agents working the same session
    app.use("/api/v1/messages", messageRoutes);
    app.use("/api/v1/attachments", attachmentRoutes);

    // Shared memory browsing/editing
    setSharedMemory(this.sharedMemory);
    app.use("/api/v1/memory", memoryRoutes);

    // Live agent roster powering the Office floor
    app.use("/api/v1/agents", agentRoutes);

    // Second Brain — soul.md, the learned stores and the knowledge graph
    app.use("/api/v1/brain", brainRoutes);

    // Which models each harness and local server can actually run
    app.use("/api/v1/models", modelRoutes);

    // Kanban task board
    app.use("/api/v1/tasks", taskRoutes);

    // Dashboard observability: daily activity heatmap + growth stats
    app.use("/api/v1/stats", statsRoutes);

    // Is there a newer Hive? (the app updating itself, not the projects)
    app.use("/api/v1/updates", updateRoutes);

    // Permission request endpoints
    const permissionManager = this.orchestrator.getPermissionManager();

    app.get("/api/v1/permissions", (req, res) => {
      const sessionId =
        typeof req.query.sessionId === "string"
          ? req.query.sessionId
          : undefined;
      res.json(permissionManager.getPending(sessionId));
    });

    app.post("/api/v1/permissions/:id/approve", (req, res) => {
      const ok = permissionManager.approve(req.params.id);
      if (!ok) return res.status(404).json({ error: "Not found" });
      res.json({ approved: true });
    });

    app.post("/api/v1/permissions/:id/deny", (req, res) => {
      const ok = permissionManager.deny(req.params.id, req.body?.reason);
      if (!ok) return res.status(404).json({ error: "Not found" });
      res.json({ approved: false });
    });

    // Durable audit log of destructive-command decisions (full token scope only).
    app.get("/api/v1/permissions/audit", (req, res) => {
      const rawLimit = req.query.limit;
      const limit =
        typeof rawLimit === "string" && /^\d+$/.test(rawLimit)
          ? Math.min(Math.max(1, parseInt(rawLimit, 10)), 1000)
          : 200;
      res.json({ events: permissionManager.getAuditEvents(limit) });
    });

    // Revert a task's changes: restores the files a task touched via git
    // checkout / restore. Gated by the permission system (destructive) and
    // audit-logged. Only terminal tasks with recorded filesChanged can be
    // reverted.
    app.post("/api/v1/tasks/:id/revert", async (req, res) => {
      const taskId = req.params.id;
      const db = getDb();
      const row = db
        .prepare("SELECT * FROM kanban_tasks WHERE id = ?")
        .get(taskId) as
        | {
            id: string;
            project_id: string;
            files: string | null;
            status: string;
          }
        | undefined;
      if (!row) return res.status(404).json({ error: "Task not found" });

      let files: string[];
      try {
        const parsed = row.files ? JSON.parse(row.files) : [];
        files = Array.isArray(parsed)
          ? parsed.filter((f) => typeof f === "string")
          : [];
      } catch {
        files = [];
      }
      if (files.length === 0) {
        return res
          .status(400)
          .json({ error: "Task has no recorded files to revert" });
      }

      // Gate the revert through the permission system (destructive git op).
      const sessionId = `revert_${taskId}`;
      const command = `git checkout -- ${files.join(" ")}`;
      const approved = await permissionManager.checkPermission(
        sessionId,
        "revert",
        `Revert changes from task ${taskId} (${files.length} file(s))`,
        command,
        files,
      );
      if (!approved) {
        permissionManager.logAuditEvent(
          `revert_${Date.now()}`,
          sessionId,
          "revert",
          command,
          "denied",
          "permission denied or timed out",
          sessionId,
        );
        return res.status(403).json({ error: "Revert not approved" });
      }

      // Resolve the project's working tree.
      const project = db
        .prepare("SELECT path FROM projects WHERE id = ?")
        .get(row.project_id) as { path: string } | undefined;
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      // Run git checkout -- <files> in the project working tree.
      const result = runGit(["checkout", "--", ...files], project.path);
      if (!result.ok) {
        permissionManager.logAuditEvent(
          `revert_${Date.now()}`,
          sessionId,
          "revert",
          command,
          "denied",
          `git checkout failed: ${result.output}`,
          sessionId,
        );
        return res
          .status(500)
          .json({ error: `git checkout failed: ${result.output}` });
      }

      permissionManager.logAuditEvent(
        `revert_${Date.now()}`,
        sessionId,
        "revert",
        command,
        "approved",
        `Reverted ${files.length} file(s)`,
        sessionId,
      );

      res.json({ reverted: true, files });
    });

    // SSE events endpoint
    app.use("/api/v1/events", eventsRouter);

    // Root - serve the chat UI
    app.get("/", (req, res) => {
      res.sendFile(path.join(publicDir, "index.html"));
    });

    // Health check
    app.get("/health", (req, res) => {
      res.json({ status: "ok" });
    });

    const port = this.config.server.port;
    const host = this.config.server.host;
    // Fails fast rather than quietly exposing shell access to the network.
    assertBindingIsSafe(this.config);
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

    this.server.listen(port, host, () => {
      const scope = this.config.server.authToken
        ? "token required"
        : "no token — loopback only";
      console.log(`Hive server running on http://${host}:${port} (${scope})`);
      recoverInterruptedRuns();
      startCronRunner();
      this.stopUpdateWatcher = startUpdateWatcher();
    });
  }

  private stopUpdateWatcher: (() => void) | null = null;

  stop(): void {
    this.stopUpdateWatcher?.();
    this.stopUpdateWatcher = null;
    this.server?.close();
  }

  private generateId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }
}

export { HiveServer };
