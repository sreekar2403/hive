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

/** Subscribes to the server's SSE stream. Returns an unsubscribe function. */
export function subscribeToEvents(
  onEvent: (type: string, data: unknown) => void,
): () => void {
  const source = new EventSource(`${API_BASE}/api/events`);

  const forward = (type: string) => (e: MessageEvent) => {
    try {
      onEvent(type, JSON.parse(e.data));
    } catch {
      onEvent(type, e.data);
    }
  };

  source.onmessage = forward("message");
  for (const type of [
    "task:started",
    "task:completed",
    "task:failed",
    "task:progress",
    "agent:update",
    "schedule:fired",
    "log",
  ]) {
    source.addEventListener(type, forward(type));
  }

  return () => source.close();
}
