import { StyleSheet } from 'react-native';

export const Colors = {
  primary: {
    50: '#eff6ff',
    100: '#dbeafe',
    200: '#bfdbfe',
    300: '#93c5fd',
    400: '#60a5fa',
    500: '#3b82f6',
    600: '#2563eb',
    700: '#1d4ed8',
    800: '#1e40af',
    900: '#1e3a8a',
  },
  success: {
    50: '#f0fdf4',
    100: '#dcfce7',
    400: '#4ade80',
    500: '#22c55e',
    600: '#16a34a',
    700: '#15803d',
  },
  warning: {
    50: '#fffbeb',
    100: '#fef3c7',
    400: '#fbbf24',
    500: '#f59e0b',
    600: '#d97706',
  },
  danger: {
    50: '#fef2f2',
    100: '#fee2e2',
    400: '#f87171',
    500: '#ef4444',
    600: '#dc2626',
    700: '#b91c1c',
  },
  purple: {
    50: '#faf5ff',
    100: '#f3e8ff',
    500: '#a855f7',
  },
  surface: {
    0: '#ffffff',
    50: '#f9fafb',
    100: '#f3f4f6',
    200: '#e5e7eb',
    300: '#d1d5db',
    400: '#9ca3af',
    500: '#6b7280',
    600: '#4b5563',
    700: '#374151',
    800: '#1f2937',
    900: '#111827',
    950: '#030712',
  },
  dark: {
    bg: '#050508',
    card: '#0e0e14',
    cardBorder: '#1a1a24',
    elevated: '#121218',
    subtle: '#1e1e2a',
    inputBg: '#141420',
    inputBorder: '#252536',
  },
  glass: {
    background: 'rgba(14, 14, 20, 0.75)',
    backgroundLight: 'rgba(14, 14, 20, 0.55)',
    border: 'rgba(255, 255, 255, 0.06)',
    borderLight: 'rgba(255, 255, 255, 0.03)',
    highlight: 'rgba(255, 255, 255, 0.08)',
  },
  gradient: {
    primaryStart: '#3b82f6',
    primaryEnd: '#8b5cf6',
    accentStart: '#06b6d4',
    accentEnd: '#3b82f6',
    warmStart: '#f59e0b',
    warmEnd: '#ef4444',
  },
  text: {
    primary: '#f0f0f5',
    secondary: '#9ca3b8',
    tertiary: '#5c5c72',
    inverse: '#050508',
    accent: '#60a5fa',
  },
} as const;

export const Spacing = {
  '3xs': 2,
  '2xs': 4,
  xs: 6,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  '2xl': 24,
  '3xl': 32,
  '4xl': 40,
  '5xl': 48,
  '6xl': 64,
} as const;

export const Typography = {
  xs: { fontSize: 10, lineHeight: 14, letterSpacing: 0.04 },
  sm: { fontSize: 12, lineHeight: 16, letterSpacing: 0.02 },
  base: { fontSize: 14, lineHeight: 20, letterSpacing: -0.01 },
  lg: { fontSize: 16, lineHeight: 22, letterSpacing: -0.02 },
  xl: { fontSize: 20, lineHeight: 28, letterSpacing: -0.02 },
  '2xl': { fontSize: 24, lineHeight: 32, letterSpacing: -0.03 },
  '3xl': { fontSize: 30, lineHeight: 38, letterSpacing: -0.03 },
  '4xl': { fontSize: 36, lineHeight: 44, letterSpacing: -0.04 },
} as const;

export const Radius = {
  xs: 4,
  sm: 6,
  md: 8,
  lg: 12,
  xl: 16,
  '2xl': 20,
  '3xl': 24,
  full: 9999,
} as const;

export const Animation = {
  duration: {
    fast: 150,
    normal: 250,
    slow: 350,
    gentle: 500,
  },
  spring: {
    gentle: { damping: 20, stiffness: 120 },
    bouncy: { damping: 12, stiffness: 180 },
    snappy: { damping: 25, stiffness: 300 },
  },
} as const;

export const Shadows = StyleSheet.create({
  sm: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.12,
    shadowRadius: 2,
    elevation: 1,
  },
  md: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.16,
    shadowRadius: 4,
    elevation: 2,
  },
  lg: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  glow: {
    shadowColor: '#3b82f6',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 8,
  },
});

export const STATUS_COLORS: Record<string, string> = {
  running: Colors.success[500],
  thinking: Colors.primary[500],
  executing: Colors.purple[500],
  waiting_input: Colors.warning[500],
  idle: Colors.surface[500],
  stopped: Colors.danger[500],
  starting: Colors.surface[400],
  error: Colors.danger[500],
};

export const CHANGE_COLORS: Record<string, { bg: string; text: string }> = {
  create: { bg: Colors.success[100], text: Colors.success[700] },
  modify: { bg: Colors.primary[100], text: Colors.primary[800] },
  delete: { bg: Colors.danger[100], text: Colors.danger[700] },
};
