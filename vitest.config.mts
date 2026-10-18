import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    exclude: ["node_modules", "dist"],
    coverage: {
      provider: "v8",
      reportsDirectory: "coverage",
      thresholds: { lines: 60, functions: 50, branches: 55 },
    },
    projects: [
      {
        test: {
          name: "server",
          environment: "node",
          include: [
            "packages/server/src/**/*.test.ts",
            "packages/shared/src/**/*.test.ts",
          ],
          // Server tests exercise code with multi-second legitimate
          // timeouts (the Ollama/LM Studio probes abort at 5s each, and
          // cold model-catalog discovery spawns real CLIs). The 5s default
          // trips on the first routing call per worker under full-suite
          // load, so the ceiling here is 3x headroom, not 5s.
          testTimeout: 15_000,
        },
      },
      {
        test: {
          name: "client",
          environment: "jsdom",
          include: [
            "packages/client/src/**/*.test.ts",
            "packages/client/src/**/*.test.tsx",
          ],
        },
      },
    ],
  },
});
