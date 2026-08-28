# Contributing to Hive

Thanks for considering a contribution. Hive is a multi-agent orchestration framework — the server drives 12 CLIs via `packages/server/src/harnesses/*`.

## Quick start

```bash
pnpm install          # pnpm 9.12+, Node 22+
pnpm dev:server        # API on :3001 via tsx (no build)
pnpm dev:client        # Vite on :3000 (second terminal)
# or
hive                  # API + UI + Electron as one process (bin/hive.js)
```

Run everything from the repo root — `hive.config.json` is resolved against `process.cwd()`.

## Scripts

| Script               | What it does                                                                   |
| -------------------- | ------------------------------------------------------------------------------ |
| `pnpm dev:server`    | `tsx packages/server/src/index.ts`                                             |
| `pnpm dev:client`    | Vite dev server                                                                |
| `pnpm dev:electron`  | UI + Electron window                                                           |
| `pnpm build`         | `tsc --build` (shared+server) — then `pnpm --filter @hive/client build` for UI |
| `pnpm test`          | `vitest run` (server + shared)                                                 |
| `pnpm lint`          | `eslint .`                                                                     |
| `pnpm format`        | `prettier --write .`                                                           |
| `hive doctor`        | checks Node, pnpm, git, CLIs, ports                                            |
| `hive doctor --deep` | one real prompt per CLI to verify event streams (costs tokens)                 |

Typecheck without emitting: `pnpm tsc --noEmit` or `pnpm --filter @hive/server exec tsc --noEmit`.

## Branch & PR flow

1. Branch from `main`: `feat/<name>` or `fix/<name>`.
2. Keep PRs ≤ ~400 lines where possible; one feature per PR.
3. Run before pushing:
   ```bash
   pnpm lint
   pnpm exec tsc --noEmit   # or pnpm typecheck
   pnpm exec vitest run
   ```
4. Describe user-visible behavior, not internals. Link issues via `Closes #123`.

`CI` runs `lint`, `typecheck`, and `vitest` on Node 20/22, ubuntu + windows.

## Adding a harness

See `docs/DEVELOPMENT.md` → “Add a harness”. Checklist:

- `packages/server/src/harnesses/<name>.ts` implements `Harness` (`isAvailable`, `execute`, `isCompatible`)
- Parser in `harnesses/eventStream.ts` + pins in `eventStream.test.ts`
- Register in `harnesses/index.ts`, `HarnessId` in `config.ts`, `createDefaultConfig().harnesses`, `HARNESS_IDS`
- Colour `--hive-agent-<name>` in `packages/client/src/index.css` + `pages/kanban/constants.ts` + `OfficeFloorPage.tsx`
- Catalog teaching in `models/catalog.ts` if it has `models` listing

## Adding a settings field

See `docs/DEVELOPMENT.md` → “Add a settings field” (4 places, in order): `config.ts` → `routes/settings.ts` → `client/types.ts` → section component.

## Commit messages

Conventional commits preferred: `feat:`, `fix:`, `docs:`, `chore:`, `test:`. Example: `fix(windows): avoid cmd.exe arg truncation`.

## Code of Conduct

Be kind. See `CODE_OF_CONDUCT.md`. Report unacceptable behavior to the maintainers via GitHub private security report.

## License

MIT — see `LICENSE`. By contributing you agree your work is MIT-licensed.
