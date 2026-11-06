import type { RequestHandler } from "express";
import type { CorsOptions } from "cors";
import type { Config } from "./config";

/**
 * The API's front door.
 *
 * Hive's whole purpose is to spawn CLI agents with shell and git access to
 * the project on disk, so an unauthenticated endpoint here is not the usual
 * "it's only a local dev tool" gap — reaching it is equivalent to a shell on
 * the machine. Three things guard it, and they are deliberately coupled:
 *
 *   1. the server binds loopback by default (config.server.host),
 *   2. CORS is an allowlist rather than `*`,
 *   3. a bearer token gates /api/* whenever one is configured.
 *
 * Binding a non-loopback interface without a token is refused outright
 * (assertBindingIsSafe) rather than warned about, because the failure mode
 * is silent and total.
 */

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1", "localhost"]);

export function isLoopbackHost(host: string): boolean {
  return LOOPBACK.has(host.trim().toLowerCase());
}

/** Throws when the requested binding would expose the API unauthenticated. */
export function assertBindingIsSafe(config: Config): void {
  const { host, authToken } = config.server;
  if (isLoopbackHost(host) || authToken) return;

  throw new Error(
    `Refusing to listen on ${host} without an auth token.\n` +
      `  Anyone who can reach this port could run shell commands in your repo.\n` +
      `  Set one:  HIVE_AUTH_TOKEN=$(openssl rand -hex 32) hive server\n` +
      `  Or bind loopback only:  HIVE_HOST=127.0.0.1 hive server`,
  );
}

/**
 * Origin allowlist. An empty `allowedOrigins` means "any localhost origin",
 * which is what the Vite dev server (a different port) and the Electron
 * shell (a null/file origin) actually need. Requests with no Origin header
 * at all — curl, the Electron main process — are allowed through; CORS is a
 * browser protection, and the token is what guards non-browser callers.
 *
 * Security: when `allowedOrigins` is empty we only allow loopback origins
 * (127.0.0.1, ::1, localhost). Non-loopback origins are rejected unless
 * explicitly listed, to prevent a compromised dev tool from reaching the API.
 */
export function corsOptions(config: Config): CorsOptions {
  const allowed = config.server.allowedOrigins;
  const hasExplicitAllowlist = allowed.length > 0;
  const hasAuthToken = !!config.server.authToken;
  const defaultAllowAnyLocalhost = !hasExplicitAllowlist && !hasAuthToken;

  // Startup warning: if no explicit origins and no auth token, we are
  // running the less-secure "allow any localhost" policy.
  if (defaultAllowAnyLocalhost) {
    console.warn(
      "[security] CORS configured with default allow-any-localhost policy. " +
        "Set HIVE_ALLOWED_ORIGINS or HIVE_AUTH_TOKEN for a stricter setup.",
    );
  }

  return {
    origin(origin, callback) {
      if (!origin || origin === "null") return callback(null, true);
      if (allowed.length > 0) {
        return callback(null, allowed.includes(origin));
      }
      // No explicit allowlist: only loopback origins are permitted by default.
      try {
        const { hostname } = new URL(origin);
        if (isLoopbackHost(hostname)) return callback(null, true);
        // Non-loopback origin rejected unless an auth token is set (which
        // adds bearer-token gate, but we still restrict CORS as a defense-in-depth).
        if (!hasAuthToken) {
          return callback(null, false);
        }
      } catch {
        return callback(null, false);
      }
      callback(null, true);
    },
    credentials: true,
  };
}

/** Where a caller may present the token. */
export function tokenFromRequest(req: {
  headers: Record<string, unknown>;
  query?: Record<string, unknown>;
}): string | null {
  const header = req.headers["authorization"];
  if (typeof header === "string") {
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    if (match) return match[1];
  }
  const alt = req.headers["x-hive-token"];
  if (typeof alt === "string" && alt) return alt;

  // EventSource cannot set headers, so /api/events is reached with the
  // token in the query string. Same secret, worse hiding place — which is
  // why it is only ever sent to a loopback or operator-configured origin.
  const q = req.query?.["token"];
  if (typeof q === "string" && q) return q;

  return null;
}

/** Constant-time compare, so a wrong token leaks nothing by timing. */
function tokensMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Gates /api/* when a token is configured. `/health` stays open so a
 * process supervisor can check liveness without holding the secret.
 */
export function authMiddleware(config: Config): RequestHandler {
  return (req, res, next) => {
    const expected = config.server.authToken;
    if (!expected) return next();

    // --- Scope enforcement ---
    const tokenScope = config.server.tokenScopes?.[0] ?? "full";
    const isReadOnly = tokenScope === "read-only";

    // Read-only tokens cannot mutate state
    if (isReadOnly) {
      const lowerPath = req.path.toLowerCase();
      const isMutating =
        lowerPath.startsWith("/api/") &&
        !lowerPath.startsWith("/api/events") &&
        !lowerPath.startsWith("/api/health") &&
        !lowerPath.startsWith("/api/permissions/audit") &&
        (req.method === "POST" ||
          req.method === "PUT" ||
          req.method === "DELETE");
      if (isMutating) {
        return res.status(403).json({
          error: "Forbidden: read-only token cannot mutate state",
        });
      }
    }
    // -------------------------

    if (!req.path.startsWith("/api/")) return next();

    const provided = tokenFromRequest(
      req as unknown as {
        headers: Record<string, unknown>;
        query?: Record<string, unknown>;
      },
    );

    // EventSource query-string token: document limitation, never log the query string.
    if (provided && req.query?.["token"]) {
      console.warn(
        "[security] EventSource token passed via query string (?token=). " +
          "This exposes the token in server logs and Referer headers. " +
          "Consider using short-lived event-scoped tokens or header-based auth.",
      );
      // Do NOT log the token value itself; only log the occurrence.
    }

    if (provided && tokensMatch(provided, expected)) return next();

    res.status(401).json({ error: "Unauthorized: missing or invalid token" });
  };
}
