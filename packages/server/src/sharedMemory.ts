import * as fs from "fs";
import * as path from "path";
import { Config } from "./config";

export interface SharedMemoryEntry {
  key: string;
  value: string;
  sessionId: string;
  createdAt: number;
  updatedAt: number;
}

/** Summary row for the sessions list — cheap enough to compute on every request. */
export interface SharedMemorySessionSummary {
  sessionId: string;
  entryCount: number;
  totalSize: number;
  lastModified: number;
}

// Session ids and keys become filesystem path segments, so they're restricted
// to a safe character set and can't be "." / ".." (which would otherwise let
// a caller escape the cache directory).
const SAFE_ID = /^[A-Za-z0-9._-]+$/;

function isSafeId(id: string): boolean {
  return typeof id === "string" && SAFE_ID.test(id) && id !== "." && id !== "..";
}

function assertSafeId(id: string, label: string): void {
  if (!isSafeId(id)) {
    throw new Error(`Invalid ${label}: ${JSON.stringify(id)}`);
  }
}

export class SharedMemory {
  private cacheDir: string;

  constructor(config: Config) {
    this.cacheDir = config.storage.cacheDir;
    this.ensureDir();
  }

  private ensureDir(): void {
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  async set(sessionId: string, key: string, value: string): Promise<void> {
    const entry: SharedMemoryEntry = {
      key,
      value,
      sessionId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const filePath = this.getFilePath(sessionId, key);
    fs.writeFileSync(filePath, JSON.stringify(entry, null, 2));
  }

  async get(sessionId: string, key: string): Promise<SharedMemoryEntry | null> {
    const filePath = this.getFilePath(sessionId, key);
    if (!fs.existsSync(filePath)) return null;

    try {
      const content = fs.readFileSync(filePath, "utf-8");
      return JSON.parse(content) as SharedMemoryEntry;
    } catch {
      return null;
    }
  }

  async delete(sessionId: string, key: string): Promise<void> {
    const filePath = this.getFilePath(sessionId, key);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }

  async list(sessionId: string): Promise<SharedMemoryEntry[]> {
    const sessionDir = this.getSessionDir(sessionId);
    if (!fs.existsSync(sessionDir)) return [];

    const files = fs.readdirSync(sessionDir);
    const entries: SharedMemoryEntry[] = [];

    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        const content = fs.readFileSync(path.join(sessionDir, file), "utf-8");
        entries.push(JSON.parse(content) as SharedMemoryEntry);
      } catch {
        // Skip invalid files
      }
    }

    return entries.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async getSessionFiles(sessionId: string): Promise<string[]> {
    const sessionDir = this.getSessionDir(sessionId);
    if (!fs.existsSync(sessionDir)) return [];
    return fs.readdirSync(sessionDir);
  }

  /** Lists every session that has at least one entry, newest activity first. */
  async listSessions(): Promise<SharedMemorySessionSummary[]> {
    this.ensureDir();
    const dirents = fs.readdirSync(this.cacheDir, { withFileTypes: true });
    const summaries: SharedMemorySessionSummary[] = [];

    for (const dirent of dirents) {
      if (!dirent.isDirectory() || !isSafeId(dirent.name)) continue;
      const entries = await this.list(dirent.name);
      if (entries.length === 0) continue;

      let totalSize = 0;
      let lastModified = 0;
      for (const entry of entries) {
        totalSize += Buffer.byteLength(entry.value, "utf-8");
        if (entry.updatedAt > lastModified) lastModified = entry.updatedAt;
      }

      summaries.push({
        sessionId: dirent.name,
        entryCount: entries.length,
        totalSize,
        lastModified,
      });
    }

    return summaries.sort((a, b) => b.lastModified - a.lastModified);
  }

  /** Deletes every entry for a session and removes its directory. */
  async deleteSession(sessionId: string): Promise<void> {
    const sessionDir = this.getSessionDir(sessionId);
    if (fs.existsSync(sessionDir)) {
      fs.rmSync(sessionDir, { recursive: true, force: true });
    }
  }

  private getSessionDir(sessionId: string): string {
    assertSafeId(sessionId, "sessionId");
    return path.join(this.cacheDir, sessionId);
  }

  private getFilePath(sessionId: string, key: string): string {
    assertSafeId(key, "key");
    const sessionDir = this.getSessionDir(sessionId);
    if (!fs.existsSync(sessionDir)) {
      fs.mkdirSync(sessionDir, { recursive: true });
    }
    return path.join(sessionDir, `${key}.json`);
  }
}
