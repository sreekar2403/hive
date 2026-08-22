import { BrowserRouter, Routes, Route, Outlet } from 'react-router-dom';
import { Sidebar } from './components/Sidebar';
import { Dashboard } from './pages/Dashboard';
import { OfficeFloorPage } from './pages/OfficeFloorPage';
import { ChatPage } from './pages/ChatPage';
import { KanbanPage } from './pages/KanbanPage';
import { SettingsPage } from './pages/SettingsPage';
import { LogsPage } from './pages/LogsPage';
import { PlaceholderPage } from './pages/PlaceholderPage';

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
          <Route path="workflows" element={<PlaceholderPage title="Workflow Builder" />} />
          <Route path="schedule" element={<PlaceholderPage title="Schedule Jobs" />} />
          <Route path="memory" element={<PlaceholderPage title="Memory" />} />
          <Route path="git-diff" element={<PlaceholderPage title="Git Diff" />} />
          <Route path="permissions" element={<PlaceholderPage title="Permissions" />} />
          <Route path="logs" element={<LogsPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
