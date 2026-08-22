import { useState, useEffect } from "react";
import {
  GitBranch,
  FilePlus,
  FileMinus,
  FileEdit,
  RefreshCw,
  ChevronRight,
} from "lucide-react";

type DiffType = "unstaged" | "staged";

interface DiffFile {
  path: string;
  status: "added" | "modified" | "deleted";
  diff: string;
}

interface GitDiffResponse {
  files: DiffFile[];
}

const statusConfig = {
  added: {
    icon: FilePlus,
    color: "text-green-400",
    bg: "bg-green-400/10",
    label: "Added",
  },
  modified: {
    icon: FileEdit,
    color: "text-yellow-400",
    bg: "bg-yellow-400/10",
    label: "Modified",
  },
  deleted: {
    icon: FileMinus,
    color: "text-red-400",
    bg: "bg-red-400/10",
    label: "Deleted",
  },
} as const;

const mockUnstagedDiff: GitDiffResponse = {
  files: [
    {
      path: "src/components/Button.tsx",
      status: "modified",
      diff: `diff --git a/src/components/Button.tsx b/src/components/Button.tsx
index a1b2c3d..e4f5g6h 100644
--- a/src/components/Button.tsx
+++ b/src/components/Button.tsx
@@ -1,12 +1,15 @@
 import { ButtonHTMLAttributes, forwardRef } from 'react';
 
 export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
   variant?: 'primary' | 'secondary' | 'outline' | 'ghost';
+  size?: 'sm' | 'md' | 'lg';
   isLoading?: boolean;
 }
 
 export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
   ({ variant = 'primary', size = 'md', isLoading, children, className = '', disabled, ...props }, ref) => {
     const baseStyles = 'inline-flex items-center justify-center font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed';
 
     const variantStyles = {
       primary: 'bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-500',
       secondary: 'bg-gray-100 text-gray-900 hover:bg-gray-200 focus:ring-gray-500',
       outline: 'border border-gray-300 bg-transparent hover:bg-gray-50 focus:ring-gray-500',
       ghost: 'bg-transparent hover:bg-gray-100 focus:ring-gray-500',
     };
 
     const sizeStyles = {
       sm: 'px-3 py-1.5 text-sm gap-1.5',
       md: 'px-4 py-2 text-base gap-2',
       lg: 'px-6 py-3 text-lg gap-2.5',
     };
 
     return (
       <button
         ref={ref}
         className={\`\${baseStyles} \${variantStyles[variant]} \${sizeStyles[size]} \${className}\`}
         disabled={disabled || isLoading}
         {...props}
       >
         {isLoading && <span className="animate-spin">⏳</span>}
         {children}
       </button>
     );
   }
 );
 
 Button.displayName = 'Button';
`,
    },
    {
      path: "src/hooks/useDebounce.ts",
      status: "added",
      diff: `diff --git a/src/hooks/useDebounce.ts b/src/hooks/useDebounce.ts
new file mode 100644
index 0000000..f7e8d9c
--- /dev/null
+++ b/src/hooks/useDebounce.ts
@@ -0,0 +1,35 @@
+import { useState, useEffect } from 'react';
+
+export function useDebounce<T>(value: T, delay: number): T {
+  const [debouncedValue, setDebouncedValue] = useState<T>(value);
+
+  useEffect(() => {
+    const handler = setTimeout(() => {
+      setDebouncedValue(value);
+    }, delay);
+
+    return () => {
+      clearTimeout(handler);
+    };
+  }, [value, delay]);
+
+  return debouncedValue;
+}
+
+export function useDebouncedCallback<T extends (...args: unknown[]) => unknown>(
+  callback: T,
+  delay: number
+): (...args: Parameters<T>) => void {
+  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
+
+  return (...args: Parameters<T>) => {
+    if (timeoutRef.current) {
+      clearTimeout(timeoutRef.current);
+    }
+
+    timeoutRef.current = setTimeout(() => {
+      callback(...args);
+    }, delay);
+  };
+}
`,
    },
    {
      path: "src/utils/dateUtils.ts",
      status: "deleted",
      diff: `diff --git a/src/utils/dateUtils.ts b/src/utils/dateUtils.ts
deleted file mode 100644
index f7e8d9c..0000000
--- a/src/utils/dateUtils.ts
+++ /dev/null
@@ -1,28 +0,0 @@
-import { format, parseISO, isValid } from 'date-fns';
-
-export function formatDate(date: Date | string, pattern = 'PP'): string {
-  const d = typeof date === 'string' ? parseISO(date) : date;
-  if (!isValid(d)) return 'Invalid date';
-  return format(d, pattern);
-}
-
-export function formatRelativeTime(date: Date | string): string {
-  const d = typeof date === 'string' ? parseISO(date) : date;
-  if (!isValid(d)) return 'Invalid date';
-
-  const now = new Date();
-  const diffMs = now.getTime() - d.getTime();
-  const diffSecs = Math.floor(diffMs / 1000);
-  const diffMins = Math.floor(diffSecs / 60);
-  const diffHours = Math.floor(diffMins / 60);
-  const diffDays = Math.floor(diffHours / 24);
-
-  if (diffSecs < 60) return 'just now';
-  if (diffMins < 60) return \`\${diffMins}m ago\`;
-  if (diffHours < 24) return \`\${diffHours}h ago\`;
-  if (diffDays < 7) return \`\${diffDays}d ago\`;
-  return formatDate(d);
-}
-
-export function isToday(date: Date | string): boolean {
-  const d = typeof date === 'string' ? parseISO(date) : date;
-  const today = new Date();
-  return d.getDate() === today.getDate() &&
-         d.getMonth() === today.getMonth() &&
-         d.getFullYear() === today.getFullYear();
-}
`,
    },
    {
      path: "package.json",
      status: "modified",
      diff: `diff --git a/package.json b/package.json
index 1a2b3c4..5d6e7f8 100644
--- a/package.json
+++ b/package.json
@@ -10,7 +10,8 @@
   "dependencies": {
     "lucide-react": "^0.460.0",
     "next": "^15.0.0",
     "pixi.js": "^8.20.0",
     "react": "^19.0.0",
     "react-dom": "^19.0.0",
-    "react-router-dom": "^7.18.2"
+    "react-router-dom": "^7.18.2",
+    "date-fns": "^3.6.0"
   },
   "devDependencies": {
     "@electron-forge/cli": "^7.11.2",
@@ -20,6 +21,7 @@
     "@types/react": "^19.0.0",
     "@types/react-dom": "^19.0.0",
     "concurrently": "^10.0.5",
     "electron": "^43.4.1",
     "electron-builder": "^24.0.0",
     "tailwindcss": "^3.4.0",
     "typescript": "^5.7.0",
     "wait-on": "^9.1.0"
   }
 }
`,
    },
  ],
};

const mockStagedDiff: GitDiffResponse = {
  files: [
    {
      path: "src/pages/Dashboard.tsx",
      status: "modified",
      diff: `diff --git a/src/pages/Dashboard.tsx b/src/pages/Dashboard.tsx
index a1b2c3d..e4f5g6h 100644
--- a/src/pages/Dashboard.tsx
+++ b/src/pages/Dashboard.tsx
@@ -26,7 +26,7 @@ export function Dashboard() {
       <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
         <StatCard
           title="Active Agents"
-          value={0}
+          value={3}
           icon={Users}
           color="bg-blue-500"
         />
@@ -37,7 +37,7 @@ export function Dashboard() {
         <StatCard
           title="Tasks Completed"
-          value={0}
+          value={42}
           icon={CheckCircle}
           color="bg-green-500"
         />
@@ -44,7 +44,7 @@ export function Dashboard() {
         <StatCard
           title="Queue Depth"
-          value={0}
+          value={7}
           icon={Clock}
           color="bg-amber-500"
         />
`,
    },
    {
      path: "README.md",
      status: "added",
      diff: `diff --git a/README.md b/README.md
new file mode 100644
index 0000000..a1b2c3d
--- /dev/null
+++ b/README.md
@@ -0,0 +1,45 @@
+# Hive
+
+A multi-agent orchestration framework for running AI coding agents in parallel.
+
+## Features
+
+- **Multi-agent support**: Run opencode, Claude Code, and pi agents
+- **Task routing**: Automatic routing based on task keywords
+- **Retry logic**: Configurable retry with exponential backoff
+- **Shared memory**: Persistent key-value store across sessions
+- **Git integration**: Automatic PR creation on task completion
+
+## Quick Start
+
+\`\`\`bash
+pnpm install
+pnpm dev:server
+pnpm dev:client
+\`\`\`
+
+## Architecture
+
+The system consists of:
+
+1. **Client** (Next.js + React) - Chat UI for dispatching tasks
+2. **Server** (Express) - Orchestrates agents and manages state
+3. **Harnesses** - CLI wrappers for each AI agent
+4. **Shared** - Type definitions and protocols
+
+## Configuration
+
+Edit \`packages/server/src/config.ts\` to customize:
+- Server port
+- Loop max iterations
+- Destructive action patterns
+- Permission timeout
+
+## License
+
+MIT
`,
    },
  ],
};

function parseDiff(
  diff: string,
): {
  lineNumber: number;
  type: "context" | "add" | "remove" | "header";
  content: string;
}[] {
  const lines = diff.split("\n");
  const result: {
    lineNumber: number;
    type: "context" | "add" | "remove" | "header";
    content: string;
  }[] = [];
  let oldLineNum = 0;
  let newLineNum = 0;
  let inHunk = false;

  for (const line of lines) {
    if (line.startsWith("@@")) {
      inHunk = true;
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (match) {
        oldLineNum = parseInt(match[1], 10) - 1;
        newLineNum = parseInt(match[2], 10) - 1;
      }
      result.push({ lineNumber: 0, type: "header", content: line });
      continue;
    }

    if (
      line.startsWith("diff --git") ||
      line.startsWith("index ") ||
      line.startsWith("--- ") ||
      line.startsWith("+++ ") ||
      line.startsWith("new file mode") ||
      line.startsWith("deleted file mode")
    ) {
      result.push({ lineNumber: 0, type: "header", content: line });
      continue;
    }

    if (inHunk) {
      if (line.startsWith("+")) {
        newLineNum++;
        result.push({
          lineNumber: newLineNum,
          type: "add",
          content: line.slice(1),
        });
      } else if (line.startsWith("-")) {
        oldLineNum++;
        result.push({
          lineNumber: oldLineNum,
          type: "remove",
          content: line.slice(1),
        });
      } else {
        oldLineNum++;
        newLineNum++;
        result.push({ lineNumber: newLineNum, type: "context", content: line });
      }
    } else {
      result.push({ lineNumber: 0, type: "header", content: line });
    }
  }

  return result;
}

export function GitDiffPage() {
  const [diffType, setDiffType] = useState<DiffType>("unstaged");
  const [selectedFile, setSelectedFile] = useState<DiffFile | null>(null);
  const [files, setFiles] = useState<DiffFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDiff = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `http://localhost:3001/api/git/diff?type=${diffType}`,
      );
      if (!response.ok) throw new Error("Failed to fetch diff");
      const data: GitDiffResponse = await response.json();
      setFiles(data.files);
      setSelectedFile(data.files[0] || null);
    } catch {
      // Fallback to mock data
      const mockData =
        diffType === "unstaged" ? mockUnstagedDiff : mockStagedDiff;
      setFiles(mockData.files);
      setSelectedFile(mockData.files[0] || null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDiff();
  }, [diffType]);

  const parsedDiff = selectedFile ? parseDiff(selectedFile.diff) : [];

  return (
    <div className="p-6 h-full flex flex-col">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <GitBranch className="w-6 h-6" />
          Git Diff
        </h1>
        <button
          onClick={fetchDiff}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-1.5 bg-gray-900 border border-gray-800 rounded-lg text-sm text-gray-300 hover:bg-gray-800 hover:text-white disabled:opacity-50"
        >
          <RefreshCw className={loading ? "w-4 h-4 animate-spin" : "w-4 h-4"} />
          Refresh
        </button>
      </div>

      <div className="flex-1 flex overflow-hidden bg-gray-950 border border-gray-800 rounded-xl">
        {/* File List Panel */}
        <aside className="w-72 border-r border-gray-800 flex flex-col bg-gray-900">
          <div className="flex items-center gap-2 border-b border-gray-800 px-4 py-3">
            <div className="flex items-center gap-1 bg-gray-800 rounded-lg p-1">
              <button
                onClick={() => setDiffType("unstaged")}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  diffType === "unstaged"
                    ? "bg-blue-600 text-white"
                    : "text-gray-400 hover:text-white hover:bg-gray-700"
                }`}
              >
                Unstaged
              </button>
              <button
                onClick={() => setDiffType("staged")}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  diffType === "staged"
                    ? "bg-blue-600 text-white"
                    : "text-gray-400 hover:text-white hover:bg-gray-700"
                }`}
              >
                Staged
              </button>
            </div>
            <span className="text-xs text-gray-500 ml-2">({files.length})</span>
          </div>

          <div className="flex-1 overflow-y-auto p-2">
            {loading ? (
              <div className="flex items-center justify-center h-full text-gray-500">
                <RefreshCw className="w-6 h-6 animate-spin" />
              </div>
            ) : files.length === 0 ? (
              <div className="flex items-center justify-center h-full text-gray-500">
                <p className="text-sm">No changes</p>
              </div>
            ) : (
              <ul className="space-y-1">
                {files.map((file) => {
                  const config = statusConfig[file.status];
                  const Icon = config.icon;
                  return (
                    <li key={file.path}>
                      <button
                        onClick={() => setSelectedFile(file)}
                        className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left transition-colors ${
                          selectedFile?.path === file.path
                            ? "bg-blue-600/20 text-white"
                            : "text-gray-300 hover:bg-gray-800"
                        }`}
                      >
                        <Icon
                          className={`w-4 h-4 flex-shrink-0 ${config.color}`}
                          aria-hidden="true"
                        />
                        <span className="flex-1 truncate font-mono text-sm">
                          {file.path}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded text-xs font-medium ${config.bg} ${config.color}`}
                        >
                          {config.label}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </aside>

        {/* Diff Viewer Panel */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="border-b border-gray-800 px-4 py-3 bg-gray-900">
            {selectedFile ? (
              <div className="flex items-center gap-3">
                <span className="font-mono text-sm text-white truncate flex-1">
                  {selectedFile.path}
                </span>
                <span
                  className={`px-2 py-0.5 rounded text-xs font-medium ${statusConfig[selectedFile.status].bg} ${statusConfig[selectedFile.status].color}`}
                >
                  {statusConfig[selectedFile.status].label}
                </span>
              </div>
            ) : (
              <p className="text-gray-500 text-sm">
                Select a file to view diff
              </p>
            )}
          </div>

          <div className="flex-1 overflow-auto p-4 bg-gray-950">
            {selectedFile ? (
              <pre className="font-mono text-sm text-gray-300 leading-relaxed">
                {parsedDiff.map((line, i) => (
                  <div
                    key={i}
                    className={`flex ${line.type === "add" ? "bg-green-500/10" : line.type === "remove" ? "bg-red-500/10" : line.type === "header" ? "bg-gray-800/50" : ""}`}
                  >
                    <span className="w-10 text-right pr-3 text-gray-500 select-none border-r border-gray-800 flex-shrink-0">
                      {line.lineNumber > 0 ? line.lineNumber : "—"}
                    </span>
                    <span
                      className={`flex-1 px-3 select-text ${line.type === "add" ? "text-green-300" : line.type === "remove" ? "text-red-300" : line.type === "header" ? "text-gray-400" : "text-gray-300"}`}
                    >
                      {line.type === "add"
                        ? "+"
                        : line.type === "remove"
                          ? "-"
                          : " "}
                      {line.content}
                    </span>
                  </div>
                ))}
              </pre>
            ) : (
              <div className="flex items-center justify-center h-full text-gray-500">
                <GitBranch className="w-12 h-12 opacity-30" />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
