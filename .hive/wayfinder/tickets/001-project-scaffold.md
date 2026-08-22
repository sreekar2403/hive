# Ticket: Project Scaffold Decision

**Label:** `wayfinder:task`
**Status:** CLOSED
**Blocked by:** None
**Resolved:** 2026-08-19

## Question

How should the Hive project be scaffolded? The spec calls for a Node.js + TypeScript monolith with a React UI.

**Decision needed:**
- Single package or workspace monorepo (server + UI in one package vs separate packages)?
- Build tool for server (ts-node, tsx, esbuild, swc)?
- Dev workflow (concurrent server + UI dev servers, or single process)?

**Considerations:**
- Single package is simpler but mixes server and UI concerns
- Monorepo (npm workspaces) gives clean separation but more setup
- Server needs to serve the UI in production (single binary feeling)
- Dev mode needs hot reload for both server and UI

**Options:**
- A) Single package — everything in one `src/` directory, one `tsconfig.json`
- B) npm workspaces — `packages/server` + `packages/ui`, shared types
- C) Turborepo — overkill for personal tool but future-proof

**Recommendation:** B) npm workspaces — clean separation without overkill. Server and UI are distinct enough to warrant separate packages, but share types.

## Resolution

**Decision: B) npm workspaces**

```
hive/
├── package.json          ← root, defines workspaces
├── packages/
│   ├── server/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       └── index.ts  ← entry point
│   ├── ui/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── vite.config.ts
│   │   └── src/
│   │       └── App.tsx
│   └── shared/
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           └── types.ts  ← shared TypeScript interfaces
├── config/
│   ├── default.yaml
│   └── permissions.yaml
└── sessions/
```

**Build tool:** tsx (for server dev mode, fast TypeScript execution)
**Dev workflow:** `concurrently` runs server (tsx watch) + UI (vite dev) in parallel
**Production:** UI builds to `packages/ui/dist`, server serves it statically
**Shared types:** `@hive/shared` package imported by both server and UI
