# Hive — reproducible local build (Node 22 + pnpm 9.12)
FROM node:22-slim AS base
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/server/package.json packages/server/package.json
COPY packages/client/package.json packages/client/package.json
RUN pnpm install --frozen-lockfile

COPY . .
# Build shared+server (tsc --build) and client (vite)
RUN pnpm build

EXPOSE 3001 3000
CMD ["node", "packages/server/dist/index.js"]
