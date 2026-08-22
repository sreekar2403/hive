import Database from 'better-sqlite3';

let db: Database.Database | null = null;

export function initDb() {
  if (db) return db;

  const path = require('path');
  const dataDir = path.join(__dirname, '..', '..', '..', '..', 'storage', 'cache');
  require('fs').mkdirSync(dataDir, { recursive: true });

  db = new Database(path.join(dataDir, 'hive.db'), { readonly: false });

  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');

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

  return db;
}

export function getDb(): Database.Database {
  if (!db) initDb();
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

export default { initDb, getDb, closeDb };