import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import cors from "cors";
import type { AddressInfo } from "node:net";
import eventsRouter from "./events";
import { corsOptions } from "../auth";
import { createDefaultConfig } from "../config";

/**
 * /api/events must not set Access-Control-Allow-Origin: * — the cors
 * middleware's allowlist is the only origin policy for the event stream.
 */

let base = "";
let server: ReturnType<import("express").Application["listen"]> | null = null;

beforeAll(async () => {
  const app = express();
  app.use(cors(corsOptions(createDefaultConfig())));
  app.use("/api/events", eventsRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const { port } = server!.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  (server as unknown as { closeAllConnections?: () => void }).closeAllConnections?.();
  await new Promise<void>((resolve, reject) => {
    server!.close((err: unknown) => (err ? reject(err) : resolve()));
  });
});

async function openStream(origin: string | null): Promise<{
  status: number;
  allowOrigin: string | null;
  abort: () => void;
}> {
  const controller = new AbortController();
  const headers: Record<string, string> = {};
  if (origin !== null) headers.Origin = origin;
  const res = await fetch(`${base}/api/events`, {
    headers,
    signal: controller.signal,
  });
  return {
    status: res.status,
    allowOrigin: res.headers.get("access-control-allow-origin"),
    abort: () => controller.abort(),
  };
}

describe("SSE /api/events CORS", () => {
  it("does not emit a wildcard Access-Control-Allow-Origin", async () => {
    const stream = await openStream("https://evil.example");
    try {
      expect(stream.status).toBe(200);
      expect(stream.allowOrigin).not.toBe("*");
      expect(stream.allowOrigin).toBeNull();
    } finally {
      stream.abort();
    }
  });

  it("still allows a loopback origin through the allowlist", async () => {
    const stream = await openStream("http://localhost:5173");
    try {
      expect(stream.status).toBe(200);
      expect(stream.allowOrigin).toBe("http://localhost:5173");
    } finally {
      stream.abort();
    }
  });
});
