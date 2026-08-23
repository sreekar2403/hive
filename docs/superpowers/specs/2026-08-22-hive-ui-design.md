# Hive UI Design

**Date:** 2026-08-22
**Status:** Approved
**Author:** Sreekar

---

## Overview

Hive becomes a production-ready Electron desktop app with a multi-page UI. The interface includes a Dashboard, Office Floor (Pixi.js), Chat (multi-session), Kanban, Settings, Memory, Git Diff, Permissions, Logs, Workflow Builder, and Schedule Jobs. Inspired by Munder Difflin's office floor visualization.

---

## Approach

**Minimal Electron + React SPA** — thin Electron shell with a single React app using client-side routing. All pages as React components with Pixi.js canvas embedded for the office floor. Simplest to implement and debug, fastest iteration.

---

## Architecture

```
packages/client/
  electron/
    main.ts          # Electron main process
    preload.ts       # Context bridge
  src/
    App.tsx          # Router + layout
    pages/
      Dashboard.tsx
      OfficeFloor.tsx
      Chat.tsx
      Kanban.tsx
      Settings.tsx
      Memory.tsx
      GitDiff.tsx
      Permissions.tsx
      Logs.tsx
      WorkflowBuilder.tsx
      ScheduleJobs.tsx
    components/
      Sidebar.tsx
      SessionList.tsx
      AgentCard.tsx
      NodeEditor.tsx    # For workflow builder
      CalendarView.tsx  # For schedule jobs
    store/
      AppContext.tsx     # Global state
    styles/
      globals.css
      tokens.css
```

---

## Layout

```
┌─────────────────────────────────────────────────────────┐
│  ┌──────┐  ┌──────────────────────────────────────────┐ │
│  │      │  │                                          │ │
│  │ Side │  │              Main Content Area            │ │
│  │ bar  │  │                                          │ │
│  │      │  │  (Dashboard / Office / Chat / Kanban /   │ │
│  │  🏠  │  │   Settings / Memory / GitDiff / Logs /   │ │
│  │  🏢  │  │   Workflows / Schedule)                  │ │
│  │  💬  │  │                                          │ │
│  │  📋  │  │                                          │ │
│  │  ⚙️  │  │                                          │ │
│  └──────┘  └──────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

**Sidebar:**

- Fixed width (240px), collapsible to icon-only (60px)
- Navigation icons with labels
- Active page highlighted
- Logo/brand at top

---

## Pages

### 1. Dashboard (`/dashboard`)

- Overview of all active agents and sessions
- Cards: agent name, status (working/idle/error), current task, uptime
- Summary stats: total tasks completed, active agents, queue depth
- Quick actions: New Chat, View Logs

### 2. Office Floor (`/office`)

- Pixi.js canvas with pixel art office
- 16x16 or 32x32 tile-based map
- Agent avatars at desks when working
- Status indicators: green (working), yellow (thinking), red (error), gray (idle)
- Envelope animations when agents communicate
- Click avatar to see agent details / jump to chat

### 3. Chat (`/chat`)

- Left panel: session list (new session button, names, timestamps)
- Right panel: message thread (user messages, agent responses, status)
- Bottom: input bar with send button
- Multi-session: click session to switch

### 4. Kanban (`/kanban`)

- Columns: Backlog, In Progress, Review, Done
- Task cards: title, assigned agent, priority, status
- Drag-and-drop between columns
- Click card to expand details

### 5. Settings (`/settings`)

- Tabs: General, AI Providers, Routing, Permissions
- General: app theme, workspace path
- AI Providers: add/edit API keys, local LLM endpoints
- Routing: map task categories to models/providers
- Permissions: whitelist/blacklist destructive actions

### 6. Memory (`/memory`)

- Search bar at top
- List of memory entries with timestamps
- Click to expand full content
- Filter by session, date, type

### 7. Git Diff (`/gitdiff`)

- Read-only view of current changes
- File tree on left, diff viewer on right
- Branch info at top
- No edit/commit buttons

### 8. Permissions (`/permissions`)

- Pending approvals queue
- Approval history
- Allow/deny buttons for pending items

### 9. Logs (`/logs`)

- Real-time log feed (SSE)
- Filter by level (info/warn/error)
- Filter by source (harness, orchestrator, etc.)
- Timestamp + message format

### 10. Workflow Builder (`/workflows`)

- Visual node editor (drag-drop)
- Node types: Agent, Condition, Action, Start, End
- Connect nodes with edges to define flow
- Save/load workflows
- Execute workflow manually or via schedule

### 11. Schedule Jobs (`/schedule`)

- Cron configuration view
- Calendar view with drag-to-schedule
- Recurring and one-time tasks
- Link to workflow or direct task
- Enable/disable schedules

---

## State Management

**React Context:**

```
AppContext
  ├── currentPage: string
  ├── setCurrentPage: (page) => void
  ├── sessions: Map<string, Session>
  ├── currentSessionId: string | null
  ├── createSession / switchSession / deleteSession
  ├── agents: Agent[]
  ├── agentStatus: Map<string, AgentStatus>
  ├── workflows: Workflow[]
  ├── schedules: Schedule[]
  └── settings: AppConfig
```

**API Communication:**

- REST for CRUD (sessions, workflows, schedules)
- Server-Sent Events (SSE) for real-time (logs, agent status)

---

## Backend Extensions

**Extend existing Express server (packages/server):**

**SQLite Database:**

- `workflows` table: id, name, nodes (JSON), edges (JSON), created_at, updated_at
- `schedules` table: id, workflow_id, cron_expr, enabled, last_run, next_run
- `schedule_runs` table: id, schedule_id, status, started_at, completed_at

**New Endpoints:**

- `GET/POST/PUT/DELETE /api/workflows` — CRUD
- `POST /api/workflows/:id/execute` — run workflow
- `GET/POST/PUT/DELETE /api/schedules` — CRUD
- `GET /api/schedules/:id/runs` — execution history
- `GET /api/events` — SSE stream for real-time updates

**Cron Runner:**

- node-cron or similar
- Checks schedules every minute
- Triggers workflow execution when due

---

## Styling

**Colors:**

- Primary: `#3b82f6` (blue)
- Secondary: `#22c55e` (green)
- Warning: `#f59e0b` (amber)
- Error: `#ef4444` (red)
- Background: `#0a0a0a`
- Surface: `#1a1a1a`
- Border: `#222222`
- Text: `#ffffff`, `#e5e5e5`

**Typography:**

- Font: Inter or system font stack
- Headings: 600-700 weight
- Body: 400 weight
- Code: monospace

**Components:**

- Cards: dark surface, subtle border, rounded corners
- Buttons: solid fills, hover states
- Inputs: dark background, focus ring

**Office Floor:**

- Pixel art tiles (16x16 or 32x32)
- Character sprites (LimeZu or similar, check license)
- Simple pathfinding

**Responsive:**

- Desktop-first (Electron)
- Minimum window: 1024x768
- Sidebar collapses below 1200px

---

## Implementation Order

**Phase 1: Electron Shell + Basic Layout**

1. Set up Electron main process + preload
2. Create React app structure with routing
3. Build sidebar navigation
4. Create page placeholders
5. Wire up page switching

**Phase 2: Core Pages (static)**

1. Dashboard (mockup)
2. Chat (enhance existing)
3. Kanban (static board)
4. Settings (form UI)
5. Logs (static list)

**Phase 3: Office Floor (Pixi.js)**

1. Set up Pixi.js canvas
2. Create office map/tileset
3. Add agent avatars (sprites)
4. Implement movement/animation
5. Connect to agent status

**Phase 4: Backend Extensions**

1. SQLite setup + migrations
2. Workflow CRUD endpoints
3. Schedule CRUD endpoints
4. Cron job runner
5. SSE endpoint

**Phase 5: Interactive Features**

1. Workflow builder (node editor)
2. Schedule calendar view
3. Memory search
4. Git diff viewer
5. Permissions queue

---

## Dependencies

- Electron shell must come first
- Office floor needs Pixi.js setup before sprites
- Backend needs SQLite before workflows/schedules
- Real-time features need SSE before live updates
