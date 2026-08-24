import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { HashRouter, Routes, Route, Outlet } from "react-router-dom";
import { Sidebar } from "./components/Sidebar";
import { TopBar } from "./components/TopBar";
import { ThemeContext, type Theme } from "./components/ui";
import { ProjectProvider } from "./state/ProjectContext";
import { ChatProvider } from "./state/ChatContext";
import { LogsProvider } from "./state/LogsContext";
import { Dashboard } from "./pages/Dashboard";
import { ChatPage } from "./pages/ChatPage";
import { KanbanPage } from "./pages/KanbanPage";
import { SettingsPage } from "./pages/SettingsPage";
import { LogsPage } from "./pages/LogsPage";
import { WorkflowBuilderPage } from "./pages/WorkflowBuilderPage";
import { SchedulePage } from "./pages/SchedulePage";
import { GitDiffPage } from "./pages/GitDiffPage";
import { MemoryPage } from "./pages/MemoryPage";
import { PermissionsPage } from "./pages/PermissionsPage";

// pixi.js is the largest dependency in the bundle and only the Office
// uses it, so it gets its own chunk.
const OfficeFloorPage = lazy(() =>
  import("./pages/OfficeFloorPage").then((m) => ({
    default: m.OfficeFloorPage,
  })),
);

const THEME_KEY = "hive.theme";

function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      const stored = localStorage.getItem(THEME_KEY);
      if (stored === "light" || stored === "dark") return stored;
    } catch {
      /* storage unavailable */
    }
    return "dark";
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* storage unavailable */
    }
  }, [theme]);

  const value = useMemo(() => ({ theme, setTheme }), [theme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

function Layout() {
  return (
    <div className="flex h-screen overflow-hidden bg-bg text-ink">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar />
        <main className="flex-1 overflow-auto min-h-0">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function PageFallback() {
  return (
    <div className="flex items-center justify-center h-full text-[13px] text-muted">
      Loading…
    </div>
  );
}

function App() {
  return (
    <ThemeProvider>
      <ProjectProvider>
        {/* Chat and Logs state is deliberately mounted above the router:
            a task keeps running — and its log tail keeps filling — while
            you are looking at another page. */}
        <ChatProvider>
          <LogsProvider>
            <HashRouter>
              <Routes>
                <Route path="/" element={<Layout />}>
                  <Route index element={<Dashboard />} />
                  <Route
                    path="office"
                    element={
                      <Suspense fallback={<PageFallback />}>
                        <OfficeFloorPage />
                      </Suspense>
                    }
                  />
                  <Route path="chat" element={<ChatPage />} />
                  <Route path="kanban" element={<KanbanPage />} />
                  <Route path="workflows" element={<WorkflowBuilderPage />} />
                  <Route path="schedule" element={<SchedulePage />} />
                  <Route path="memory" element={<MemoryPage />} />
                  <Route path="git-diff" element={<GitDiffPage />} />
                  <Route path="permissions" element={<PermissionsPage />} />
                  <Route path="logs" element={<LogsPage />} />
                  <Route path="settings" element={<SettingsPage />} />
                </Route>
              </Routes>
            </HashRouter>
          </LogsProvider>
        </ChatProvider>
      </ProjectProvider>
    </ThemeProvider>
  );
}

export default App;
