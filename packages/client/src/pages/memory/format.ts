/** Formats a byte count as a short human-readable size (e.g. "1.4 KB"). */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unitIndex]}`;
}

/** Formats an epoch-ms timestamp as a short relative time (e.g. "3m ago"). */
export function formatRelativeTime(epochMs: number): string {
  const diffMs = Date.now() - epochMs;
  const diffSec = Math.round(diffMs / 1000);
  if (diffSec < 5) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHour = Math.round(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;
  const diffDay = Math.round(diffHour / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  return new Date(epochMs).toLocaleDateString();
}

/** Formats an epoch-ms timestamp as an absolute, typewritten-style timestamp. */
export function formatTimestamp(epochMs: number): string {
  return new Date(epochMs).toLocaleString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** True if the trimmed text looks like it opens a JSON object or array. */
export function looksLikeJson(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

/** Attempts to parse text as JSON, returning undefined on failure. */
export function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
