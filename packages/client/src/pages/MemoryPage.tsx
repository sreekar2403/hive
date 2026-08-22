import { useState } from "react";
import {
  Database,
  Plus,
  Edit2,
  Trash2,
  Search,
  Eye,
  EyeOff,
  Save,
  X,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

interface MemoryEntry {
  id: string;
  key: string;
  value: string;
  lastUpdated: string;
}

const mockMemory: MemoryEntry[] = [
  {
    id: "1",
    key: "last_task_id",
    value: "task_abc123def456",
    lastUpdated: "2026-08-22 10:35:01",
  },
  {
    id: "2",
    key: "user_preferences",
    value: JSON.stringify(
      {
        theme: "dark",
        autoSave: true,
        notifications: false,
        defaultHarness: "claude-code",
        maxIterations: 5,
      },
      null,
      2,
    ),
    lastUpdated: "2026-08-22 09:15:30",
  },
  {
    id: "3",
    key: "session_context",
    value: JSON.stringify(
      {
        currentProject: "hive",
        activeBranch: "feature/memory-page",
        recentFiles: [
          "src/pages/MemoryPage.tsx",
          "src/App.tsx",
          "src/components/Sidebar.tsx",
        ],
        openTabs: 3,
      },
      null,
      2,
    ),
    lastUpdated: "2026-08-22 10:00:00",
  },
  {
    id: "4",
    key: "harness_config",
    value: JSON.stringify(
      {
        opencode: { timeout: 120, retries: 3 },
        "claude-code": { timeout: 180, retries: 2 },
        pi: { timeout: 60, retries: 1 },
      },
      null,
      2,
    ),
    lastUpdated: "2026-08-21 16:45:22",
  },
  {
    id: "5",
    key: "recent_tasks",
    value: JSON.stringify(
      [
        { id: "task_abc123", status: "completed", harness: "opencode" },
        { id: "task_def456", status: "failed", harness: "claude-code" },
        { id: "task_ghi789", status: "running", harness: "pi" },
      ],
      null,
      2,
    ),
    lastUpdated: "2026-08-22 10:35:01",
  },
  {
    id: "6",
    key: "git_remotes",
    value: JSON.stringify(
      {
        origin: "https://github.com/user/hive.git",
        upstream: "https://github.com/hive-org/hive.git",
      },
      null,
      2,
    ),
    lastUpdated: "2026-08-20 14:20:00",
  },
  {
    id: "7",
    key: "build_cache",
    value: JSON.stringify(
      {
        lastBuild: "2026-08-22 08:00:00",
        artifacts: ["dist/server.js", "dist/client.js"],
        hash: "a1b2c3d4e5f6",
      },
      null,
      2,
    ),
    lastUpdated: "2026-08-22 08:00:00",
  },
  {
    id: "8",
    key: "feature_flags",
    value: JSON.stringify(
      {
        streamingHarness: false,
        llmRouter: false,
        wsProtocol: false,
        contextCompactor: false,
      },
      null,
      2,
    ),
    lastUpdated: "2026-08-19 12:00:00",
  },
];

const truncateValue = (value: string, maxLength = 60): string => {
  if (value.length <= maxLength) return value;
  return value.slice(0, maxLength) + "...";
};

export function MemoryPage() {
  const [memory, setMemory] = useState<MemoryEntry[]>(mockMemory);
  const [search, setSearch] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [editKey, setEditKey] = useState("");
  const [editValue, setEditValue] = useState("");

  const filteredMemory = memory.filter(
    (entry) =>
      entry.key.toLowerCase().includes(search.toLowerCase()) ||
      entry.value.toLowerCase().includes(search.toLowerCase()),
  );

  const handleAdd = () => {
    if (!newKey.trim() || !newValue.trim()) return;
    const newEntry: MemoryEntry = {
      id: Date.now().toString(),
      key: newKey.trim(),
      value: newValue.trim(),
      lastUpdated: new Date().toISOString().slice(0, 19).replace("T", " "),
    };
    setMemory((prev) => [newEntry, ...prev]);
    setNewKey("");
    setNewValue("");
    setShowAddForm(false);
  };

  const handleEdit = (entry: MemoryEntry) => {
    setEditingId(entry.id);
    setEditKey(entry.key);
    setEditValue(entry.value);
  };

  const handleSaveEdit = (id: string) => {
    if (!editKey.trim() || !editValue.trim()) return;
    setMemory((prev) =>
      prev.map((entry) =>
        entry.id === id
          ? {
              ...entry,
              key: editKey.trim(),
              value: editValue.trim(),
              lastUpdated: new Date()
                .toISOString()
                .slice(0, 19)
                .replace("T", " "),
            }
          : entry,
      ),
    );
    setEditingId(null);
    setEditKey("");
    setEditValue("");
  };

  const handleDelete = (id: string) => {
    if (window.confirm("Delete this memory entry?")) {
      setMemory((prev) => prev.filter((entry) => entry.id !== id));
      if (expandedId === id) setExpandedId(null);
    }
  };

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  return (
    <div className="p-6 h-full flex flex-col">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Database className="w-6 h-6" /> Memory Store
        </h1>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-white text-sm transition-colors"
        >
          <Plus className="w-4 h-4" /> Add Memory
        </button>
      </div>

      {showAddForm && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 mb-6 space-y-4">
          <h2 className="text-lg font-semibold">Add Memory Entry</h2>
          <div className="space-y-3">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Key</label>
              <input
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                placeholder="e.g., user_preferences"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">
                Value (JSON or plain text)
              </label>
              <textarea
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                placeholder='e.g., {"theme": "dark", "autoSave": true}'
                rows={4}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-blue-500 resize-y"
              />
            </div>
            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={handleAdd}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 rounded-lg text-white text-sm"
              >
                <Save className="w-4 h-4" /> Save
              </button>
              <button
                onClick={() => {
                  setShowAddForm(false);
                  setNewKey("");
                  setNewValue("");
                }}
                className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-white text-sm"
              >
                <X className="w-4 h-4" /> Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="mb-4">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search keys or values..."
            className="w-full bg-gray-900 border border-gray-800 rounded-lg pl-9 pr-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
          />
        </div>
      </div>

      <div className="flex-1 overflow-hidden bg-gray-950 rounded-xl border border-gray-800">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-900 border-b border-gray-800">
                <th className="px-4 py-3 text-left font-semibold text-gray-300">
                  Key
                </th>
                <th className="px-4 py-3 text-left font-semibold text-gray-300">
                  Value
                </th>
                <th className="px-4 py-3 text-left font-semibold text-gray-300">
                  Last Updated
                </th>
                <th className="px-4 py-3 text-left font-semibold text-gray-300 w-32">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/50">
              {filteredMemory.length === 0 ? (
                <tr>
                  <td
                    colSpan={4}
                    className="px-4 py-8 text-center text-gray-500"
                  >
                    {search
                      ? "No matching entries found"
                      : "No memory entries yet"}
                  </td>
                </tr>
              ) : (
                filteredMemory.map((entry) => (
                  <React.Fragment key={entry.id}>
                    <tr className="hover:bg-gray-900/50 transition-colors">
                      <td className="px-4 py-3 font-mono text-gray-100">
                        {entry.key}
                      </td>
                      <td className="px-4 py-3">
                        {editingId === entry.id ? (
                          <textarea
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            rows={2}
                            className="w-full bg-gray-800 border border-blue-500 rounded-lg px-3 py-1.5 text-white text-xs font-mono focus:outline-none resize-y"
                          />
                        ) : expandedId === entry.id ? (
                          <div className="bg-gray-800 border border-gray-700 rounded-lg p-2 max-h-48 overflow-y-auto">
                            <pre className="text-xs text-gray-300 font-mono whitespace-pre-wrap">
                              {entry.value}
                            </pre>
                          </div>
                        ) : (
                          <span
                            className="text-gray-400 font-mono text-xs truncate block max-w-xs"
                            title={entry.value}
                          >
                            {truncateValue(entry.value)}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-500 font-mono text-xs whitespace-nowrap">
                        {entry.lastUpdated}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          {editingId === entry.id ? (
                            <>
                              <button
                                onClick={() => handleSaveEdit(entry.id)}
                                className="p-1.5 text-green-400 hover:bg-green-400/10 rounded transition-colors"
                                title="Save"
                              >
                                <Save className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => {
                                  setEditingId(null);
                                  setEditKey("");
                                  setEditValue("");
                                }}
                                className="p-1.5 text-gray-400 hover:bg-gray-700/50 rounded transition-colors"
                                title="Cancel"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                onClick={() => handleEdit(entry)}
                                className="p-1.5 text-blue-400 hover:bg-blue-400/10 rounded transition-colors"
                                title="Edit"
                              >
                                <Edit2 className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => toggleExpand(entry.id)}
                                className="p-1.5 text-gray-400 hover:bg-gray-700/50 rounded transition-colors"
                                title={
                                  expandedId === entry.id
                                    ? "Collapse"
                                    : "Expand"
                                }
                              >
                                {expandedId === entry.id ? (
                                  <ChevronUp className="w-4 h-4" />
                                ) : (
                                  <ChevronDown className="w-4 h-4" />
                                )}
                              </button>
                              <button
                                onClick={() => handleDelete(entry.id)}
                                className="p-1.5 text-red-400 hover:bg-red-400/10 rounded transition-colors"
                                title="Delete"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                    {editingId === entry.id && (
                      <tr className="bg-gray-900/50">
                        <td
                          colSpan={4}
                          className="px-4 py-2 border-t border-gray-800/50"
                        >
                          <div className="space-y-2">
                            <div>
                              <label className="block text-xs text-gray-500 mb-1">
                                Key
                              </label>
                              <input
                                value={editKey}
                                onChange={(e) => setEditKey(e.target.value)}
                                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-white text-sm focus:outline-none focus:border-blue-500"
                              />
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-3 border-t border-gray-800 text-xs text-gray-500">
          {filteredMemory.length} of {memory.length} entries
        </div>
      </div>
    </div>
  );
}
