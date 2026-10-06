import { create } from 'zustand';

/**
 * Theme mode: 'system' follows the OS setting live; explicit light/dark
 * writes win until the user picks System again. Persisted under the same
 * 'baton-theme' key the sidebar toggle has always used, so existing
 * choices carry over.
 */
export type ThemeMode = 'system' | 'light' | 'dark';

interface ThemeState {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
}

function initialMode(): ThemeMode {
  const stored = localStorage.getItem('baton-theme');
  return stored === 'dark' || stored === 'light' ? stored : 'system';
}

export const useThemeStore = create<ThemeState>((set) => ({
  mode: initialMode(),
  setMode: (mode) => {
    if (mode === 'system') {
      localStorage.removeItem('baton-theme');
    } else {
      localStorage.setItem('baton-theme', mode);
    }
    set({ mode });
  },
}));

/** Resolve a mode against the OS preference. */
export function resolveDark(mode: ThemeMode, osDark: boolean): boolean {
  return mode === 'dark' || (mode === 'system' && osDark);
}
