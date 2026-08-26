import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The mailbox writes through the shared database handle and announces
// itself over SSE; both are replaced so these tests exercise the mailbox's
// own rules rather than sqlite's and express's.
const rows: Array<Record<string, unknown>> = [];

vi.mock("./routes/events", () => ({ broadcast: vi.fn() }));
vi.mock("./db/database", () => ({
  getDb: () => ({
    exec: () => {},
    prepare: (sql: string) => ({
      run: (...params: unknown[]) => {
        if (/^INSERT INTO agent_messages/i.test(sql)) {
          const [
            id,
            session_id,
            from_task_id,
            from_agent,
            to_task_id,
            subject,
            body,
            created_at,
          ] = params;
          rows.push({
            id,
            session_id,
            from_task_id,
            from_agent,
            to_task_id,
            subject,
            body,
            created_at,
            read_at: null,
          });
          return;
        }
        if (/^UPDATE agent_messages SET read_at/i.test(sql)) {
          const [readAt, id] = params;
          const row = rows.find((r) => r.id === id && r.read_at === null);
          if (row) row.read_at = readAt;
        }
      },
      all: (...params: unknown[]) => {
        // Enough of the WHERE clause to test the addressing rules.
        const [sessionId] = params;
        let result = rows.filter((r) => r.session_id === sessionId);
        if (sql.includes("from_task_id !=")) {
          const [, excludeTask, forTask] = params;
          result = result.filter(
            (r) =>
              r.from_task_id !== excludeTask &&
              (r.to_task_id === null || r.to_task_id === forTask),
          );
          if (sql.includes("read_at IS NULL")) {
            result = result.filter((r) => r.read_at === null);
          }
        }
        return result.sort(
          (a, b) => (a.created_at as number) - (b.created_at as number),
        );
      },
    }),
  }),
}));

const { briefingFor, inbox, send, thread } = await import("./agentMail");

describe("agentMail", () => {
  beforeEach(() => {
    rows.length = 0;
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("delivers a broadcast to every other task in the session", () => {
    send({
      sessionId: "s1",
      fromTaskId: "t1",
      fromAgent: "opencode",
      subject: "moved the parser",
      body: "it lives in src/config/parse.ts now",
    });

    expect(inbox("s1", "t2")).toHaveLength(1);
    expect(inbox("s1", "t3")).toHaveLength(1);
  });

  it("never delivers a message back to its sender", () => {
    send({
      sessionId: "s1",
      fromTaskId: "t1",
      fromAgent: "opencode",
      subject: "hello",
      body: "",
    });
    expect(inbox("s1", "t1")).toHaveLength(0);
  });

  it("keeps an addressed message away from everyone else", () => {
    send({
      sessionId: "s1",
      fromTaskId: "t1",
      fromAgent: "opencode",
      toTaskId: "t2",
      subject: "for you only",
      body: "",
    });

    expect(inbox("s1", "t2")).toHaveLength(1);
    expect(inbox("s1", "t3")).toHaveLength(0);
  });

  it("does not cross sessions", () => {
    send({
      sessionId: "s1",
      fromTaskId: "t1",
      fromAgent: "opencode",
      subject: "one",
      body: "",
    });
    expect(inbox("s2", "t2")).toHaveLength(0);
  });

  it("builds a briefing and marks what it read", () => {
    send({
      sessionId: "s1",
      fromTaskId: "t1",
      fromAgent: "claude-code",
      subject: "renamed the config loader",
      body: "loadConfig now takes a path",
    });

    const first = briefingFor("s1", "t2");
    expect(first).toContain("claude-code");
    expect(first).toContain("renamed the config loader");
    expect(first).toContain("loadConfig now takes a path");

    // Told once: a retry of the same task must not re-read it.
    expect(briefingFor("s1", "t2")).toBe("");
  });

  it("returns an empty briefing when nothing is waiting", () => {
    expect(briefingFor("s1", "t2")).toBe("");
  });

  it("truncates a body that would crowd out the prompt", () => {
    send({
      sessionId: "s1",
      fromTaskId: "t1",
      fromAgent: "pi",
      subject: "log dump",
      body: "x".repeat(5000),
    });
    expect(thread("s1")[0].body.length).toBe(2000);
  });
});
