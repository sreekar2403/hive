/**
 * Shapes returned by the /api/memory endpoints. These mirror
 * `packages/server/src/routes/memory.ts` and `SharedMemory` — memory is a
 * per-session key/value store, one JSON file per key on disk, so there is
 * no richer schema to model than "a string value with timestamps".
 */

export interface MemorySessionSummary {
  sessionId: string;
  entryCount: number;
  totalSize: number;
  lastModified: number;
}

export interface MemoryEntrySummary {
  key: string;
  size: number;
  createdAt: number;
  updatedAt: number;
  preview: string;
}

export interface MemoryEntry {
  key: string;
  value: string;
  sessionId: string;
  createdAt: number;
  updatedAt: number;
}
