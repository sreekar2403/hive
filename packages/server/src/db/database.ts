import Database from "better-sqlite3";
import * as path from "path";
import * as fs from "fs";

let db: Database.Database | null = null;

/**
 * Where the database lives.
 *
 * Under vitest this is an in-memory database, per worker process. Tests used
 * to write into the project's real `storage/cache/hive.db`: anything that
 * called `telemetry.log()` — routing, most of all — left rows behind in the
 * running app's data, and several worker processes opened the same WAL file
 * at once. `HIVE_DB_PATH` overrides it explicitly for anything else that
 * needs its own database.
 */
function databaseFile(): string {
  if (process.env.HIVE_DB_PATH) return process.env.HIVE_DB_PATH;
  if (process.env.VITEST) return ":memory:";

  const dataDir = path.join(
    __dirname,
    "..",
    "..",
    "..",
    "..",
    "storage",
    "cache",
  );
  fs.mkdirSync(dataDir, { recursive: true });
  return path.join(dataDir, "hive.db");
}

export function initDb(): Database.Database {
  if (db) return db;

  const file = databaseFile();
  db = new Database(file, { readonly: false });

  // WAL is a file-level mode; an in-memory database has no file to journal.
  if (file !== ":memory:") {
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = NORMAL");
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS workflows (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      nodes TEXT DEFAULT '[]',
      edges TEXT DEFAULT '[]',
      created_at INTEGER DEFAULT (CAST(strftime('%s', 'now') AS INTEGER) * 1000),
      updated_at INTEGER DEFAULT (CAST(strftime('%s', 'now') AS INTEGER) * 1000)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS schedules (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      cron_expression TEXT,
      calendar_date TEXT,
      workflow_id TEXT,
      status TEXT DEFAULT 'active',
      created_at INTEGER DEFAULT (CAST(strftime('%s', 'now') AS INTEGER) * 1000),
      updated_at INTEGER DEFAULT (CAST(strftime('%s', 'now') AS INTEGER) * 1000)
    )
  `);

  // One row per time a schedule actually fired, so the Schedule screen can
  // show real run history instead of inventing it client-side.
  db.exec(`
    CREATE TABLE IF NOT EXISTS schedule_runs (
      id TEXT PRIMARY KEY,
      schedule_id TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      finished_at INTEGER,
      duration_ms INTEGER
    )
  `);
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_schedule_runs_schedule_id ON schedule_runs(schedule_id)`,
  );

  // A project is a git working tree Hive operates on. Everything else in
  // the app (tasks, diffs, logs, schedules) is scoped to one of these.
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL,
      color TEXT,
      created_at INTEGER DEFAULT (CAST(strftime('%s', 'now') AS INTEGER) * 1000),
      updated_at INTEGER DEFAULT (CAST(strftime('%s', 'now') AS INTEGER) * 1000)
    )
  `);

  addColumnIfMissing(db, "schedules", "project_id", "TEXT");
  addColumnIfMissing(db, "schedules", "color", "TEXT");
  addColumnIfMissing(db, "workflows", "project_id", "TEXT");

  return db;
}

/**
 * Lightweight forward-migration helper. SQLite has no `ADD COLUMN IF NOT
 * EXISTS`, and this database predates several columns, so existing
 * installs need them added in place rather than via a table rebuild.
 */
function addColumnIfMissing(
  database: Database.Database,
  table: string,
  column: string,
  type: string,
): void {
  const columns = database
    .prepare(`PRAGMA table_info(${table})`)
    .all() as Array<{ name: string }>;
  if (columns.some((c) => c.name === column)) return;
  database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}

export function getDb(): Database.Database {
  return db ?? initDb();
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

export default { initDb, getDb, closeDb };
