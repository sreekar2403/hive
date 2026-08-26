import { getDb } from "./db/database";
import { broadcast } from "./routes/events";
import { randomUUID } from "crypto";

/**
 * Messages between agents working the same session.
 *
 * Parallel agents each hold their own worktree, so nothing they write is
 * visible to the others until a merge. That isolation is the point — but it
 * leaves no way for one agent to say "I moved the config parser to
 * `src/config/parse.ts`" to another that is about to import it. This is
 * that channel: durable, per-session, addressed or broadcast, and readable
 * at the start of a task so an agent can be told what its peers have done.
 *
 * It is deliberately a mailbox rather than a chat. Agents are not
 * conversational with each other — they run to completion — so what they
 * need is a message waiting when they start, not a live exchange.
 */

export interface AgentMessage {
  id: string;
  sessionId: string;
  /** Task id of the sender. */
  fromTaskId: string;
  fromAgent: string;
  /** Task id of the recipient; null broadcasts to the session. */
  toTaskId: string | null;
  subject: string;
  body: string;
  createdAt: number;
  readAt: number | null;
}

let ready = false;

function ensureTable(): void {
  if (ready) return;
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      from_task_id TEXT NOT NULL,
      from_agent TEXT NOT NULL,
      to_task_id TEXT,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      read_at INTEGER
    )
  `);
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_agent_messages_session
       ON agent_messages (session_id, created_at)`,
  );
  ready = true;
}

/** How much of one message an agent's briefing will carry. */
const MAX_BODY_CHARS = 2000;

export function send(message: {
  sessionId: string;
  fromTaskId: string;
  fromAgent: string;
  toTaskId?: string | null;
  subject: string;
  body: string;
}): AgentMessage {
  ensureTable();
  const row: AgentMessage = {
    id: randomUUID(),
    sessionId: message.sessionId,
    fromTaskId: message.fromTaskId,
    fromAgent: message.fromAgent,
    toTaskId: message.toTaskId ?? null,
    subject: message.subject.slice(0, 200),
    // A message long enough to crowd out the prompt is not a message.
    body: message.body.slice(0, MAX_BODY_CHARS),
    createdAt: Date.now(),
    readAt: null,
  };

  getDb()
    .prepare(
      `INSERT INTO agent_messages
         (id, session_id, from_task_id, from_agent, to_task_id, subject, body, created_at, read_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    )
    .run(
      row.id,
      row.sessionId,
      row.fromTaskId,
      row.fromAgent,
      row.toTaskId,
      row.subject,
      row.body,
      row.createdAt,
    );

  // The Office floor draws this as an envelope flying between desks.
  broadcast("agent:message", {
    sessionId: row.sessionId,
    fromTaskId: row.fromTaskId,
    toTaskId: row.toTaskId,
    subject: row.subject,
  });

  return row;
}

function toMessage(r: Record<string, unknown>): AgentMessage {
  return {
    id: r.id as string,
    sessionId: r.session_id as string,
    fromTaskId: r.from_task_id as string,
    fromAgent: r.from_agent as string,
    toTaskId: (r.to_task_id as string | null) ?? null,
    subject: r.subject as string,
    body: r.body as string,
    createdAt: r.created_at as number,
    readAt: (r.read_at as number | null) ?? null,
  };
}

/**
 * What is waiting for one task: messages addressed to it, plus the
 * session's broadcasts. A task never receives its own messages back.
 */
export function inbox(
  sessionId: string,
  taskId: string,
  options: { unreadOnly?: boolean; limit?: number } = {},
): AgentMessage[] {
  ensureTable();
  const clauses = [
    "session_id = ?",
    "from_task_id != ?",
    "(to_task_id IS NULL OR to_task_id = ?)",
  ];
  const params: unknown[] = [sessionId, taskId, taskId];
  if (options.unreadOnly) clauses.push("read_at IS NULL");

  const rows = getDb()
    .prepare(
      `SELECT * FROM agent_messages
        WHERE ${clauses.join(" AND ")}
        ORDER BY created_at ASC
        LIMIT ?`,
    )
    .all(...params, options.limit ?? 50) as Array<Record<string, unknown>>;
  return rows.map(toMessage);
}

/** Every message in a session, for the UI. */
export function thread(sessionId: string, limit = 200): AgentMessage[] {
  ensureTable();
  const rows = getDb()
    .prepare(
      `SELECT * FROM agent_messages WHERE session_id = ?
        ORDER BY created_at ASC LIMIT ?`,
    )
    .all(sessionId, limit) as Array<Record<string, unknown>>;
  return rows.map(toMessage);
}

export function markRead(ids: string[]): void {
  if (ids.length === 0) return;
  ensureTable();
  const now = Date.now();
  const statement = getDb().prepare(
    "UPDATE agent_messages SET read_at = ? WHERE id = ? AND read_at IS NULL",
  );
  for (const id of ids) statement.run(now, id);
}

/**
 * The inbox as a prompt preamble, or empty when there is nothing waiting.
 *
 * Reading marks the messages read: an agent is told each thing once, so a
 * retry of the same task does not re-litigate what a peer already said.
 */
export function briefingFor(sessionId: string, taskId: string): string {
  const waiting = inbox(sessionId, taskId, { unreadOnly: true, limit: 10 });
  if (waiting.length === 0) return "";

  const lines = ["=== Messages from other agents on this task ==="];
  for (const message of waiting) {
    lines.push(`from ${message.fromAgent}: ${message.subject}`);
    if (message.body.trim()) lines.push(message.body.trim());
  }
  lines.push("=== End messages ===");

  markRead(waiting.map((m) => m.id));
  return lines.join("\n");
}
