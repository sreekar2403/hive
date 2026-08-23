# Ticket: React App Setup

**Label:** `wayfinder:task`
**Status:** CLOSED
**Blocked by:** 001-project-scaffold
**Resolved:** 2026-08-19

## Question

How should the React app be set up? The spec calls for React + Vite + TailwindCSS with a sidebar, chat, agent panel, and settings.

**Decision needed:**

- Component hierarchy (App → Layout → Sidebar + Main?)
- State management (React context? Zustand? Redux?)
- Styling approach (Tailwind utility classes? CSS modules?)
- Routing (React Router for settings page? or modal?)

**Considerations:**

- Must support real-time updates (WebSocket state)
- Must be responsive (sidebar collapse on small screens)
- Settings is a sub-page, not a separate route
- Agent activity panel is expandable, not a separate page

**Options:**

- A) React Context + useState — simplest, no extra deps
- B) Zustand — lightweight state management, good for real-time
- C) Redux Toolkit — overkill but structured

**Recommendation:** B) Zustand — lightweight, good for WebSocket state, no boilerplate.

## Resolution

**Decision: B) Zustand + TailwindCSS + slide-over settings modal (no routing)**

### Component Hierarchy

```
App
├── Layout
│   ├── Sidebar
│   │   ├── SidebarHeader ("Hive")
│   │   ├── SessionList
│   │   │   └── SessionItem (per session: query preview, status icon)
│   │   ├── NewSessionButton ("+")
│   │   └── SidebarFooter (settings gear icon)
│   └── Main
│       ├── Header
│       │   ├── SessionTitle (current query)
│       │   ├── AgentStatusBadges (mini agent cards)
│       │   └── SettingsButton
│       ├── AgentPanel (expandable, collapsible)
│       │   └── AgentCard (per agent: harness, model, iteration)
│       ├── Chat
│       │   ├── MessageList
│       │   │   ├── UserMessage
│       │   │   ├── AgentMessage
│       │   │   ├── SystemMessage (status updates)
│       │   │   └── PermissionRequest (inline dialog)
│       │   └── ChatInput
│       └── SettingsModal (slide-over from right)
│           ├── ModelSettings (per harness dropdowns)
│           ├── ResourceSettings (local LLM, VRAM)
│           ├── PermissionSettings (patterns, levels)
│           └── CompactionSettings (token budget)
```

### Zustand Stores

```typescript
// packages/ui/src/stores/sessions.ts

import { create } from "zustand";

interface Session {
  id: string;
  query: string;
  status: "routing" | "looping" | "compacting" | "merging" | "done" | "failed";
  agents: AgentInfo[];
  prUrl?: string;
}

interface AgentInfo {
  id: string;
  harness: string;
  model: string;
  iteration: number;
  maxIterations: number;
  state: string;
  output: string;
}

interface SessionsStore {
  sessions: Session[];
  activeSessionId: string | null;
  setActive: (id: string) => void;
  addSession: (session: Session) => void;
  updateSession: (id: string, updates: Partial<Session>) => void;
  removeSession: (id: string) => void;
  updateAgent: (
    sessionId: string,
    agentId: string,
    updates: Partial<AgentInfo>,
  ) => void;
}

export const useSessionsStore = create<SessionsStore>((set) => ({
  sessions: [],
  activeSessionId: null,
  setActive: (id) => set({ activeSessionId: id }),
  addSession: (session) => set((s) => ({ sessions: [...s.sessions, session] })),
  updateSession: (id, updates) =>
    set((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.id === id ? { ...sess, ...updates } : sess,
      ),
    })),
  removeSession: (id) =>
    set((s) => ({
      sessions: s.sessions.filter((sess) => sess.id !== id),
      activeSessionId: s.activeSessionId === id ? null : s.activeSessionId,
    })),
  updateAgent: (sessionId, agentId, updates) =>
    set((s) => ({
      sessions: s.sessions.map((sess) => {
        if (sess.id !== sessionId) return sess;
        return {
          ...sess,
          agents: sess.agents.map((a) =>
            a.id === agentId ? { ...a, ...updates } : a,
          ),
        };
      }),
    })),
}));
```

```typescript
// packages/ui/src/stores/ui.ts

interface UIStore {
  sidebarCollapsed: boolean;
  agentPanelExpanded: boolean;
  settingsOpen: boolean;
  toggleSidebar: () => void;
  toggleAgentPanel: () => void;
  toggleSettings: () => void;
}

export const useUIStore = create<UIStore>((set) => ({
  sidebarCollapsed: false,
  agentPanelExpanded: false,
  settingsOpen: false,
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  toggleAgentPanel: () =>
    set((s) => ({ agentPanelExpanded: !s.agentPanelExpanded })),
  toggleSettings: () => set((s) => ({ settingsOpen: !s.settingsOpen })),
}));
```

```typescript
// packages/ui/src/stores/messages.ts

interface ChatMessage {
  id: string;
  sessionId: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  agentId?: string;
  type?: "permission_request" | "permission_response" | "status";
}

interface MessagesStore {
  messages: Map<string, ChatMessage[]>; // sessionId → messages
  addMessage: (sessionId: string, message: ChatMessage) => void;
  getMessages: (sessionId: string) => ChatMessage[];
}

export const useMessagesStore = create<MessagesStore>((set, get) => ({
  messages: new Map(),
  addMessage: (sessionId, message) =>
    set((s) => {
      const existing = s.messages.get(sessionId) || [];
      const updated = new Map(s.messages);
      updated.set(sessionId, [...existing, message]);
      return { messages: updated };
    }),
  getMessages: (sessionId) => get().messages.get(sessionId) || [],
}));
```

### WebSocket Hook

```typescript
// packages/ui/src/hooks/useWebSocket.ts

import { useEffect, useRef } from "react";
import { useSessionsStore } from "../stores/sessions";
import { useMessagesStore } from "../stores/messages";

export function useWebSocket(url: string) {
  const wsRef = useRef<WebSocket | null>(null);
  const { addSession, updateSession, updateAgent } = useSessionsStore();
  const { addMessage } = useMessagesStore();

  useEffect(() => {
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);

      switch (msg.type) {
        case "session:created":
          addSession({
            id: msg.sessionId,
            query: msg.payload.query,
            status: "routing",
            agents: [],
          });
          break;

        case "session:routed":
          updateSession(msg.sessionId, { status: "looping" });
          addMessage(msg.sessionId, {
            id: msg.id,
            sessionId: msg.sessionId,
            role: "system",
            content: `Routed to ${msg.payload.harness}/${msg.payload.model}`,
            timestamp: msg.timestamp,
          });
          break;

        case "agent:started":
          // add agent to session
          break;

        case "agent:output":
          updateAgent(msg.sessionId, msg.payload.agentId, {
            output: (prev) => prev + msg.payload.chunk,
          });
          break;

        case "loop:verify":
          addMessage(msg.sessionId, {
            id: msg.id,
            sessionId: msg.sessionId,
            role: "system",
            content: msg.payload.passed
              ? `Verification passed: ${msg.payload.reason}`
              : `Verification failed: ${msg.payload.reason}`,
            timestamp: msg.timestamp,
          });
          break;

        case "permission:requested":
          addMessage(msg.sessionId, {
            id: msg.id,
            sessionId: msg.sessionId,
            role: "system",
            content: `Permission requested: ${msg.payload.command}`,
            timestamp: msg.timestamp,
            type: "permission_request",
          });
          break;

        case "session:done":
          updateSession(msg.sessionId, {
            status: msg.payload.success ? "done" : "failed",
          });
          addMessage(msg.sessionId, {
            id: msg.id,
            sessionId: msg.sessionId,
            role: "assistant",
            content: msg.payload.summary,
            timestamp: msg.timestamp,
          });
          break;
      }
    };

    return () => ws.close();
  }, [url]);
}
```

### TailwindCSS Config

```javascript
// packages/ui/tailwind.config.js
export default {
  content: ["./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        hive: {
          50: "#f0fdf4",
          500: "#22c55e",
          600: "#16a34a",
          700: "#15803d",
          900: "#14532d",
        },
      },
    },
  },
  plugins: [],
};
```

### File Structure

```
packages/ui/
├── package.json
├── tsconfig.json
├── vite.config.ts
├── tailwind.config.js
├── postcss.config.js
├── index.html
└── src/
    ├── main.tsx
    ├── App.tsx
    ├── components/
    │   ├── Layout.tsx
    │   ├── Sidebar/
    │   │   ├── Sidebar.tsx
    │   │   ├── SessionList.tsx
    │   │   └── SessionItem.tsx
    │   ├── Main/
    │   │   ├── Header.tsx
    │   │   ├── AgentPanel.tsx
    │   │   ├── AgentCard.tsx
    │   │   └── SettingsModal.tsx
    │   └── Chat/
    │       ├── Chat.tsx
    │       ├── MessageList.tsx
    │       ├── ChatInput.tsx
    │       └── PermissionRequest.tsx
    ├── stores/
    │   ├── sessions.ts
    │   ├── messages.ts
    │   └── ui.ts
    ├── hooks/
    │   ├── useWebSocket.ts
    │   └── useSession.ts
    └── types.ts
```
