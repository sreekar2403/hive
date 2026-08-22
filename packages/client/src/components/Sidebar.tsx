import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Building2,
  MessageSquare,
  Kanban,
  GitBranch,
  Calendar,
  Database,
  GitCompare,
  Shield,
  FileText,
  Settings,
} from 'lucide-react';

const navItems = [
  { path: '/', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/office', label: 'Office', icon: Building2 },
  { path: '/chat', label: 'Chat', icon: MessageSquare },
  { path: '/kanban', label: 'Kanban', icon: Kanban },
  { path: '/workflows', label: 'Workflows', icon: GitBranch },
  { path: '/schedule', label: 'Schedule', icon: Calendar },
  { path: '/memory', label: 'Memory', icon: Database },
  { path: '/git-diff', label: 'Git Diff', icon: GitCompare },
  { path: '/permissions', label: 'Permissions', icon: Shield },
  { path: '/logs', label: 'Logs', icon: FileText },
  { path: '/settings', label: 'Settings', icon: Settings },
] as const;

export function Sidebar() {
  const location = useLocation();

  return (
    <aside className="w-64 bg-gray-900 border-r border-gray-800 flex flex-col h-screen">
      <div className="p-4 border-b border-gray-800">
        <h1 className="text-xl font-bold text-white">Hive</h1>
      </div>
      <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
        {navItems.map(({ path, label, icon: Icon }) => (
          <NavLink
            key={path}
            to={path}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
                isActive
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-400 hover:bg-gray-800 hover:text-white'
              }`
            }
          >
            <Icon className="w-5 h-5 flex-shrink-0" aria-hidden="true" />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
      <div className="p-4 border-t border-gray-800">
        <p className="text-xs text-gray-500 text-center">v0.1.0</p>
      </div>
    </aside>
  );
}