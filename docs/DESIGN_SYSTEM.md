# Hive Design System — "Ledger"

**Read this before writing any UI.** Every screen must look like it came from the
same product. If you find yourself writing a raw colour or inventing a component
that already exists here, stop and use the token/primitive instead.

---

## 1. The idea

Hive runs a swarm of AI agents that work like employees on your git repos. The
material language is **paper and ink**: a paper company's manila folder, a ledger
book's ruled precision, a typewritten timestamp.

- **Honey/manila amber is the one signature colour** (hive → honey; Dunder
  Mifflin → paper → manila). It marks the active, the selected, the primary
  action — nothing else.
- **Chrome is quiet and precise.** Hairline borders, restrained radii, generous
  negative space, tabular numerals.
- **The Office floor is the single place the metaphor is allowed to be playful.**
  Everywhere else, discipline.

Do not add second accent colours. Do not add gradients. Do not use emoji as UI
iconography (lucide-react only).

---

## 2. Tokens — never hardcode a colour

All tokens live in `src/index.css` and work as Tailwind utilities. Both light
("paper") and dark ("after hours") themes are already defined; using tokens means
you get both for free. **Hardcoding `#hex`, `bg-gray-900`, `text-white`, or any
`blue-*`/`slate-*` Tailwind palette class is a bug.**

| Purpose | Utility |
|---|---|
| App background | `bg-bg` |
| Panel / card | `bg-surface` |
| Raised / hover | `bg-surface-2`, `bg-surface-3` |
| Hairline border | `border-line`, `border-line-strong` |
| Primary text | `text-ink` |
| Secondary text | `text-muted` |
| Tertiary / labels | `text-faint` |
| Signature accent | `text-accent`, `bg-accent`, `border-accent-line`, `bg-accent-soft` |
| Success | `text-ok`, `bg-ok-soft` |
| Info | `text-info`, `bg-info-soft` |
| Warning | `text-warn`, `bg-warn-soft` |
| Danger | `text-danger`, `bg-danger-soft` |

Agent identity colours (stable per harness, for Office + charts) are CSS vars:
`--hive-agent-opencode`, `--hive-agent-claude`, `--hive-agent-pi`, `--hive-agent-hive`.

**Radii:** `rounded-sm` (4px) for chips, `rounded-md` (6px) default, `rounded-lg`
(10px) for cards, `rounded-xl` (14px) for modals. Never `rounded-2xl`/`rounded-full`
on containers.

---

## 3. Typography

Two families only, both bundled locally (no CDN — this ships as a desktop app).

- **Archivo** (`font-sans`, the default) — all UI text and headings.
- **IBM Plex Mono** (`font-mono`) — data, IDs, timestamps, paths, metrics, code,
  and every eyebrow label.

Scale: page title 22px/600 · section 15px/600 · body 13–14px · secondary 12px ·
eyebrow 10px mono uppercase tracked.

Use the `.eyebrow` class for the small typewritten labels above titles and panel
headings — it is the system's connective tissue. Put `data-numeric` on any element
with digits that should align in a column.

---

## 4. Primitives — compose these, don't rebuild them

From `src/components/ui.tsx`:

`Button` (`primary` | `default` | `ghost` | `danger`, sizes `sm`/`md`) ·
`IconButton` · `Card` · `CardHeader` · `PageHeader` · `PageBody` · `Badge`
(tones) · `StatusDot` (with `pulse`) · `Input` · `Textarea` · `Select` · `Field` ·
`Switch` · `SegmentedControl` · `EmptyState` · `Modal` · `useTheme`

Helper: `cn()` from `src/lib/cn.ts`.

### Every page follows this shape

```tsx
<PageBody>
  <PageHeader
    eyebrow="Inspect"
    title="Changes"
    description="Review what the swarm wrote before it lands."
    actions={<Button variant="primary">Commit</Button>}
  />
  {/* content */}
</PageBody>
```

---

## 5. Data — no mock data, ever

Every screen reads real data from the server via `src/lib/api.ts`:

```ts
import { API, subscribeToEvents } from "../lib/api";
const data = await API.get<T>("/api/…");
```

If an endpoint doesn't exist yet, **build it** in `packages/server/src/routes/`.
Stub files are already mounted in `server.ts` for `git`, `logs`, `settings`,
`memory`, `agents` — fill in the one you own. Do not invent fake arrays.

Live updates come from the SSE stream (`subscribeToEvents`). Server-side, emit
with `broadcast(type, data)` from `routes/events.ts`.

Loading and empty states are required, not optional. Use `EmptyState` with a real
action for empty; never render a bare spinner as a whole page.

---

## 6. Projects — everything is project-scoped

Hive manages multiple git working trees. The active project is global:

```ts
import { useProjects } from "../state/ProjectContext";
const { activeProject, activeProjectId } = useProjects();
```

Pass `?projectId=…` to any project-scoped API call. If `activeProject` is null,
render an `EmptyState` telling the person to add a project — do not crash or show
stale data from another project. Re-fetch when `activeProjectId` changes.

---

## 7. Writing

Words are design material. Write from the user's side of the screen.

- Name things by what people recognise ("Changes", not "Git Diff Viewer").
- Active voice; a button says exactly what happens ("Save changes", not "Submit"),
  and the confirmation uses the same word ("Saved").
- Errors say what went wrong and how to fix it. No apologies, no vagueness.
- Empty states invite an action.
- Sentence case everywhere except `.eyebrow` labels (uppercase).

---

## 8. Quality floor

- Keyboard focus is visible (the global `:focus-visible` ring handles it — don't
  remove it).
- `prefers-reduced-motion` is respected globally; if you add JS-driven animation,
  check it yourself via `matchMedia`.
- Works down to a 1100px-wide window (this is a desktop app, not a phone).
- Every icon-only control has an `aria-label`.
- Long content scrolls inside its own pane; the page body never scrolls sideways.

---

## 9. Before you finish

```bash
cd packages/client && npx tsc --noEmit     # must be clean
cd ../.. && npx eslint packages/client     # must be clean
```

Both must pass with zero errors and zero warnings.
