import { BrowserRouter, Routes, Route, Outlet } from "react-router-dom";
import { Sidebar } from "./components/Sidebar";
import { Dashboard } from "./pages/Dashboard";
import { OfficeFloorPage } from "./pages/OfficeFloorPage";
import { ChatPage } from "./pages/ChatPage";
import { KanbanPage } from "./pages/KanbanPage";
import { SettingsPage } from "./pages/SettingsPage";
import { LogsPage } from "./pages/LogsPage";
import { WorkflowBuilderPage } from "./pages/WorkflowBuilderPage";
import { GitDiffPage } from "./pages/GitDiffPage";
import { MemoryPage } from "./pages/MemoryPage";
import { PermissionsPage } from "./pages/PermissionsPage";

function Layout() {
  return (
    <div className="flex h-screen bg-gray-950 text-gray-100">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="office" element={<OfficeFloorPage />} />
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
    </BrowserRouter>
  );
}

export default App;
