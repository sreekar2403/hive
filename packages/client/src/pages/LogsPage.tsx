import { useState } from 'react';
import { Search, RefreshCw, AlertTriangle, Info, AlertCircle } from 'lucide-react';

type LogLevel = 'info' | 'warn' | 'error';

interface LogEntry {
  id: string;
  timestamp: string;
  level: LogLevel;
  source: string;
  message: string;
}

const mockLogs: LogEntry[] = [
  { id: '1', timestamp: '2026-08-22 10:30:01', level: 'info', source: 'server', message: 'Server started on port 3001' },
  { id: '2', timestamp: '2026-08-22 10:30:02', level: 'info', source: 'database', message: 'SQLite database initialized' },
  { id: '3', timestamp: '2026-08-22 10:30:05', level: 'info', source: 'orchestrator', message: 'Task abc123 dispatched to claude-code' },
  { id: '4', timestamp: '2026-08-22 10:31:12', level: 'warn', source: 'harness', message: 'claude-code timeout after 60s, retrying...' },
  { id: '5', timestamp: '2026-08-22 10:31:45', level: 'error', source: 'harness', message: 'claude-code failed: permission denied' },
  { id: '6', timestamp: '2026-08-22 10:32:00', level: 'info', source: 'orchestrator', message: 'Task abc123 failed after 3 retries' },
  { id: '7', timestamp: '2026-08-22 10:33:00', level: 'info', source: 'router', message: 'Task def456 routed to opencode' },
  { id: '8', timestamp: '2026-08-22 10:33:15', level: 'info', source: 'harness', message: 'opencode execution started' },
  { id: '9', timestamp: '2026-08-22 10:34:30', level: 'warn', source: 'resource', message: 'File lock conflict on src/app.ts' },
  { id: '10', timestamp: '2026-08-22 10:35:00', level: 'info', source: 'harness', message: 'opencode execution completed successfully' },
  { id: '11', timestamp: '2026-08-22 10:35:01', level: 'info', source: 'orchestrator', message: 'Task def456 completed, 2 files changed' },
  { id: '12', timestamp: '2026-08-22 10:36:00', level: 'error', source: 'server', message: 'Unhandled promise rejection in scheduler' },
];

const levelConfig: Record<LogLevel, { icon: typeof Info; color: string; bg: string }> = {
  info: { icon: Info, color: 'text-blue-400', bg: 'bg-blue-400/10' },
  warn: { icon: AlertTriangle, color: 'text-yellow-400', bg: 'bg-yellow-400/10' },
  error: { icon: AlertCircle, color: 'text-red-400', bg: 'bg-red-400/10' },
};

export function LogsPage() {
  const [filter, setFilter] = useState<LogLevel | 'all'>('all');
  const [search, setSearch] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(false);

  const filtered = mockLogs.filter((log) => {
    if (filter !== 'all' && log.level !== filter) return false;
    if (search && !log.message.toLowerCase().includes(search.toLowerCase()) && !log.source.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="p-6 h-full flex flex-col">
      <h1 className="text-2xl font-bold mb-4">Logs</h1>
      <div className="flex items-center gap-3 mb-4">
        <div className="flex items-center gap-1 bg-gray-900 border border-gray-800 rounded-lg p-1">
          {(['all', 'info', 'warn', 'error'] as const).map((level) => (
            <button key={level} onClick={() => setFilter(level)}
              className={`px-3 py-1 rounded-md text-xs capitalize ${
                filter === level
                  ? "bg-gray-700 text-white"
                  : "text-gray-400 hover:text-gray-200"
              }`}>
              {level}
            </button>
          ))}
        </div>
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search logs..."
            className="w-full bg-gray-900 border border-gray-800 rounded-lg pl-9 pr-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500" />
        </div>
        <button onClick={() => setAutoRefresh(!autoRefresh)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm ${
            autoRefresh ? "bg-blue-600 text-white" : "bg-gray-900 border border-gray-800 text-gray-400"
          }`}>
          <RefreshCw className={`w-4 h-4 ${autoRefresh ? "animate-spin" : ""}`} /> Auto
        </button>
      </div>
      <div className="flex-1 overflow-y-auto bg-gray-950 rounded-xl border border-gray-800">
        {filtered.map((log) => {
          const { icon: Icon, color, bg } = levelConfig[log.level];
          return (
            <div key={log.id} className="flex items-start gap-3 px-4 py-2.5 border-b border-gray-800/50 text-sm">
              <span className="text-gray-600 font-mono text-xs whitespace-nowrap pt-0.5">{log.timestamp}</span>
              <span className={`${bg} ${color} px-1.5 py-0.5 rounded text-xs font-mono flex items-center gap-1`}>
                <Icon className="w-3 h-3" /> {log.level}
              </span>
              <span className="text-gray-500 font-mono text-xs min-w-[80px]">{log.source}</span>
              <span className="text-gray-300 font-mono text-xs">{log.message}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
