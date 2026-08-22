import { useState } from 'react';
import { Save, Key, Bot, Clock } from 'lucide-react';

export function SettingsPage() {
  const [settings, setSettings] = useState({
    appName: 'Hive',
    theme: 'dark',
    maxIterations: 5,
    timeout: 120,
    apiKey: '',
    model: 'gpt-4',
  });

  const update = (key: string, value: string | number) =>
    setSettings((prev) => ({ ...prev, [key]: value }));

  const handleSave = () => {
    alert('Settings saved (local state only for now)');
  };

  return (
    <div className="p-6 max-w-3xl space-y-6">
      <h1 className="text-2xl font-bold">Settings</h1>

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-4">
        <h2 className="text-lg font-semibold flex items-center gap-2"><Bot className="w-5 h-5" /> General</h2>
        <div className="space-y-3">
          <div>
            <label className="block text-sm text-gray-400 mb-1">App Name</label>
            <input value={settings.appName} onChange={(e) => update('appName', e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500" />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Theme</label>
            <select value={settings.theme} onChange={(e) => update('theme', e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500">
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select>
          </div>
        </div>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-4">
        <h2 className="text-lg font-semibold flex items-center gap-2"><Clock className="w-5 h-5" /> Agent Config</h2>
        <div className="space-y-3">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Max Iterations</label>
            <input type="number" value={settings.maxIterations} onChange={(e) => update('maxIterations', parseInt(e.target.value) || 0)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500" />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Timeout (seconds)</label>
            <input type="number" value={settings.timeout} onChange={(e) => update('timeout', parseInt(e.target.value) || 0)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500" />
          </div>
        </div>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-4">
        <h2 className="text-lg font-semibold flex items-center gap-2"><Key className="w-5 h-5" /> Model Settings</h2>
        <div className="space-y-3">
          <div>
            <label className="block text-sm text-gray-400 mb-1">API Key</label>
            <input type="password" value={settings.apiKey} onChange={(e) => update('apiKey', e.target.value)} placeholder="sk-..."
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500" />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Model</label>
            <select value={settings.model} onChange={(e) => update('model', e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500">
              <option value="gpt-4">GPT-4</option>
              <option value="gpt-3.5-turbo">GPT-3.5 Turbo</option>
              <option value="claude-3-opus">Claude 3 Opus</option>
              <option value="claude-3-sonnet">Claude 3 Sonnet</option>
            </select>
          </div>
        </div>
      </div>

      <button onClick={handleSave} className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-white text-sm">
        <Save className="w-4 h-4" /> Save Settings
      </button>
    </div>
  );
}
