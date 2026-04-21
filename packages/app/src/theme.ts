export interface Theme {
  name: string;
  colors: {
    bg: string;
    surface: string;
    border: string;
    text: string;
    textSecondary: string;
    primary: string;
    success: string;
    warning: string;
    error: string;
    codeBlock: string;
    codeText: string;
  };
}

export const lightTheme: Theme = {
  name: 'light',
  colors: {
    bg: '#ffffff',
    surface: '#f9fafb',
    border: '#e5e7eb',
    text: '#111827',
    textSecondary: '#6b7280',
    primary: '#2563eb',
    success: '#22c55e',
    warning: '#f59e0b',
    error: '#ef4444',
    codeBlock: '#1e1e1e',
    codeText: '#d1d5db',
  },
};

export const darkTheme: Theme = {
  name: 'dark',
  colors: {
    bg: '#0f172a',
    surface: '#1e293b',
    border: '#334155',
    text: '#f1f5f9',
    textSecondary: '#94a3b8',
    primary: '#3b82f6',
    success: '#4ade80',
    warning: '#fbbf24',
    error: '#f87171',
    codeBlock: '#020617',
    codeText: '#e2e8f0',
  },
};

export const themes: Record<string, Theme> = {
  light: lightTheme,
  dark: darkTheme,
};

export function getTheme(name?: string): Theme {
  return themes[name ?? 'light'] ?? lightTheme;
}