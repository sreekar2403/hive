import { useState } from "react";
import {
  Shield,
  Plus,
  Trash2,
  Lock,
  Unlock,
  ToggleLeft,
  ToggleRight,
  FileText,
  GitBranch,
  Database,
  AlertTriangle,
} from "lucide-react";

interface PermissionRule {
  id: string;
  action: string;
  resource: string;
  permission: "allow" | "deny";
  scope: string;
  enabled: boolean;
}

const scopeOptions = [
  { value: "global", label: "Global" },
  { value: "src/**", label: "Source Files (src/**)" },
  { value: "dist/**", label: "Build Output (dist/**)" },
  { value: "*.json", label: "JSON Files" },
  { value: "*.md", label: "Markdown Files" },
  { value: "custom", label: "Custom..." },
];

const initialRules: PermissionRule[] = [
  {
    id: "1",
    action: "file write",
    resource: "filesystem",
    permission: "allow",
    scope: "src/**",
    enabled: true,
  },
  {
    id: "2",
    action: "git push",
    resource: "git",
    permission: "deny",
    scope: "global",
    enabled: true,
  },
  {
    id: "3",
    action: "database write",
    resource: "database",
    permission: "allow",
    scope: "global",
    enabled: true,
  },
  {
    id: "4",
    action: "destructive actions",
    resource: "system",
    permission: "deny",
    scope: "global",
    enabled: true,
  },
];

export function PermissionsPage() {
  const [rules, setRules] = useState<PermissionRule[]>(initialRules);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newRule, setNewRule] = useState({
    action: "",
    resource: "",
    permission: "allow" as "allow" | "deny",
    scope: "global",
    customScope: "",
  });

  const handleAddRule = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRule.action.trim() || !newRule.resource.trim()) return;

    const scope = newRule.scope === "custom" ? newRule.customScope : newRule.scope;
    if (newRule.scope === "custom" && !scope.trim()) return;

    const newPermissionRule: PermissionRule = {
      id: Date.now().toString(),
      action: newRule.action.trim(),
      resource: newRule.resource.trim(),
      permission: newRule.permission,
      scope,
      enabled: true,
    };

    setRules((prev) => [...prev, newPermissionRule]);
    setShowAddForm(false);
    setNewRule({
      action: "",
      resource: "",
      permission: "allow",
      scope: "global",
      customScope: "",
    });
  };

  const handleDeleteRule = (id: string) => {
    setRules((prev) => prev.filter((rule) => rule.id !== id));
  };

  const handleToggleEnabled = (id: string) => {
    setRules((prev) =>
      prev.map((rule) =>
        rule.id === id ? { ...rule, enabled: !rule.enabled } : rule
      )
    );
  };

  const handlePermissionChange = (id: string, permission: "allow" | "deny") => {
    setRules((prev) =>
      prev.map((rule) =>
        rule.id === id ? { ...rule, permission } : rule
      )
    );
  };

  const getResourceIcon = (resource: string) => {
    switch (resource) {
      case "filesystem":
        return FileText;
      case "git":
        return GitBranch;
      case "database":
        return Database;
      case "system":
        return AlertTriangle;
      default:
        return Shield;
    }
  };

  return (
    <div className="p-6 max-w-6xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Shield className="w-6 h-6" /> Permissions
        </h1>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-white text-sm transition-colors"
        >
          <Plus className="w-4 h-4" /> Add Rule
        </button>
      </div>

      {showAddForm && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-4">
          <h2 className="text-lg font-semibold">Add New Permission Rule</h2>
          <form onSubmit={handleAddRule} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Action</label>
                <input
                  type="text"
                  value={newRule.action}
                  onChange={(e) =>
                    setNewRule((prev) => ({ ...prev, action: e.target.value }))
                  }
                  placeholder="e.g., file read, git commit, database delete"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                  required
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Resource</label>
                <input
                  type="text"
                  value={newRule.resource}
                  onChange={(e) =>
                    setNewRule((prev) => ({ ...prev, resource: e.target.value }))
                  }
                  placeholder="e.g., filesystem, git, database, system"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                  required
                />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Permission</label>
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      value="allow"
                      checked={newRule.permission === "allow"}
                      onChange={(e) =>
                        setNewRule((prev) => ({
                          ...prev,
                          permission: e.target.value as "allow" | "deny",
                        }))
                      }
                      className="w-4 h-4 text-blue-600 bg-gray-800 border-gray-700 focus:ring-blue-500"
                    />
                    <span className="flex items-center gap-1 text-white">
                      <Unlock className="w-4 h-4 text-green-500" /> Allow
                    </span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      value="deny"
                      checked={newRule.permission === "deny"}
                      onChange={(e) =>
                        setNewRule((prev) => ({
                          ...prev,
                          permission: e.target.value as "allow" | "deny",
                        }))
                      }
                      className="w-4 h-4 text-blue-600 bg-gray-800 border-gray-700 focus:ring-blue-500"
                    />
                    <span className="flex items-center gap-1 text-white">
                      <Lock className="w-4 h-4 text-red-500" /> Deny
                    </span>
                  </label>
                </div>
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Scope</label>
                <select
                  value={newRule.scope}
                  onChange={(e) =>
                    setNewRule((prev) => ({ ...prev, scope: e.target.value }))
                  }
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                >
                  {scopeOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {newRule.scope === "custom" && (
              <div>
                <label className="block text-sm text-gray-400 mb-1">Custom Scope</label>
                <input
                  type="text"
                  value={newRule.customScope}
                  onChange={(e) =>
                    setNewRule((prev) => ({ ...prev, customScope: e.target.value }))
                  }
                  placeholder="e.g., src/components/**, tests/**"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                />
              </div>
            )}
            <div className="flex gap-3 pt-2">
              <button
                type="submit"
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-white text-sm"
              >
                <Plus className="w-4 h-4" /> Add Rule
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowAddForm(false);
                  setNewRule({
                    action: "",
                    resource: "",
                    permission: "allow",
                    scope: "global",
                    customScope: "",
                  });
                }}
                className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-white text-sm"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-800 border-b border-gray-700">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  Action
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  Resource
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  Permission
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  Scope
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {rules.map((rule) => {
                const ResourceIcon = getResourceIcon(rule.resource);
                return (
                  <tr key={rule.id} className="hover:bg-gray-800/50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <ResourceIcon className="w-5 h-5 text-gray-400" aria-hidden="true" />
                        <span className="text-sm text-white font-medium">{rule.action}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm text-gray-300 capitalize">{rule.resource}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() =>
                            handlePermissionChange(
                              rule.id,
                              rule.permission === "allow" ? "deny" : "allow"
                            )
                          }
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                            rule.permission === "allow"
                              ? "bg-green-900/30 text-green-400 hover:bg-green-900/50"
                              : "bg-red-900/30 text-red-400 hover:bg-red-900/50"
                          }`}
                          aria-label={`Change permission to ${rule.permission === "allow" ? "deny" : "allow"}`}
                        >
                          {rule.permission === "allow" ? (
                            <Unlock className="w-3.5 h-3.5" aria-hidden="true" />
                          ) : (
                            <Lock className="w-3.5 h-3.5" aria-hidden="true" />
                          )}
                          {rule.permission === "allow" ? "Allow" : "Deny"}
                        </button>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm text-gray-300 font-mono">{rule.scope}</span>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => handleToggleEnabled(rule.id)}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                          rule.enabled
                            ? "bg-green-900/30 text-green-400 hover:bg-green-900/50"
                            : "bg-gray-800 text-gray-500 hover:bg-gray-700"
                        }`}
                        aria-label={rule.enabled ? "Disable rule" : "Enable rule"}
                        aria-pressed={rule.enabled}
                      >
                        {rule.enabled ? (
                          <ToggleRight className="w-3.5 h-3.5" aria-hidden="true" />
                        ) : (
                          <ToggleLeft className="w-3.5 h-3.5" aria-hidden="true" />
                        )}
                        {rule.enabled ? "Enabled" : "Disabled"}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => handleDeleteRule(rule.id)}
                        className="p-2 text-gray-400 hover:text-red-400 hover:bg-red-900/20 rounded-lg transition-colors"
                        aria-label="Delete rule"
                      >
                        <Trash2 className="w-4 h-4" aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {rules.length === 0 && (
          <div className="p-12 text-center">
            <Shield className="w-12 h-12 text-gray-700 mx-auto mb-4" aria-hidden="true" />
            <p className="text-gray-500">No permission rules configured</p>
            <p className="text-sm text-gray-600 mt-1">
              Click "Add Rule" to create your first permission rule
            </p>
          </div>
        )}
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
        <h2 className="text-lg font-semibold flex items-center gap-2 mb-4">
          <Shield className="w-5 h-5" /> Legend
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-gray-300">
          <div className="flex items-center gap-2">
            <Unlock className="w-4 h-4 text-green-500" aria-hidden="true" />
            <span>Allow - Operation is permitted</span>
          </div>
          <div className="flex items-center gap-2">
            <Lock className="w-4 h-4 text-red-500" aria-hidden="true" />
            <span>Deny - Operation is blocked</span>
          </div>
          <div className="flex items-center gap-2">
            <ToggleRight className="w-4 h-4 text-green-500" aria-hidden="true" />
            <span>Enabled - Rule is active</span>
          </div>
          <div className="flex items-center gap-2">
            <ToggleLeft className="w-4 h-4 text-gray-500" aria-hidden="true" />
            <span>Disabled - Rule is inactive</span>
          </div>
        </div>
      </div>
    </div>
  );
}