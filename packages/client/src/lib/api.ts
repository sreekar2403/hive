/**
 * Single place the client talks to the Hive server. Centralised so the
 * base URL and error shape are consistent everywhere (and so the Electron
 * build can point somewhere else without touching call sites).
 */
export const API_BASE =
  (import.meta.env?.VITE_API_BASE as string | undefined) ??
  "http://localhost:3001";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    ...init,
  });

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const payload = await res.json();
      if (payload?.error) message = payload.error;
    } catch {
      // Non-JSON error body; keep the status-based message.
    }
    throw new ApiError(message, res.status);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const API = {
  get: <T>(path: string, init?: RequestInit) =>
    request<T>("GET", path, undefined, init),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body),
  del: <T>(path: string) => request<T>("DELETE", path),
};

/* ------------------------------------------------------------------ */
/* Event stream                                                        */
/* ------------------------------------------------------------------ */

export type HiveEventType =
  | "message"
  | "task:started"
  | "task:completed"
  | "task:failed"
  | "task:progress"
  | "agent:update"
  | "schedule:fired"
  | "log"
  | "agent:activity"
  | "permission:request"
  | "permission:resolved";

const EVENT_TYPES: HiveEventType[] = [
  "task:started",
  "task:completed",
  "task:failed",
  "task:progress",
  "agent:update",
  "schedule:fired",
  "log",
  // Harness tool/thinking events, consumed by the Office floor's live layer.
  "agent:activity",
  // Permission escalations, consumed by the Conference Room approvals UI.
  "permission:request",
  "permission:resolved",
];

export type StreamStatus = "connecting" | "open" | "offline";

type EventListener = (type: string, data: unknown) => void;
type StatusListener = (status: StreamStatus) => void;

/**
 * One EventSource for the whole app, shared by every subscriber.
 *
 * Each page used to open its own connection, which cost real behaviour:
 * a browser allows only six concurrent connections per origin, so Chat +
 * Logs + Traces + Office between them could saturate the server's origin
 * and stall ordinary `fetch` calls — the page would sit there showing no
 * logs at all. It also meant that unmounting a page dropped the stream
 * and lost every event that arrived while you were elsewhere.
 */
const listeners = new Set<EventListener>();
const statusListeners = new Set<StatusListener>();

let source: EventSource | null = null;
let status: StreamStatus = "offline";
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = 1000;

function setStatus(next: StreamStatus) {
  if (status === next) return;
  status = next;
  for (const l of statusListeners) l(next);
}

function emit(type: string, raw: string) {
  let data: unknown = raw;
  try {
    data = JSON.parse(raw);
  } catch {
    // Non-JSON payloads (heartbeats, plain text) pass through as-is.
  }
  for (const l of listeners) l(type, data);
}

function openStream() {
  if (source || typeof EventSource === "undefined") return;
  setStatus("connecting");

  const es = new EventSource(`${API_BASE}/api/events`);
  source = es;

  es.onopen = () => {
    reconnectDelay = 1000;
    setStatus("open");
  };

  es.onmessage = (e) => emit("message", e.data);
  for (const type of EVENT_TYPES) {
    es.addEventListener(type, (e) => emit(type, (e as MessageEvent).data));
  }

  es.onerror = () => {
    // EventSource retries on its own while the connection merely drops,
    // but a closed stream (server restarted, refused) stays closed — so
    // reopen it here with a backoff instead of going quiet forever.
    if (es.readyState === EventSource.CLOSED) {
      es.close();
      if (source === es) source = null;
      setStatus("offline");
      scheduleReconnect();
    } else {
      setStatus("connecting");
    }
  };
}

function scheduleReconnect() {
  if (reconnectTimer || listeners.size === 0) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    reconnectDelay = Math.min(reconnectDelay * 2, 15000);
    openStream();
  }, reconnectDelay);
}

/**
 * Subscribes to the server's SSE stream. Returns an unsubscribe function.
 * The underlying connection is shared and outlives individual mounts, so
 * navigating between pages never drops it.
 */
export function subscribeToEvents(onEvent: EventListener): () => void {
  listeners.add(onEvent);
  openStream();
  return () => {
    listeners.delete(onEvent);
    // The connection is deliberately kept open: providers mounted above
    // the router keep long-lived subscriptions, and reconnect churn on
    // every navigation is what the shared stream exists to avoid.
  };
}

/** Subscribes to connection status; fires immediately with the current one. */
export function subscribeToStreamStatus(onStatus: StatusListener): () => void {
  statusListeners.add(onStatus);
  onStatus(status);
  return () => {
    statusListeners.delete(onStatus);
  };
}

export function getStreamStatus(): StreamStatus {
  return status;
}
