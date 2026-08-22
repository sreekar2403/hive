import * as fs from 'fs';
import * as path from 'path';
import { Config } from './config';

export interface SharedMemoryEntry {
  key: string;
  value: string;
  sessionId: string;
  createdAt: number;
  updatedAt: number;
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
      const content = fs.readFileSync(filePath, 'utf-8');
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
    const sessionDir = path.join(this.cacheDir, sessionId);
    if (!fs.existsSync(sessionDir)) return [];

    const files = fs.readdirSync(sessionDir);
    const entries: SharedMemoryEntry[] = [];

    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        const content = fs.readFileSync(path.join(sessionDir, file), 'utf-8');
        entries.push(JSON.parse(content) as SharedMemoryEntry);
      } catch {
        // Skip invalid files
      }
    }

    return entries.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async getSessionFiles(sessionId: string): Promise<string[]> {
    const sessionDir = path.join(this.cacheDir, sessionId);
    if (!fs.existsSync(sessionDir)) return [];
    return fs.readdirSync(sessionDir);
  }

  private getFilePath(sessionId: string, key: string): string {
    const sessionDir = path.join(this.cacheDir, sessionId);
    if (!fs.existsSync(sessionDir)) {
      fs.mkdirSync(sessionDir, { recursive: true });
    }
    const safeKey = key.replace(/[^\w-]/g, '_');
    return path.join(sessionDir, `${safeKey}.json`);
  }
}
