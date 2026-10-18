import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { applyPalette } from "./apply";
import { getPalette } from "./registry";
import {
  MODE_KEY,
  THEME_KEY,
  getPrefersDark,
  readStoredState,
  resolveMode,
  toggleResolvedMode,
} from "./resolve";
import type { ThemeId, ThemeMode, ResolvedMode } from "./types";

interface ThemeContextValue {
  theme: ThemeId;
  mode: ThemeMode;
  resolvedMode: ResolvedMode;
  setTheme: (t: ThemeId) => void;
  setMode: (m: ThemeMode) => void;
  toggleMode: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside <ThemeProvider>");
  return ctx;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [{ theme, mode }, setStored] = useState(() => {
    try {
      return readStoredState(window.localStorage);
    } catch {
      return { theme: "ledger" as ThemeId, mode: "system" as ThemeMode };
    }
  });
  const [prefersDark, setPrefersDark] = useState(getPrefersDark);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => setPrefersDark(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const resolvedMode = resolveMode(mode, prefersDark);

  useLayoutEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-theme", theme);
    root.setAttribute("data-mode", resolvedMode);
    applyPalette(root, getPalette(theme, resolvedMode));
    window.electronAPI?.send("nativeTheme:set", resolvedMode);
  }, [theme, resolvedMode]);

  useEffect(() => {
    try {
      window.localStorage.setItem(THEME_KEY, theme);
      window.localStorage.setItem(MODE_KEY, mode);
    } catch {
      /* storage unavailable */
    }
  }, [theme, mode]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      mode,
      resolvedMode,
      setTheme: (t: ThemeId) => setStored((s) => ({ ...s, theme: t })),
      setMode: (m: ThemeMode) => setStored((s) => ({ ...s, mode: m })),
      toggleMode: () =>
        setStored((s) => ({
          ...s,
          mode: toggleResolvedMode(resolveMode(s.mode, prefersDark)),
        })),
    }),
    [theme, mode, resolvedMode, prefersDark],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}
