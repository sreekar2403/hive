import { getDb } from "./db/database";

/**
 * Durable chat conversations.
 *
 * The client owns session ids and replays them with every message, but the
 * server is what assembles the history a harness is given. Keeping that
 * history in memory meant a server restart silently started the
 * conversation over — the model saw a first message that wasn't one. These
 * two tables are the durable copy.
 */

export interface ChatMessageRow {
  id: number;
  sessionId: string;
  role: "user" | "assistant";
  content: string;
  taskId: string | null;
  status: string | null;
  createdAt: number;
}

export interface ChatSessionRow {
  id: string;
  projectId: string | null;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessageRow[];
}

let ready = false;

function ensureTables(): void {
  if (ready) return;
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      task_id TEXT,
      status TEXT,
      created_at INTEGER NOT NULL
    )
  `);
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_chat_messages_session
       ON chat_messages (session_id, id)`,
  );
  ready = true;
}

/** Returns the session, creating it if this id has not been seen before. */
export function ensureSession(
  sessionId: string,
  projectId: string | null,
): ChatSessionRow {
  ensureTables();
  const db = getDb();
  const now = Date.now();
  db.prepare(
    `INSERT INTO chat_sessions (id, project_id, created_at, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       updated_at = excluded.updated_at,
       -- A session belongs to one project; the first one that claims it wins.
       project_id = COALESCE(chat_sessions.project_id, excluded.project_id)`,
  ).run(sessionId, projectId, now, now);
  return getSession(sessionId)!;
}

export function getSession(sessionId: string): ChatSessionRow | null {
  ensureTables();
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM chat_sessions WHERE id = ?")
    .get(sessionId) as
    | {
        id: string;
        project_id: string | null;
        created_at: number;
        updated_at: number;
      }
    | undefined;
  if (!row) return null;
  return {
    id: row.id,
    projectId: row.project_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    messages: recentMessages(sessionId, 200),
  };
}

export function appendMessage(
  sessionId: string,
  message: {
    role: "user" | "assistant";
    content: string;
    taskId?: string | null;
    status?: string | null;
  },
): void {
  ensureTables();
  const db = getDb();
  const now = Date.now();
  db.prepare(
    `INSERT INTO chat_messages (session_id, role, content, task_id, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    sessionId,
    message.role,
    message.content ?? "",
    message.taskId ?? null,
    message.status ?? null,
    now,
  );
  db.prepare("UPDATE chat_sessions SET updated_at = ? WHERE id = ?").run(
    now,
    sessionId,
  );
}

/** The tail of a conversation, oldest first — what a harness is shown. */
export function recentMessages(
  sessionId: string,
  limit = 10,
): ChatMessageRow[] {
  ensureTables();
  const rows = getDb()
    .prepare(
      `SELECT * FROM (
         SELECT * FROM chat_messages WHERE session_id = ?
         ORDER BY id DESC LIMIT ?
       ) ORDER BY id ASC`,
    )
    .all(sessionId, limit) as Array<{
    id: number;
    session_id: string;
    role: string;
    content: string;
    task_id: string | null;
    status: string | null;
    created_at: number;
  }>;
  return rows.map((r) => ({
    id: r.id,
    sessionId: r.session_id,
    role: r.role as "user" | "assistant",
    content: r.content,
    taskId: r.task_id,
    status: r.status,
    createdAt: r.created_at,
  }));
}

/**
 * One live native harness session per Hive chat.
 *
 * A Hive chat (`chat_sessions.id`) keeps talking to CLIs that each manage
 * their own session state (`claude --resume <id>`, `opencode run
 * --session <id>`, `codex exec resume <id>`, `pi --session <id>` …).
 * This table is the mapping between the two: which native session the
 * chat's next turn should resume.
 *
 * Exactly one row per chat — a harness switch overwrites it rather than
 * adding a second row. Switching back later starts fresh (with transcript
 * history), it does not resurrect the older native session. That is a
 * deliberate choice: resuming a stale session the transcript has moved
 * past would fork its context in surprising ways.
 */

export interface HarnessSessionRow {
  harness: string;
  nativeSessionId: string;
}

function ensureHarnessSessionsTable(): void {
  ensureTables();
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS harness_sessions (
      hive_session_id TEXT PRIMARY KEY,
      harness TEXT NOT NULL,
      native_session_id TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
}

/** The native session this chat should resume, if any. */
export function getHarnessSession(
  hiveSessionId: string,
): HarnessSessionRow | null {
  ensureHarnessSessionsTable();
  const row = getDb()
    .prepare("SELECT * FROM harness_sessions WHERE hive_session_id = ?")
    .get(hiveSessionId) as
    | { harness: string; native_session_id: string }
    | undefined;
  if (!row) return null;
  return { harness: row.harness, nativeSessionId: row.native_session_id };
}

/** Records the native session a run just lived in, replacing any older one. */
export function setHarnessSession(
  hiveSessionId: string,
  harness: string,
  nativeSessionId: string,
): void {
  ensureHarnessSessionsTable();
  getDb()
    .prepare(
      `INSERT INTO harness_sessions
         (hive_session_id, harness, native_session_id, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(hive_session_id) DO UPDATE SET
         harness = excluded.harness,
         native_session_id = excluded.native_session_id,
         updated_at = excluded.updated_at`,
    )
    .run(hiveSessionId, harness, nativeSessionId, Date.now());
}

/** Forgets the mapping — the next turn starts fresh. */
export function clearHarnessSession(hiveSessionId: string): void {
  ensureHarnessSessionsTable();
  getDb()
    .prepare("DELETE FROM harness_sessions WHERE hive_session_id = ?")
    .run(hiveSessionId);
}
