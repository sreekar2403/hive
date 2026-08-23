# Hive UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Build a multi-page Electron desktop app with Dashboard, Office Floor (Pixi.js), Chat, Kanban, Settings, Memory, Git Diff, Permissions, Logs, Workflow Builder, and Schedule Jobs.

**Architecture:** Minimal Electron shell with React SPA using client-side routing. All pages as React components with Pixi.js canvas embedded for the office floor. Extend existing Express server with SQLite for workflow/schedule persistence.

**Tech Stack:** Electron, React, React Router, Pixi.js, Tailwind CSS, Express, SQLite, node-cron

## Global Constraints

- Platform: Windows (win32), Node v24
- Package manager: pnpm 9.12.0
- TypeScript 5.7+
- React 19
- Minimum window size: 1024x768
- No external state library (use React Context)
- Desktop-first design

---

## Phase 1: Electron Shell + Basic Layout

### Task 1: Set Up Electron Main Process

**Files:**

- Create: `packages/client/electron/main.ts`
- Create: `packages/client/electron/preload.ts`
- Modify: `packages/client/package.json`

**Interfaces:**

- Consumes: None (first task)
- Produces: Electron app that opens a window

- [ ] **Step 1: Install Electron dependencies**

Run: `pnpm add -D electron @electron-forge/cli`

- [ ] **Step 2: Create preload script**

``typescript
// packages/client/electron/preload.ts
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
platform: process.platform,
send: (channel: string, data: unknown) => ipcRenderer.send(channel, data),
on: (channel: string, callback: (...args: unknown[]) => void) =>
ipcRenderer.on(channel, (_event, ...args) => callback(...args)),
});
``

- [ ] **Step 3: Create main process**

``typescript
// packages/client/electron/main.ts
import { app, BrowserWindow } from 'electron';
import path from 'path';

let mainWindow: BrowserWindow | null = null;

function createWindow() {
mainWindow = new BrowserWindow({
width: 1280,
height: 800,
minWidth: 1024,
minHeight: 768,
webPreferences: {
preload: path.join(__dirname, 'preload.js'),
contextIsolation: true,
nodeIntegration: false,
},
backgroundColor: '#0a0a0a',
});

const isDev = process.env.NODE_ENV === 'development';
if (isDev) {
mainWindow.loadURL('http://localhost:3000');
mainWindow.webContents.openDevTools();
} else {
mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
}
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
``

- [ ] **Step 4: Update package.json scripts**

`json
{
  "scripts": {
    "electron:dev": "concurrently \"pnpm dev\" \"wait-on http://localhost:3000 && electron .\"",
    "electron:build": "next build && electron-builder"
  },
  "main": "electron/main.js"
}
`

- [ ] **Step 5: Test Electron launches**

Run: `pnpm electron:dev`
Expected: Electron window opens showing Next.js app

- [ ] **Step 6: Commit**

`bash
git add packages/client/electron/ packages/client/package.json
git commit -m "feat: add Electron shell with main process and preload"
`

---

### Task 2: Set Up React Router + Layout

**Files:**

- Create: `packages/client/src/App.tsx` (replace existing)
- Create: `packages/client/src/components/Sidebar.tsx`
- Create: `packages/client/src/pages/Dashboard.tsx`
- Create: `packages/client/src/pages/placeholder.tsx`

**Interfaces:**

- Consumes: Electron shell (Task 1)
- Produces: Working navigation between placeholder pages

- [ ] **Step 1: Install React Router**

Run: `pnpm add react-router-dom`

- [ ] **Step 2: Create placeholder page component**

`tsx
// packages/client/src/pages/placeholder.tsx
export function PlaceholderPage({ title }: { title: string }) {
  return (
    <div className="flex items-center justify-center h-full">
      <h1 className="text-2xl text-gray-400">{title}</h1>
    </div>
  );
}
`

- [ ] **Step 3: Create Sidebar component**

``tsx
// packages/client/src/components/Sidebar.tsx
import { NavLink } from 'react-router-dom';
import {
LayoutDashboard, Building2, MessageSquare, Kanban,
Settings, Brain, GitBranch, Shield, ScrollText,
Workflow, Calendar
} from 'lucide-react';

const navItems = [
{ path: '/', icon: LayoutDashboard, label: 'Dashboard' },
{ path: '/office', icon: Building2, label: 'Office' },
{ path: '/chat', icon: MessageSquare, label: 'Chat' },
{ path: '/kanban', icon: Kanban, label: 'Kanban' },
{ path: '/workflows', icon: Workflow, label: 'Workflows' },
{ path: '/schedule', icon: Calendar, label: 'Schedule' },
{ path: '/memory', icon: Brain, label: 'Memory' },
{ path: '/gitdiff', icon: GitBranch, label: 'Git Diff' },
{ path: '/permissions', icon: Shield, label: 'Permissions' },
{ path: '/logs', icon: ScrollText, label: 'Logs' },
{ path: '/settings', icon: Settings, label: 'Settings' },
];

export function Sidebar() {
return (
<aside className="w-60 h-full bg-gray-900 border-r border-gray-800 flex flex-col">
<div className="p-4 border-b border-gray-800">
<h1 className="text-xl font-bold text-white">Hive</h1>
</div>
<nav className="flex-1 p-2 space-y-1">
{navItems.map(({ path, icon: Icon, label }) => (
<NavLink
key={path}
to={path}
className={({ isActive }) =>
lex items-center gap-3 px-3 py-2 rounded-lg transition-colors
} >
<Icon className="w-5 h-5" />
<span>{label}</span>
</NavLink>
))}
</nav>
</aside>
);
}
``

- [ ] **Step 4: Create Dashboard page**

`tsx
// packages/client/src/pages/Dashboard.tsx
export function Dashboard() {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">Dashboard</h1>
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-gray-800 rounded-lg p-4">
          <div className="text-gray-400 text-sm">Active Agents</div>
          <div className="text-3xl font-bold">0</div>
        </div>
        <div className="bg-gray-800 rounded-lg p-4">
          <div className="text-gray-400 text-sm">Tasks Completed</div>
          <div className="text-3xl font-bold">0</div>
        </div>
        <div className="bg-gray-800 rounded-lg p-4">
          <div className="text-gray-400 text-sm">Queue Depth</div>
          <div className="text-3xl font-bold">0</div>
        </div>
      </div>
    </div>
  );
}
`

- [ ] **Step 5: Update App.tsx with Router + Layout**

``tsx
// packages/client/src/App.tsx
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Sidebar } from './components/Sidebar';
import { Dashboard } from './pages/Dashboard';
import { PlaceholderPage } from './pages/placeholder';

function App() {
return (
<BrowserRouter>
<div className="flex h-screen bg-gray-950 text-white">
<Sidebar />
<main className="flex-1 overflow-auto">
<Routes>
<Route path="/" element={<Dashboard />} />
<Route path="/office" element={<PlaceholderPage title="Office Floor" />} />
<Route path="/chat" element={<PlaceholderPage title="Chat" />} />
<Route path="/kanban" element={<PlaceholderPage title="Kanban" />} />
<Route path="/workflows" element={<PlaceholderPage title="Workflow Builder" />} />
<Route path="/schedule" element={<PlaceholderPage title="Schedule Jobs" />} />
<Route path="/memory" element={<PlaceholderPage title="Memory" />} />
<Route path="/gitdiff" element={<PlaceholderPage title="Git Diff" />} />
<Route path="/permissions" element={<PlaceholderPage title="Permissions" />} />
<Route path="/logs" element={<PlaceholderPage title="Logs" />} />
<Route path="/settings" element={<PlaceholderPage title="Settings" />} />
</Routes>
</main>
</div>
</BrowserRouter>
);
}

export default App;
``

- [ ] **Step 6: Test navigation works**

Run: `pnpm dev`
Expected: Sidebar shows, clicking items changes main content

- [ ] **Step 7: Commit**

`bash
git add packages/client/src/
git commit -m "feat: add React Router with sidebar navigation and placeholder pages"
`

---

## Phase 2: Core Pages

### Task 3: Build Chat Page

**Files:**

- Create: `packages/client/src/pages/Chat.tsx`
- Create: `packages/client/src/components/SessionList.tsx`
- Create: `packages/client/src/components/MessageThread.tsx`

**Interfaces:**

- Consumes: Layout from Task 2
- Produces: Functional chat with multi-session support

- [ ] **Step 1: Create SessionList component**

``tsx
// packages/client/src/components/SessionList.tsx
interface Session {
id: string;
name: string;
lastMessage: string;
timestamp: number;
}

interface SessionListProps {
sessions: Session[];
currentSessionId: string | null;
onSelect: (id: string) => void;
onNew: () => void;
}

export function SessionList({ sessions, currentSessionId, onSelect, onNew }: SessionListProps) {
return (
<div className="w-64 border-r border-gray-800 bg-gray-900 flex flex-col">
<div className="p-3 border-b border-gray-800">
<button
          onClick={onNew}
          className="w-full px-3 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm font-medium"
        > + New Session
</button>
</div>
<div className="flex-1 overflow-auto">
{sessions.map((session) => (
<button
key={session.id}
onClick={() => onSelect(session.id)}
className={w-full text-left px-3 py-3 border-b border-gray-800 } >
<div className="font-medium text-sm truncate">{session.name}</div>
<div className="text-xs text-gray-500 truncate mt-1">{session.lastMessage}</div>
</button>
))}
</div>
</div>
);
}
``

- [ ] **Step 2: Create MessageThread component**

``tsx
// packages/client/src/components/MessageThread.tsx
import { Bot, User } from 'lucide-react';

interface Message {
role: 'user' | 'assistant';
content: string;
status?: string;
timestamp: number;
}

interface MessageThreadProps {
messages: Message[];
}

export function MessageThread({ messages }: MessageThreadProps) {
return (
<div className="flex-1 overflow-auto p-4 space-y-4">
{messages.length === 0 && (
<div className="flex flex-col items-center justify-center h-full text-gray-500">
<Bot className="w-12 h-12 mb-3" />
<p>Start a conversation</p>
</div>
)}
{messages.map((msg, idx) => (
<div
key={idx}
className={`flex gap-3 `} >
{msg.role === 'assistant' && (
<div className="w-8 h-8 rounded-full bg-green-600 flex items-center justify-center flex-shrink-0">
<Bot className="w-5 h-5" />
</div>
)}
<div
className={`max-w-2xl px-4 py-3 rounded-2xl `} >
<div className="whitespace-pre-wrap text-sm">{msg.content}</div>
{msg.status && (
<div className="mt-2 text-xs text-gray-400">{msg.status}</div>
)}
</div>
{msg.role === 'user' && (
<div className="w-8 h-8 rounded-full bg-gray-600 flex items-center justify-center flex-shrink-0">
<User className="w-5 h-5" />
</div>
)}
</div>
))}
</div>
);
}
``

- [ ] **Step 3: Create Chat page**

``tsx
// packages/client/src/pages/Chat.tsx
import { useState } from 'react';
import { Send } from 'lucide-react';
import { SessionList } from '../components/SessionList';
import { MessageThread } from '../components/MessageThread';

interface Message {
role: 'user' | 'assistant';
content: string;
status?: string;
timestamp: number;
}

interface Session {
id: string;
name: string;
messages: Message[];
}

export function Chat() {
const [sessions, setSessions] = useState<Session[]>([]);
const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
const [input, setInput] = useState('');

const currentSession = sessions.find(s => s.id === currentSessionId);

const handleNewSession = () => {
const id = `session_`;
const newSession: Session = {
id,
name: `Session `,
messages: [],
};
setSessions(prev => [...prev, newSession]);
setCurrentSessionId(id);
};

const handleSend = async () => {
if (!input.trim() || !currentSessionId) return;

    const userMsg: Message = {
      role: 'user',
      content: input,
      timestamp: Date.now(),
    };

    setSessions(prev =>
      prev.map(s =>
        s.id === currentSessionId
          ? { ...s, messages: [...s.messages, userMsg] }
          : s
      )
    );
    setInput('');

    // TODO: Connect to backend API
    const assistantMsg: Message = {
      role: 'assistant',
      content: 'Response from server...',
      timestamp: Date.now(),
    };

    setSessions(prev =>
      prev.map(s =>
        s.id === currentSessionId
          ? { ...s, messages: [...s.messages, assistantMsg] }
          : s
      )
    );

};

return (
<div className="flex h-full">
<SessionList
sessions={sessions.map(s => ({
id: s.id,
name: s.name,
lastMessage: s.messages[s.messages.length - 1]?.content || '',
timestamp: s.messages[s.messages.length - 1]?.timestamp || 0,
}))}
currentSessionId={currentSessionId}
onSelect={setCurrentSessionId}
onNew={handleNewSession}
/>
<div className="flex-1 flex flex-col">
<MessageThread messages={currentSession?.messages || []} />
<div className="p-4 border-t border-gray-800">
<div className="flex gap-3">
<input
type="text"
value={input}
onChange={e => setInput(e.target.value)}
onKeyDown={e => e.key === 'Enter' && handleSend()}
placeholder="Type a message..."
className="flex-1 px-4 py-3 bg-gray-800 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
/>
<button
              onClick={handleSend}
              disabled={!input.trim()}
              className="px-4 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 rounded-xl"
            >
<Send className="w-5 h-5" />
</button>
</div>
</div>
</div>
</div>
);
}
``

- [ ] **Step 4: Update App.tsx route for Chat**

Replace `<Route path="/chat" element={<PlaceholderPage title="Chat" />} />` with:
`tsx
<Route path="/chat" element={<Chat />} />
`

- [ ] **Step 5: Test chat works**

Run: `pnpm dev`
Expected: Create sessions, send messages, switch between sessions

- [ ] **Step 6: Commit**

`bash
git add packages/client/src/
git commit -m "feat: add Chat page with multi-session support"
`

---

### Task 4: Build Kanban Page

**Files:**

- Create: `packages/client/src/pages/Kanban.tsx`

**Interfaces:**

- Consumes: Layout from Task 2
- Produces: Static kanban board with drag-drop

- [ ] **Step 1: Create Kanban page**

``tsx
// packages/client/src/pages/Kanban.tsx
import { useState } from 'react';

interface Task {
id: string;
title: string;
agent?: string;
priority: 'low' | 'medium' | 'high';
}

interface Column {
id: string;
title: string;
tasks: Task[];
}

const initialColumns: Column[] = [
{ id: 'backlog', title: 'Backlog', tasks: [] },
{ id: 'in-progress', title: 'In Progress', tasks: [] },
{ id: 'review', title: 'Review', tasks: [] },
{ id: 'done', title: 'Done', tasks: [] },
];

export function Kanban() {
const [columns, setColumns] = useState<Column[]>(initialColumns);

const onDragStart = (e: React.DragEvent, taskId: string, sourceColumnId: string) => {
e.dataTransfer.setData('taskId', taskId);
e.dataTransfer.setData('sourceColumnId', sourceColumnId);
};

const onDrop = (e: React.DragEvent, targetColumnId: string) => {
e.preventDefault();
const taskId = e.dataTransfer.getData('taskId');
const sourceColumnId = e.dataTransfer.getData('sourceColumnId');

    if (sourceColumnId === targetColumnId) return;

    setColumns(prev => {
      const source = prev.find(c => c.id === sourceColumnId)!;
      const target = prev.find(c => c.id === targetColumnId)!;
      const task = source.tasks.find(t => t.id === taskId)!;

      return prev.map(col => {
        if (col.id === sourceColumnId) {
          return { ...col, tasks: col.tasks.filter(t => t.id !== taskId) };
        }
        if (col.id === targetColumnId) {
          return { ...col, tasks: [...col.tasks, task] };
        }
        return col;
      });
    });

};

return (
<div className="p-6 h-full">
<h1 className="text-2xl font-bold mb-6">Kanban</h1>
<div className="flex gap-4 h-full overflow-x-auto">
{columns.map(column => (
<div
key={column.id}
className="w-72 bg-gray-900 rounded-lg flex flex-col"
onDragOver={e => e.preventDefault()}
onDrop={e => onDrop(e, column.id)} >
<div className="p-3 border-b border-gray-800 font-medium">
{column.title}
<span className="ml-2 text-gray-500 text-sm">{column.tasks.length}</span>
</div>
<div className="flex-1 p-2 space-y-2 overflow-auto">
{column.tasks.map(task => (
<div
key={task.id}
draggable
onDragStart={e => onDragStart(e, task.id, column.id)}
className="bg-gray-800 p-3 rounded-lg cursor-grab hover:bg-gray-750" >
<div className="font-medium text-sm">{task.title}</div>
{task.agent && (
<div className="text-xs text-gray-500 mt-1">{task.agent}</div>
)}
</div>
))}
</div>
</div>
))}
</div>
</div>
);
}
``

- [ ] **Step 2: Update App.tsx route for Kanban**

Replace `<Route path="/kanban" element={<PlaceholderPage title="Kanban" />} />` with:
`tsx
<Route path="/kanban" element={<Kanban />} />
`

- [ ] **Step 3: Test kanban works**

Run: `pnpm dev`
Expected: Drag tasks between columns

- [ ] **Step 4: Commit**

`bash
git add packages/client/src/
git commit -m "feat: add Kanban page with drag-drop"
`

---

### Task 5: Build Settings Page

**Files:**

- Create: `packages/client/src/pages/Settings.tsx`

**Interfaces:**

- Consumes: Layout from Task 2
- Produces: Settings form with tabs

- [ ] **Step 1: Create Settings page**

``tsx
// packages/client/src/pages/Settings.tsx
import { useState } from 'react';

type Tab = 'general' | 'providers' | 'routing' | 'permissions';

export function Settings() {
const [activeTab, setActiveTab] = useState<Tab>('general');

const tabs: { id: Tab; label: string }[] = [
{ id: 'general', label: 'General' },
{ id: 'providers', label: 'AI Providers' },
{ id: 'routing', label: 'Routing' },
{ id: 'permissions', label: 'Permissions' },
];

return (
<div className="p-6">
<h1 className="text-2xl font-bold mb-6">Settings</h1>
<div className="flex gap-6">
<div className="w-48 space-y-1">
{tabs.map(tab => (
<button
key={tab.id}
onClick={() => setActiveTab(tab.id)}
className={`w-full text-left px-3 py-2 rounded-lg `} >
{tab.label}
</button>
))}
</div>
<div className="flex-1 bg-gray-900 rounded-lg p-4">
{activeTab === 'general' && (
<div className="space-y-4">
<h2 className="text-lg font-medium">General Settings</h2>
<div>
<label className="block text-sm text-gray-400 mb-1">Workspace Path</label>
<input
                  type="text"
                  defaultValue="C:\Users\SREEKAR\Desktop\workspace\projects\hive"
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg"
                />
</div>
<div>
<label className="block text-sm text-gray-400 mb-1">Theme</label>
<select className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg">
<option>Dark</option>
<option>Light</option>
</select>
</div>
</div>
)}
{activeTab === 'providers' && (
<div className="space-y-4">
<h2 className="text-lg font-medium">AI Providers</h2>
<p className="text-gray-400 text-sm">Configure API keys and endpoints</p>
</div>
)}
{activeTab === 'routing' && (
<div className="space-y-4">
<h2 className="text-lg font-medium">Task Routing</h2>
<p className="text-gray-400 text-sm">Map task categories to models</p>
</div>
)}
{activeTab === 'permissions' && (
<div className="space-y-4">
<h2 className="text-lg font-medium">Permissions</h2>
<p className="text-gray-400 text-sm">Configure destructive action policies</p>
</div>
)}
</div>
</div>
</div>
);
}
``

- [ ] **Step 2: Update App.tsx route for Settings**

Replace `<Route path="/settings" element={<PlaceholderPage title="Settings" />} />` with:
`tsx
<Route path="/settings" element={<Settings />} />
`

- [ ] **Step 3: Test settings works**

Run: `pnpm dev`
Expected: Click tabs, see different settings forms

- [ ] **Step 4: Commit**

`bash
git add packages/client/src/
git commit -m "feat: add Settings page with tabs"
`

---

### Task 6: Build Logs Page

**Files:**

- Create: `packages/client/src/pages/Logs.tsx`

**Interfaces:**

- Consumes: Layout from Task 2
- Produces: Real-time log viewer

- [ ] **Step 1: Create Logs page**

``tsx
// packages/client/src/pages/Logs.tsx
import { useState } from 'react';

interface LogEntry {
id: string;
timestamp: Date;
level: 'info' | 'warn' | 'error';
source: string;
message: string;
}

const mockLogs: LogEntry[] = [
{ id: '1', timestamp: new Date(), level: 'info', source: 'orchestrator', message: 'Server started' },
];

export function Logs() {
const [logs] = useState<LogEntry[]>(mockLogs);
const [filter, setFilter] = useState<'all' | 'info' | 'warn' | 'error'>('all');

const filteredLogs = filter === 'all' ? logs : logs.filter(l => l.level === filter);

return (
<div className="p-6 h-full flex flex-col">
<div className="flex items-center justify-between mb-4">
<h1 className="text-2xl font-bold">Logs</h1>
<div className="flex gap-2">
{(['all', 'info', 'warn', 'error'] as const).map(level => (
<button
key={level}
onClick={() => setFilter(level)}
className={`px-3 py-1 rounded text-sm `} >
{level}
</button>
))}
</div>
</div>
<div className="flex-1 bg-gray-900 rounded-lg p-4 font-mono text-sm overflow-auto">
{filteredLogs.map(log => (
<div key={log.id} className="flex gap-3 py-1">
<span className="text-gray-500">{log.timestamp.toLocaleTimeString()}</span>
<span className={
log.level === 'error' ? 'text-red-400' :
log.level === 'warn' ? 'text-yellow-400' : 'text-green-400'
}>
[{log.level.toUpperCase()}]
</span>
<span className="text-gray-400">{log.source}:</span>
<span>{log.message}</span>
</div>
))}
</div>
</div>
);
}
``

- [ ] **Step 2: Update App.tsx route for Logs**

Replace `<Route path="/logs" element={<PlaceholderPage title="Logs" />} />` with:
`tsx
<Route path="/logs" element={<Logs />} />
`

- [ ] **Step 3: Test logs works**

Run: `pnpm dev`
Expected: See log entries, filter by level

- [ ] **Step 4: Commit**

`bash
git add packages/client/src/
git commit -m "feat: add Logs page with filtering"
`

---

## Phase 3: Office Floor (Pixi.js)

### Task 7: Set Up Pixi.js Office Floor

**Files:**

- Create: `packages/client/src/pages/OfficeFloor.tsx`
- Create: `packages/client/src/components/office/OfficeScene.ts`
- Create: `packages/client/src/components/office/AgentSprite.ts`

**Interfaces:**

- Consumes: Layout from Task 2
- Produces: Interactive office floor with agent avatars

- [ ] **Step 1: Install Pixi.js**

Run: `pnpm add pixi.js@^7.0.0`

- [ ] **Step 2: Create OfficeScene class**

``typescript
// packages/client/src/components/office/OfficeScene.ts
import * as PIXI from 'pixi.js';

export class OfficeScene {
private app: PIXI.Application;
private container: PIXI.Container;

constructor(canvas: HTMLCanvasElement) {
this.app = new PIXI.Application({
view: canvas,
width: 800,
height: 600,
backgroundColor: 0x1a1a1a,
});

    this.container = new PIXI.Container();
    this.app.stage.addChild(this.container);

    this.drawOffice();

}

private drawOffice() {
// Draw floor grid
const grid = new PIXI.Graphics();
grid.lineStyle(1, 0x333333);
for (let x = 0; x < 800; x += 50) {
grid.moveTo(x, 0);
grid.lineTo(x, 600);
}
for (let y = 0; y < 600; y += 50) {
grid.moveTo(0, y);
grid.lineTo(800, y);
}
this.container.addChild(grid);

    // Draw desks
    const deskPositions = [
      { x: 100, y: 100 },
      { x: 300, y: 100 },
      { x: 500, y: 100 },
      { x: 100, y: 300 },
      { x: 300, y: 300 },
      { x: 500, y: 300 },
    ];

    deskPositions.forEach(pos => {
      const desk = new PIXI.Graphics();
      desk.beginFill(0x4a4a4a);
      desk.drawRect(pos.x, pos.y, 60, 40);
      desk.endFill();
      this.container.addChild(desk);
    });

}

destroy() {
this.app.destroy(true);
}
}
``

- [ ] **Step 3: Create AgentSprite class**

``typescript
// packages/client/src/components/office/AgentSprite.ts
import * as PIXI from 'pixi.js';

export type AgentStatus = 'working' | 'idle' | 'error' | 'thinking';

export class AgentSprite {
public sprite: PIXI.Graphics;
private status: AgentStatus = 'idle';

constructor(x: number, y: number) {
this.sprite = new PIXI.Graphics();
this.sprite.x = x;
this.sprite.y = y;
this.draw();
}

private draw() {
this.sprite.clear();

    // Body
    const bodyColor = this.status === 'working' ? 0x22c55e :
                      this.status === 'error' ? 0xef4444 :
                      this.status === 'thinking' ? 0xf59e0b : 0x6b7280;

    this.sprite.beginFill(bodyColor);
    this.sprite.drawCircle(0, 0, 15);
    this.sprite.endFill();

    // Status indicator
    if (this.status === 'working') {
      this.sprite.beginFill(0x22c55e);
      this.sprite.drawCircle(12, -12, 4);
      this.sprite.endFill();
    }

}

setStatus(status: AgentStatus) {
this.status = status;
this.draw();
}

setPosition(x: number, y: number) {
this.sprite.x = x;
this.sprite.y = y;
}
}
``

- [ ] **Step 4: Create OfficeFloor page**

``tsx
// packages/client/src/pages/OfficeFloor.tsx
import { useEffect, useRef } from 'react';
import { OfficeScene } from '../components/office/OfficeScene';

export function OfficeFloor() {
const canvasRef = useRef<HTMLCanvasElement>(null);
const sceneRef = useRef<OfficeScene | null>(null);

useEffect(() => {
if (canvasRef.current && !sceneRef.current) {
sceneRef.current = new OfficeScene(canvasRef.current);
}

    return () => {
      sceneRef.current?.destroy();
      sceneRef.current = null;
    };

}, []);

return (
<div className="p-6 h-full flex flex-col">
<h1 className="text-2xl font-bold mb-4">Office Floor</h1>
<div className="flex-1 bg-gray-900 rounded-lg overflow-hidden">
<canvas ref={canvasRef} className="w-full h-full" />
</div>
</div>
);
}
``

- [ ] **Step 5: Update App.tsx route for Office**

Replace `<Route path="/office" element={<PlaceholderPage title="Office Floor" />} />` with:
`tsx
<Route path="/office" element={<OfficeFloor />} />
`

- [ ] **Step 6: Test office floor renders**

Run: `pnpm dev`
Expected: Canvas with grid and desk shapes visible

- [ ] **Step 7: Commit**

`bash
git add packages/client/src/
git commit -m "feat: add Office Floor with Pixi.js canvas and desks"
`

---

### Task 8: Add Agent Avatars to Office Floor

**Files:**

- Modify: `packages/client/src/components/office/OfficeScene.ts`
- Modify: `packages/client/src/pages/OfficeFloor.tsx`

**Interfaces:**

- Consumes: OfficeScene from Task 7
- Produces: Office floor with clickable agent avatars

- [ ] **Step 1: Add agent sprites to OfficeScene**

``typescript
// Add to OfficeScene class
import { AgentSprite } from './AgentSprite';

private agents: AgentSprite[] = [];

// Add method to OfficeScene
addAgent(x: number, y: number, name: string) {
const agent = new AgentSprite(x, y);
this.agents.push(agent);
this.container.addChild(agent.sprite);
return agent;
}

// Update drawOffice to add agents at desk positions
private drawOffice() {
// ... existing grid and desk code ...

// Add agents at desk positions
const agentNames = ['Agent A', 'Agent B', 'Agent C'];
const deskPositions = [
{ x: 130, y: 120 },
{ x: 330, y: 120 },
{ x: 530, y: 120 },
];

deskPositions.forEach((pos, i) => {
if (i < agentNames.length) {
this.addAgent(pos.x, pos.y, agentNames[i]);
}
});
}
``

- [ ] **Step 2: Make agents interactive**

`typescript
// Add to AgentSprite constructor
this.sprite.eventMode = 'static';
this.sprite.cursor = 'pointer';
this.sprite.on('pointerdown', () => {
  console.log('Agent clicked');
});
`

- [ ] **Step 3: Test agents appear and are clickable**

Run: `pnpm dev`
Expected: Colored circles at desk positions, click logs to console

- [ ] **Step 4: Commit**

``bash
git add packages/client/src/
git commit -m "feat: add clickable agent avatars to Office Floor"

````

---

## Phase 4: Backend Extensions

### Task 9: Set Up SQLite Database

**Files:**
- Create: `packages/server/src/database.ts`
- Create: `packages/server/src/migrations/001-initial.sql`

**Interfaces:**
- Consumes: Existing Express server
- Produces: SQLite database with schema

- [ ] **Step 1: Install SQLite dependencies**

Run: `pnpm add better-sqlite3 && pnpm add -D @types/better-sqlite3`

- [ ] **Step 2: Create migration file**

```sql
-- packages/server/src/migrations/001-initial.sql
CREATE TABLE IF NOT EXISTS workflows (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  nodes TEXT NOT NULL,
  edges TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS schedules (
  id TEXT PRIMARY KEY,
  workflow_id TEXT,
  cron_expr TEXT NOT NULL,
  enabled BOOLEAN DEFAULT 1,
  last_run DATETIME,
  next_run DATETIME,
  FOREIGN KEY (workflow_id) REFERENCES workflows(id)
);

CREATE TABLE IF NOT EXISTS schedule_runs (
  id TEXT PRIMARY KEY,
  schedule_id TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME,
  FOREIGN KEY (schedule_id) REFERENCES schedules(id)
);
````

- [ ] **Step 3: Create database module**

```typescript
// packages/server/src/database.ts
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const DB_PATH = path.join(process.cwd(), "data", "hive.db");
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(DB_PATH);
const migrationPath = path.join(__dirname, "migrations", "001-initial.sql");
const migration = fs.readFileSync(migrationPath, "utf-8");
db.exec(migration);

export default db;
```

- [ ] **Step 4: Test database initializes**

Run: `pnpm dev:server`
Expected: `data/hive.db` file created

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/
git commit -m "feat: add SQLite database with initial schema"
```

---

### Task 10: Add Workflow CRUD Endpoints

**Files:**

- Create: `packages/server/src/routes/workflows.ts`
- Modify: `packages/server/src/server.ts`

**Interfaces:**

- Consumes: Database from Task 9
- Produces: REST endpoints for workflows

- [ ] **Step 1: Create workflow routes**

```typescript
// packages/server/src/routes/workflows.ts
import { Router } from "express";
import db from "../database";
import { randomUUID } from "crypto";

const router = Router();

router.get("/", (req, res) => {
  const workflows = db.prepare("SELECT * FROM workflows").all();
  res.json(workflows);
});

router.get("/:id", (req, res) => {
  const workflow = db
    .prepare("SELECT * FROM workflows WHERE id = ?")
    .get(req.params.id);
  if (!workflow) return res.status(404).json({ error: "Workflow not found" });
  res.json(workflow);
});

router.post("/", (req, res) => {
  const { name, nodes, edges } = req.body;
  const id = randomUUID();
  db.prepare(
    "INSERT INTO workflows (id, name, nodes, edges) VALUES (?, ?, ?, ?)",
  ).run(id, name, JSON.stringify(nodes), JSON.stringify(edges));
  const workflow = db.prepare("SELECT * FROM workflows WHERE id = ?").get(id);
  res.status(201).json(workflow);
});

router.put("/:id", (req, res) => {
  const { name, nodes, edges } = req.body;
  db.prepare(
    "UPDATE workflows SET name = ?, nodes = ?, edges = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
  ).run(name, JSON.stringify(nodes), JSON.stringify(edges), req.params.id);
  const workflow = db
    .prepare("SELECT * FROM workflows WHERE id = ?")
    .get(req.params.id);
  res.json(workflow);
});

router.delete("/:id", (req, res) => {
  db.prepare("DELETE FROM workflows WHERE id = ?").run(req.params.id);
  res.status(204).send();
});

export default router;
```

- [ ] **Step 2: Register routes in server.ts**

```typescript
import workflowRoutes from "./routes/workflows";
app.use("/api/workflows", workflowRoutes);
```

- [ ] **Step 3: Test CRUD endpoints**

Run: `pnpm dev:server`
Test: `curl http://localhost:3001/api/workflows`

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/
git commit -m "feat: add workflow CRUD endpoints"
```

---

### Task 11: Add Schedule CRUD Endpoints

**Files:**

- Create: `packages/server/src/routes/schedules.ts`
- Modify: `packages/server/src/server.ts`

**Interfaces:**

- Consumes: Database from Task 9
- Produces: REST endpoints for schedules

- [ ] **Step 1: Create schedule routes**

```typescript
// packages/server/src/routes/schedules.ts
import { Router } from "express";
import db from "../database";
import { randomUUID } from "crypto";

const router = Router();

router.get("/", (req, res) => {
  const schedules = db.prepare("SELECT * FROM schedules").all();
  res.json(schedules);
});

router.post("/", (req, res) => {
  const { workflow_id, cron_expr } = req.body;
  const id = randomUUID();
  db.prepare(
    "INSERT INTO schedules (id, workflow_id, cron_expr) VALUES (?, ?, ?)",
  ).run(id, workflow_id, cron_expr);
  const schedule = db.prepare("SELECT * FROM schedules WHERE id = ?").get(id);
  res.status(201).json(schedule);
});

router.put("/:id", (req, res) => {
  const { workflow_id, cron_expr, enabled } = req.body;
  db.prepare(
    "UPDATE schedules SET workflow_id = ?, cron_expr = ?, enabled = ? WHERE id = ?",
  ).run(workflow_id, cron_expr, enabled ? 1 : 0, req.params.id);
  const schedule = db
    .prepare("SELECT * FROM schedules WHERE id = ?")
    .get(req.params.id);
  res.json(schedule);
});

router.delete("/:id", (req, res) => {
  db.prepare("DELETE FROM schedules WHERE id = ?").run(req.params.id);
  res.status(204).send();
});

export default router;
```

- [ ] **Step 2: Register routes in server.ts**

```typescript
import scheduleRoutes from "./routes/schedules";
app.use("/api/schedules", scheduleRoutes);
```

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/
git commit -m "feat: add schedule CRUD endpoints"
```

---

### Task 12: Add Cron Job Runner

**Files:**

- Create: `packages/server/src/scheduler.ts`
- Modify: `packages/server/src/server.ts`

**Interfaces:**

- Consumes: Database from Task 9, Schedule routes from Task 11
- Produces: Background cron job runner

- [ ] **Step 1: Install node-cron**

Run: `pnpm add node-cron && pnpm add -D @types/node-cron`

- [ ] **Step 2: Create scheduler module**

```typescript
// packages/server/src/scheduler.ts
import cron from "node-cron";
import db from "./database";

const scheduledTasks: Map<string, cron.ScheduledTask> = new Map();

export function startScheduler() {
  const schedules = db
    .prepare("SELECT * FROM schedules WHERE enabled = 1")
    .all();
  schedules.forEach((schedule: any) => {
    scheduleCron(schedule.id, schedule.cron_expr);
  });
  console.log(`Scheduler started with ${schedules.length} jobs`);
}

export function scheduleCron(id: string, cronExpr: string) {
  if (scheduledTasks.has(id)) scheduledTasks.get(id)?.stop();
  const task = cron.schedule(cronExpr, () => {
    console.log(`Running scheduled job: ${id}`);
    const runId = `run_${Date.now()}`;
    db.prepare(
      "INSERT INTO schedule_runs (id, schedule_id, status) VALUES (?, ?, ?)",
    ).run(runId, id, "running");
    db.prepare(
      "UPDATE schedule_runs SET status = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?",
    ).run("completed", runId);
    db.prepare(
      "UPDATE schedules SET last_run = CURRENT_TIMESTAMP WHERE id = ?",
    ).run(id);
  });
  scheduledTasks.set(id, task);
}

export function stopScheduler() {
  scheduledTasks.forEach((task) => task.stop());
  scheduledTasks.clear();
}
```

- [ ] **Step 3: Start scheduler in server.ts**

```typescript
import { startScheduler, stopScheduler } from "./scheduler";
// In start(): startScheduler();
// In stop(): stopScheduler();
```

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/
git commit -m "feat: add cron job scheduler"
```

---

### Task 13: Add SSE Endpoint for Real-Time Updates

**Files:**

- Create: `packages/server/src/routes/events.ts`
- Modify: `packages/server/src/server.ts`

**Interfaces:**

- Consumes: Express server
- Produces: SSE endpoint for real-time events

- [ ] **Step 1: Create events route**

```typescript
// packages/server/src/routes/events.ts
import { Router, Request, Response } from "express";

const router = Router();
const clients: Response[] = [];

router.get("/", (req: Request, res: Response) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  clients.push(res);
  req.on("close", () => {
    const index = clients.indexOf(res);
    if (index > -1) clients.splice(index, 1);
  });
});

export function broadcastEvent(event: string, data: unknown) {
  const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  clients.forEach((client) => client.write(message));
}

export default router;
```

- [ ] **Step 2: Register route in server.ts**

```typescript
import eventRoutes from "./routes/events";
app.use("/api/events", eventRoutes);
```

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/
git commit -m "feat: add SSE endpoint for real-time events"
```

---

## Phase 5: Interactive Features

### Task 14: Build Workflow Builder Page

**Files:**

- Create: `packages/client/src/pages/WorkflowBuilder.tsx`
- Create: `packages/client/src/components/workflow/NodeEditor.tsx`
- Create: `packages/client/src/components/workflow/NodeTypes.ts`

**Interfaces:**

- Consumes: Layout from Task 2, Workflow API from Task 10
- Produces: Visual node editor for workflows

- [ ] **Step 1: Create node type definitions**

```typescript
// packages/client/src/components/workflow/NodeTypes.ts
export interface WorkflowNode {
  id: string;
  type: "start" | "end" | "agent" | "condition" | "action";
  x: number;
  y: number;
  data: Record<string, unknown>;
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
}
```

- [ ] **Step 2: Create NodeEditor component**

```tsx
// packages/client/src/components/workflow/NodeEditor.tsx
import { useState } from "react";
import { WorkflowNode, WorkflowEdge } from "./NodeTypes";

interface NodeEditorProps {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  onNodeAdd: (type: WorkflowNode["type"]) => void;
  onNodeSelect: (id: string | null) => void;
}

export function NodeEditor({
  nodes,
  edges,
  onNodeAdd,
  onNodeSelect,
}: NodeEditorProps) {
  const [selectedNode, setSelectedNode] = useState<string | null>(null);

  const nodeTypes = [
    { type: "start" as const, label: "Start", color: "bg-green-600" },
    { type: "end" as const, label: "End", color: "bg-red-600" },
    { type: "agent" as const, label: "Agent", color: "bg-blue-600" },
    { type: "condition" as const, label: "Condition", color: "bg-yellow-600" },
    { type: "action" as const, label: "Action", color: "bg-purple-600" },
  ];

  return (
    <div className="flex h-full">
      <div className="w-48 bg-gray-900 p-3 space-y-2">
        <div className="text-sm font-medium text-gray-400 mb-2">Add Node</div>
        {nodeTypes.map(({ type, label, color }) => (
          <button
            key={type}
            onClick={() => onNodeAdd(type)}
            className={`w-full px-3 py-2 ${color} rounded text-sm`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="flex-1 bg-gray-800 relative">
        <svg className="w-full h-full">
          {edges.map((edge) => {
            const source = nodes.find((n) => n.id === edge.source);
            const target = nodes.find((n) => n.id === edge.target);
            if (!source || !target) return null;
            return (
              <line
                key={edge.id}
                x1={source.x}
                y1={source.y}
                x2={target.x}
                y2={target.y}
                stroke="#666"
                strokeWidth={2}
              />
            );
          })}
          {nodes.map((node) => (
            <g
              key={node.id}
              transform={`translate(${node.x}, ${node.y})`}
              onClick={() => {
                setSelectedNode(node.id);
                onNodeSelect(node.id);
              }}
              className="cursor-pointer"
            >
              <circle
                r={25}
                className={
                  node.type === "start"
                    ? "fill-green-600"
                    : node.type === "end"
                      ? "fill-red-600"
                      : node.type === "agent"
                        ? "fill-blue-600"
                        : node.type === "condition"
                          ? "fill-yellow-600"
                          : "fill-purple-600"
                }
              />
              <text textAnchor="middle" dy=".3em" fill="white" fontSize={10}>
                {node.type}
              </text>
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create WorkflowBuilder page**

```tsx
// packages/client/src/pages/WorkflowBuilder.tsx
import { useState } from "react";
import { NodeEditor } from "../components/workflow/NodeEditor";
import { WorkflowNode, WorkflowEdge } from "../components/workflow/NodeTypes";

export function WorkflowBuilder() {
  const [nodes, setNodes] = useState<WorkflowNode[]>([]);
  const [edges, setEdges] = useState<WorkflowEdge[]>([]);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);

  const handleNodeAdd = (type: WorkflowNode["type"]) => {
    const newNode: WorkflowNode = {
      id: `node_${Date.now()}`,
      type,
      x: 200 + Math.random() * 200,
      y: 200 + Math.random() * 200,
      data: {},
    };
    setNodes((prev) => [...prev, newNode]);
  };

  return (
    <div className="h-full flex flex-col">
      <div className="p-4 border-b border-gray-800 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Workflow Builder</h1>
        <div className="flex gap-2">
          <button className="px-4 py-2 bg-gray-800 rounded hover:bg-gray-700">
            Save
          </button>
          <button className="px-4 py-2 bg-blue-600 rounded hover:bg-blue-700">
            Run
          </button>
        </div>
      </div>
      <div className="flex-1">
        <NodeEditor
          nodes={nodes}
          edges={edges}
          onNodeAdd={handleNodeAdd}
          onNodeSelect={setSelectedNode}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Update App.tsx route for Workflows**

Replace `<Route path="/workflows" element={<PlaceholderPage title="Workflow Builder" />} />` with:

```tsx
<Route path="/workflows" element={<WorkflowBuilder />} />
```

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/
git commit -m "feat: add Workflow Builder with visual node editor"
```

---

### Task 15: Build Schedule Jobs Page

**Files:**

- Create: `packages/client/src/pages/ScheduleJobs.tsx`
- Create: `packages/client/src/components/schedule/CronEditor.tsx`
- Create: `packages/client/src/components/schedule/CalendarView.tsx`

**Interfaces:**

- Consumes: Layout from Task 2, Schedule API from Task 11
- Produces: Schedule management with cron and calendar views

- [ ] **Step 1: Create CronEditor component**

```tsx
// packages/client/src/components/schedule/CronEditor.tsx
import { useState } from "react";

interface CronEditorProps {
  value: string;
  onChange: (cron: string) => void;
}

export function CronEditor({ value, onChange }: CronEditorProps) {
  const [minute, setMinute] = useState("*");
  const [hour, setHour] = useState("*");
  const [day, setDay] = useState("*");
  const [month, setMonth] = useState("*");
  const [weekday, setWeekday] = useState("*");

  const presets = [
    { label: "Every minute", value: "* * * * *" },
    { label: "Every hour", value: "0 * * * *" },
    { label: "Every day at 9am", value: "0 9 * * *" },
    { label: "Every week", value: "0 9 * * 1" },
    { label: "Every month", value: "0 9 1 * *" },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-5 gap-2">
        <div>
          <label className="block text-xs text-gray-400 mb-1">Minute</label>
          <input
            type="text"
            value={minute}
            onChange={(e) => {
              setMinute(e.target.value);
              onChange(`${e.target.value} ${hour} ${day} ${month} ${weekday}`);
            }}
            className="w-full px-2 py-1 bg-gray-800 border border-gray-700 rounded text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">Hour</label>
          <input
            type="text"
            value={hour}
            onChange={(e) => {
              setHour(e.target.value);
              onChange(
                `${minute} ${e.target.value} ${day} ${month} ${weekday}`,
              );
            }}
            className="w-full px-2 py-1 bg-gray-800 border border-gray-700 rounded text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">Day</label>
          <input
            type="text"
            value={day}
            onChange={(e) => {
              setDay(e.target.value);
              onChange(
                `${minute} ${hour} ${e.target.value} ${month} ${weekday}`,
              );
            }}
            className="w-full px-2 py-1 bg-gray-800 border border-gray-700 rounded text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">Month</label>
          <input
            type="text"
            value={month}
            onChange={(e) => {
              setMonth(e.target.value);
              onChange(`${minute} ${hour} ${day} ${e.target.value} ${weekday}`);
            }}
            className="w-full px-2 py-1 bg-gray-800 border border-gray-700 rounded text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">Weekday</label>
          <input
            type="text"
            value={weekday}
            onChange={(e) => {
              setWeekday(e.target.value);
              onChange(`${minute} ${hour} ${day} ${month} ${e.target.value}`);
            }}
            className="w-full px-2 py-1 bg-gray-800 border border-gray-700 rounded text-sm"
          />
        </div>
      </div>
      <div className="flex gap-2">
        {presets.map((preset) => (
          <button
            key={preset.value}
            onClick={() => {
              const parts = preset.value.split(" ");
              setMinute(parts[0]);
              setHour(parts[1]);
              setDay(parts[2]);
              setMonth(parts[3]);
              setWeekday(parts[4]);
              onChange(preset.value);
            }}
            className="px-3 py-1 bg-gray-800 rounded text-xs hover:bg-gray-700"
          >
            {preset.label}
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create CalendarView component**

```tsx
// packages/client/src/components/schedule/CalendarView.tsx
interface CalendarEvent {
  id: string;
  title: string;
  date: Date;
  cron: string;
}

interface CalendarViewProps {
  events: CalendarEvent[];
}

export function CalendarView({ events }: CalendarViewProps) {
  const daysOfWeek = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const weeks = Array.from({ length: 4 }, (_, weekIdx) =>
    Array.from({ length: 7 }, (_, dayIdx) => {
      const date = new Date();
      date.setDate(date.getDate() - date.getDay() + weekIdx * 7 + dayIdx);
      return date;
    }),
  );

  return (
    <div className="bg-gray-800 rounded-lg p-4">
      <div className="grid grid-cols-7 gap-1 mb-2">
        {daysOfWeek.map((day) => (
          <div key={day} className="text-center text-xs text-gray-400 py-1">
            {day}
          </div>
        ))}
      </div>
      {weeks.map((week, weekIdx) => (
        <div key={weekIdx} className="grid grid-cols-7 gap-1">
          {week.map((date, dayIdx) => {
            const dayEvents = events.filter(
              (e) => e.date.toDateString() === date.toDateString(),
            );
            return (
              <div
                key={dayIdx}
                className="aspect-square p-1 border border-gray-700 rounded"
              >
                <div className="text-xs text-gray-500">{date.getDate()}</div>
                {dayEvents.map((event) => (
                  <div
                    key={event.id}
                    className="text-xs bg-blue-600 rounded px-1 mt-1 truncate"
                  >
                    {event.title}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Create ScheduleJobs page**

```tsx
// packages/client/src/pages/ScheduleJobs.tsx
import { useState } from "react";
import { CronEditor } from "../components/schedule/CronEditor";
import { CalendarView } from "../components/schedule/CalendarView";

interface Schedule {
  id: string;
  workflowName: string;
  cron: string;
  enabled: boolean;
  lastRun?: Date;
}

export function ScheduleJobs() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [view, setView] = useState<"list" | "calendar">("list");
  const [showNew, setShowNew] = useState(false);
  const [newCron, setNewCron] = useState("0 * * * *");

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Schedule Jobs</h1>
        <div className="flex gap-2">
          <button
            onClick={() => setView("list")}
            className={`px-3 py-1 rounded ${view === "list" ? "bg-blue-600" : "bg-gray-800"}`}
          >
            List
          </button>
          <button
            onClick={() => setView("calendar")}
            className={`px-3 py-1 rounded ${view === "calendar" ? "bg-blue-600" : "bg-gray-800"}`}
          >
            Calendar
          </button>
          <button
            onClick={() => setShowNew(true)}
            className="px-3 py-1 bg-green-600 rounded"
          >
            + New Schedule
          </button>
        </div>
      </div>

      {showNew && (
        <div className="bg-gray-900 rounded-lg p-4 mb-4">
          <h2 className="font-medium mb-3">New Schedule</h2>
          <CronEditor value={newCron} onChange={setNewCron} />
          <div className="flex gap-2 mt-3">
            <button
              onClick={() => setShowNew(false)}
              className="px-3 py-1 bg-gray-800 rounded"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                setShowNew(false);
              }}
              className="px-3 py-1 bg-blue-600 rounded"
            >
              Save
            </button>
          </div>
        </div>
      )}

      {view === "list" ? (
        <div className="space-y-2">
          {schedules.map((schedule) => (
            <div
              key={schedule.id}
              className="bg-gray-900 rounded-lg p-4 flex items-center justify-between"
            >
              <div>
                <div className="font-medium">{schedule.workflowName}</div>
                <div className="text-sm text-gray-400">{schedule.cron}</div>
              </div>
              <div className="flex items-center gap-3">
                <span
                  className={`w-2 h-2 rounded-full ${schedule.enabled ? "bg-green-500" : "bg-gray-500"}`}
                />
                <button className="text-gray-400 hover:text-white">Edit</button>
                <button className="text-red-400 hover:text-red-300">
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <CalendarView events={[]} />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Update App.tsx route for Schedule**

Replace `<Route path="/schedule" element={<PlaceholderPage title="Schedule Jobs" />} />` with:

```tsx
<Route path="/schedule" element={<ScheduleJobs />} />
```

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/
git commit -m "feat: add Schedule Jobs page with cron and calendar views"
```

---

### Task 16: Build Memory Page

**Files:**

- Create: `packages/client/src/pages/Memory.tsx`

**Interfaces:**

- Consumes: Layout from Task 2
- Produces: Memory search and browse

- [ ] **Step 1: Create Memory page**

```tsx
// packages/client/src/pages/Memory.tsx
import { useState } from "react";
import { Search } from "lucide-react";

interface MemoryEntry {
  id: string;
  key: string;
  content: string;
  timestamp: Date;
  session?: string;
}

const mockEntries: MemoryEntry[] = [
  {
    id: "1",
    key: "project-context",
    content: "Hive is a multi-agent orchestration framework...",
    timestamp: new Date(),
  },
];

export function Memory() {
  const [entries] = useState<MemoryEntry[]>(mockEntries);
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filtered = entries.filter(
    (e) =>
      e.key.toLowerCase().includes(search.toLowerCase()) ||
      e.content.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="p-6 h-full flex flex-col">
      <h1 className="text-2xl font-bold mb-4">Memory</h1>
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search memory..."
          className="w-full pl-10 pr-4 py-3 bg-gray-800 border border-gray-700 rounded-xl"
        />
      </div>
      <div className="flex-1 space-y-2 overflow-auto">
        {filtered.map((entry) => (
          <div
            key={entry.id}
            className="bg-gray-900 rounded-lg p-4 cursor-pointer hover:bg-gray-800"
            onClick={() =>
              setExpandedId(expandedId === entry.id ? null : entry.id)
            }
          >
            <div className="flex items-center justify-between">
              <div className="font-medium">{entry.key}</div>
              <div className="text-xs text-gray-500">
                {entry.timestamp.toLocaleDateString()}
              </div>
            </div>
            {expandedId === entry.id && (
              <div className="mt-3 text-sm text-gray-300 whitespace-pre-wrap">
                {entry.content}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Update App.tsx route for Memory**

Replace `<Route path="/memory" element={<PlaceholderPage title="Memory" />} />` with:

```tsx
<Route path="/memory" element={<Memory />} />
```

- [ ] **Step 3: Commit**

```bash
git add packages/client/src/
git commit -m "feat: add Memory page with search"
```

---

### Task 17: Build Git Diff Page

**Files:**

- Create: `packages/client/src/pages/GitDiff.tsx`

**Interfaces:**

- Consumes: Layout from Task 2
- Produces: Read-only diff viewer

- [ ] **Step 1: Create GitDiff page**

```tsx
// packages/client/src/pages/GitDiff.tsx
import { useState } from "react";

interface DiffFile {
  path: string;
  additions: number;
  deletions: number;
  hunks: Hunk[];
}

interface Hunk {
  header: string;
  lines: { type: "add" | "remove" | "context"; content: string }[];
}

const mockDiff: DiffFile[] = [
  {
    path: "src/example.ts",
    additions: 5,
    deletions: 2,
    hunks: [
      {
        header: "@@ -1,10 +1,13 @@",
        lines: [
          { type: "context", content: '  import { foo } from "./foo";' },
          { type: "remove", content: "- const x = 1;" },
          { type: "add", content: "+ const x = 2;" },
          { type: "add", content: "+ const y = 3;" },
        ],
      },
    ],
  },
];

export function GitDiff() {
  const [files] = useState<DiffFile[]>(mockDiff);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  const selected = files.find((f) => f.path === selectedFile);

  return (
    <div className="h-full flex">
      <div className="w-64 bg-gray-900 border-r border-gray-800 overflow-auto">
        <div className="p-3 border-b border-gray-800 font-medium">Changes</div>
        {files.map((file) => (
          <button
            key={file.path}
            onClick={() => setSelectedFile(file.path)}
            className={`w-full text-left px-3 py-2 text-sm ${selectedFile === file.path ? "bg-gray-800" : "hover:bg-gray-800/50"}`}
          >
            <div className="truncate">{file.path}</div>
            <div className="text-xs">
              <span className="text-green-400">+{file.additions}</span>
              <span className="text-red-400 ml-2">-{file.deletions}</span>
            </div>
          </button>
        ))}
      </div>
      <div className="flex-1 bg-gray-950 overflow-auto font-mono text-sm">
        {selected ? (
          <div className="p-4">
            <div className="text-gray-400 mb-4">{selected.path}</div>
            {selected.hunks.map((hunk, i) => (
              <div key={i} className="mb-4">
                <div className="text-gray-500 text-xs mb-2">{hunk.header}</div>
                {hunk.lines.map((line, j) => (
                  <div
                    key={j}
                    className={
                      line.type === "add"
                        ? "bg-green-900/30 text-green-300"
                        : line.type === "remove"
                          ? "bg-red-900/30 text-red-300"
                          : ""
                    }
                  >
                    {line.content}
                  </div>
                ))}
              </div>
            ))}
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-gray-500">
            Select a file to view diff
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Update App.tsx route for GitDiff**

Replace `<Route path="/gitdiff" element={<PlaceholderPage title="Git Diff" />} />` with:

```tsx
<Route path="/gitdiff" element={<GitDiff />} />
```

- [ ] **Step 3: Commit**

```bash
git add packages/client/src/
git commit -m "feat: add Git Diff page with read-only viewer"
```

---

### Task 18: Build Permissions Page

**Files:**

- Create: `packages/client/src/pages/Permissions.tsx`

**Interfaces:**

- Consumes: Layout from Task 2
- Produces: Permission queue and history

- [ ] **Step 1: Create Permissions page**

```tsx
// packages/client/src/pages/Permissions.tsx
import { useState } from "react";

interface PermissionRequest {
  id: string;
  action: string;
  timestamp: Date;
  status: "pending" | "approved" | "denied";
}

const mockRequests: PermissionRequest[] = [
  {
    id: "1",
    action: "Delete file src/old.ts",
    timestamp: new Date(),
    status: "pending",
  },
  {
    id: "2",
    action: "Run npm test",
    timestamp: new Date(Date.now() - 60000),
    status: "approved",
  },
];

export function Permissions() {
  const [requests] = useState<PermissionRequest[]>(mockRequests);

  const pending = requests.filter((r) => r.status === "pending");
  const history = requests.filter((r) => r.status !== "pending");

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">Permissions</h1>

      {pending.length > 0 && (
        <div className="mb-6">
          <h2 className="text-lg font-medium mb-3">Pending Approvals</h2>
          <div className="space-y-2">
            {pending.map((req) => (
              <div
                key={req.id}
                className="bg-gray-900 rounded-lg p-4 flex items-center justify-between"
              >
                <div>
                  <div className="font-medium">{req.action}</div>
                  <div className="text-sm text-gray-400">
                    {req.timestamp.toLocaleString()}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button className="px-3 py-1 bg-green-600 rounded text-sm">
                    Approve
                  </button>
                  <button className="px-3 py-1 bg-red-600 rounded text-sm">
                    Deny
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <h2 className="text-lg font-medium mb-3">History</h2>
        <div className="space-y-2">
          {history.map((req) => (
            <div
              key={req.id}
              className="bg-gray-900 rounded-lg p-4 flex items-center justify-between"
            >
              <div>
                <div className="font-medium">{req.action}</div>
                <div className="text-sm text-gray-400">
                  {req.timestamp.toLocaleString()}
                </div>
              </div>
              <span
                className={`px-2 py-1 rounded text-xs ${req.status === "approved" ? "bg-green-900 text-green-300" : "bg-red-900 text-red-300"}`}
              >
                {req.status}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Update App.tsx route for Permissions**

Replace `<Route path="/permissions" element={<PlaceholderPage title="Permissions" />} />` with:

```tsx
<Route path="/permissions" element={<Permissions />} />
```

- [ ] **Step 3: Commit**

```bash
git add packages/client/src/
git commit -m "feat: add Permissions page with queue and history"
```

---

## Summary

| Phase | Tasks | Description                                               |
| ----- | ----- | --------------------------------------------------------- |
| 1     | 1-2   | Electron shell + React Router + Sidebar                   |
| 2     | 3-6   | Chat, Kanban, Settings, Logs                              |
| 3     | 7-8   | Pixi.js Office Floor                                      |
| 4     | 9-13  | SQLite, Workflow/Schedule API, Cron, SSE                  |
| 5     | 14-18 | Workflow Builder, Schedule, Memory, Git Diff, Permissions |

**Total:** 18 tasks across 5 phases
