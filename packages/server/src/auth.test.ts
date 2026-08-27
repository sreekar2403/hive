import { describe, it, expect } from "vitest";
import {
  assertBindingIsSafe,
  authMiddleware,
  corsOptions,
  isLoopbackHost,
  tokenFromRequest,
} from "./auth";
import { createDefaultConfig } from "./config";

function configWith(server: Partial<ReturnType<typeof createDefaultConfig>["server"]>) {
  const config = createDefaultConfig();
  config.server = { ...config.server, ...server };
  return config;
}

/** Minimal express-ish doubles — enough for the middleware's surface. */
function fakeRes() {
  const res = {
    statusCode: 0,
    body: null as unknown,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      res.body = payload;
      return res;
    },
  };
  return res;
}

describe("binding safety", () => {
  it("defaults to loopback", () => {
    expect(createDefaultConfig().server.host).toBe("127.0.0.1");
  });

  it("allows loopback without a token", () => {
    expect(() => assertBindingIsSafe(configWith({ host: "127.0.0.1" }))).not.toThrow();
    expect(() => assertBindingIsSafe(configWith({ host: "::1" }))).not.toThrow();
    expect(() => assertBindingIsSafe(configWith({ host: "localhost" }))).not.toThrow();
  });

  it("refuses a public bind with no token", () => {
    // The API spawns shell agents; an open port here is a shell on the box.
    expect(() => assertBindingIsSafe(configWith({ host: "0.0.0.0" }))).toThrow(
      /Refusing to listen/,
    );
  });

  it("allows a public bind once a token is set", () => {
    expect(() =>
      assertBindingIsSafe(configWith({ host: "0.0.0.0", authToken: "secret" })),
    ).not.toThrow();
  });

  it("knows what loopback means", () => {
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("LOCALHOST")).toBe(true);
    expect(isLoopbackHost("192.168.1.20")).toBe(false);
    expect(isLoopbackHost("0.0.0.0")).toBe(false);
  });
});

describe("authMiddleware", () => {
  const req = (headers: Record<string, string>, path = "/api/chat") =>
    ({ headers, path, query: {} }) as never;

  it("is a no-op when no token is configured", () => {
    const mw = authMiddleware(configWith({ authToken: "" }));
    let called = false;
    mw(req({}), fakeRes() as never, () => {
      called = true;
    });
    expect(called).toBe(true);
  });

  it("rejects /api/* without the token", () => {
    const mw = authMiddleware(configWith({ authToken: "secret" }));
    const res = fakeRes();
    let called = false;
    mw(req({}), res as never, () => {
      called = true;
    });
    expect(called).toBe(false);
    expect(res.statusCode).toBe(401);
  });

  it("accepts a bearer token", () => {
    const mw = authMiddleware(configWith({ authToken: "secret" }));
    let called = false;
    mw(req({ authorization: "Bearer secret" }), fakeRes() as never, () => {
      called = true;
    });
    expect(called).toBe(true);
  });

  it("rejects a wrong token", () => {
    const mw = authMiddleware(configWith({ authToken: "secret" }));
    const res = fakeRes();
    mw(req({ authorization: "Bearer wrong!" }), res as never, () => {
      throw new Error("should not pass");
    });
    expect(res.statusCode).toBe(401);
  });

  it("leaves /health open so supervisors need no secret", () => {
    const mw = authMiddleware(configWith({ authToken: "secret" }));
    let called = false;
    mw(req({}, "/health"), fakeRes() as never, () => {
      called = true;
    });
    expect(called).toBe(true);
  });
});

describe("tokenFromRequest", () => {
  it("reads the Authorization header", () => {
    expect(
      tokenFromRequest({ headers: { authorization: "Bearer abc" } }),
    ).toBe("abc");
  });

  it("reads the query string, which is all EventSource can send", () => {
    expect(tokenFromRequest({ headers: {}, query: { token: "abc" } })).toBe("abc");
  });

  it("returns null when there is nothing to read", () => {
    expect(tokenFromRequest({ headers: {} })).toBeNull();
  });
});

describe("corsOptions", () => {
  const check = (config: ReturnType<typeof createDefaultConfig>, origin?: string) =>
    new Promise<boolean>((resolve, reject) => {
      const opts = corsOptions(config);
      (opts.origin as (o: string | undefined, cb: (e: Error | null, ok?: boolean) => void) => void)(
        origin,
        (err, ok) => (err ? reject(err) : resolve(Boolean(ok))),
      );
    });

  it("allows any localhost origin by default", async () => {
    const config = configWith({});
    // Vite's dev server runs on its own port.
    await expect(check(config, "http://localhost:5173")).resolves.toBe(true);
    await expect(check(config, "http://127.0.0.1:3001")).resolves.toBe(true);
  });

  it("rejects a remote origin by default", async () => {
    await expect(check(configWith({}), "https://evil.example")).resolves.toBe(false);
  });

  it("allows requests with no Origin at all", async () => {
    // curl and the Electron main process; the token guards those.
    await expect(check(configWith({}), undefined)).resolves.toBe(true);
  });

  it("honours an explicit allowlist", async () => {
    const config = configWith({ allowedOrigins: ["https://hive.example"] });
    await expect(check(config, "https://hive.example")).resolves.toBe(true);
    await expect(check(config, "http://localhost:5173")).resolves.toBe(false);
  });
});
