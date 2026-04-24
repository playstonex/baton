export interface Theme {
  name: string;
  colors: {
    bg: string;
    surface: string;
    border: string;
    text: string;
    textSecondary: string;
    textTertiary: string;
    primary: string;
    primaryHover: string;
    info: string;
    infoBg: string;
    accent: string;
    accentBg: string;
    success: string;
    successBg: string;
    warning: string;
    warningBg: string;
    error: string;
    errorBg: string;
    sidebar: string;
    sidebarBorder: string;
    sidebarHover: string;
    sidebarActive: string;
    sidebarActiveText: string;
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
    textTertiary: '#9ca3af',
    primary: '#2563eb',
    primaryHover: '#1d4ed8',
    info: '#0ea5e9',
    infoBg: '#f0f9ff',
    accent: '#8b5cf6',
    accentBg: '#faf5ff',
    success: '#22c55e',
    successBg: '#f0fdf4',
    warning: '#f59e0b',
    warningBg: '#fffbeb',
    error: '#ef4444',
    errorBg: '#fef2f2',
    sidebar: '#fcfcfd',
    sidebarBorder: '#f0f0f3',
    sidebarHover: '#f5f5f8',
    sidebarActive: '#eff6ff',
    sidebarActiveText: '#2563eb',
    codeBlock: '#1e1e1e',
    codeText: '#d1d5db',
  },
};

export const darkTheme: Theme = {
  name: 'dark',
  colors: {
    bg: '#0b1120',
    surface: '#131b2e',
    border: '#1e293b',
    text: '#f1f5f9',
    textSecondary: '#94a3b8',
    textTertiary: '#64748b',
    primary: '#3b82f6',
    primaryHover: '#60a5fa',
    info: '#38bdf8',
    infoBg: '#0c1a2e',
    accent: '#a78bfa',
    accentBg: '#1a1030',
    success: '#4ade80',
    successBg: '#0a1f14',
    warning: '#fbbf24',
    warningBg: '#1a1500',
    error: '#f87171',
    errorBg: '#1f0a0a',
    sidebar: '#0e1525',
    sidebarBorder: '#1a2332',
    sidebarHover: '#151e30',
    sidebarActive: '#172554',
    sidebarActiveText: '#60a5fa',
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
