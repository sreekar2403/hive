import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { API } from "../lib/api";

export interface Project {
  id: string;
  name: string;
  path: string;
  color: string | null;
  exists: boolean;
  isGitRepo: boolean;
  branch: string | null;
  created_at: number;
  updated_at: number;
}

interface ProjectContextValue {
  projects: Project[];
  activeProject: Project | null;
  activeProjectId: string | null;
  loading: boolean;
  error: string | null;
  setActiveProjectId: (id: string | null) => void;
  addProject: (input: { path: string; name?: string }) => Promise<Project>;
  updateProject: (
    id: string,
    input: { name?: string; color?: string },
  ) => Promise<void>;
  removeProject: (id: string) => Promise<void>;
  refresh: () => Promise<void>;
}

const ProjectContext = createContext<ProjectContextValue | null>(null);

const STORAGE_KEY = "hive.activeProjectId";

/**
 * Holds the set of git working trees Hive operates on, plus which one the
 * UI is currently scoped to. Every screen reads the active project from
 * here rather than taking it as a prop.
 */
export function ProjectProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const setActiveProjectId = useCallback((id: string | null) => {
    setActiveId(id);
    try {
      if (id) localStorage.setItem(STORAGE_KEY, id);
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Storage can be unavailable; the in-memory value still works.
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const data = await API.get<{ projects: Project[] }>("/api/projects");
      setProjects(data.projects);
      setError(null);

      // Keep the selection valid as projects come and go.
      setActiveId((current) => {
        if (current && data.projects.some((p) => p.id === current))
          return current;
        const next = data.projects[0]?.id ?? null;
        try {
          if (next) localStorage.setItem(STORAGE_KEY, next);
          else localStorage.removeItem(STORAGE_KEY);
        } catch {
          /* ignore */
        }
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load projects");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Initial load. setState inside is the point of the effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  const addProject = useCallback(
    async (input: { path: string; name?: string }) => {
      const created = await API.post<Project>("/api/projects", input);
      await refresh();
      setActiveProjectId(created.id);
      return created;
    },
    [refresh, setActiveProjectId],
  );

  const updateProject = useCallback(
    async (id: string, input: { name?: string; color?: string }) => {
      await API.put(`/api/projects/${id}`, input);
      await refresh();
    },
    [refresh],
  );

  const removeProject = useCallback(
    async (id: string) => {
      await API.del(`/api/projects/${id}`);
      await refresh();
    },
    [refresh],
  );

  const value = useMemo<ProjectContextValue>(
    () => ({
      projects,
      activeProject: projects.find((p) => p.id === activeProjectId) ?? null,
      activeProjectId,
      loading,
      error,
      setActiveProjectId,
      addProject,
      updateProject,
      removeProject,
      refresh,
    }),
    [
      projects,
      activeProjectId,
      loading,
      error,
      setActiveProjectId,
      addProject,
      updateProject,
      removeProject,
      refresh,
    ],
  );

  return (
    <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>
  );
}

export function useProjects(): ProjectContextValue {
  const ctx = useContext(ProjectContext);
  if (!ctx)
    throw new Error("useProjects must be used inside <ProjectProvider>");
  return ctx;
}
