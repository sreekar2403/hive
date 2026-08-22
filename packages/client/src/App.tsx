import { BrowserRouter, Routes, Route, Outlet } from 'react-router-dom';
import { Sidebar } from './components/Sidebar';
import { Dashboard } from './pages/Dashboard';
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
          <Route path="office" element={<PlaceholderPage title="Office" />} />
          <Route path="chat" element={<PlaceholderPage title="Chat" />} />
          <Route path="kanban" element={<PlaceholderPage title="Kanban" />} />
          <Route path="workflows" element={<PlaceholderPage title="Workflows" />} />
          <Route path="schedule" element={<PlaceholderPage title="Schedule" />} />
          <Route path="memory" element={<PlaceholderPage title="Memory" />} />
          <Route path="git-diff" element={<PlaceholderPage title="Git Diff" />} />
          <Route path="permissions" element={<PlaceholderPage title="Permissions" />} />
          <Route path="logs" element={<PlaceholderPage title="Logs" />} />
          <Route path="settings" element={<PlaceholderPage title="Settings" />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;