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
