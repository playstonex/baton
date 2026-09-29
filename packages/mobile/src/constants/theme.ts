import { StyleSheet, Platform, type TextStyle } from 'react-native';

// ── Linear Design Tokens ──────────────────────────────────────
// Derived from the "linear-app" design system (Open Design library):
// darkness as the native medium, luminance-stepped surfaces,
// semi-transparent hairline borders, a single indigo-violet accent.
export const Glass = {
  /** BlurView intensity tiers for different UI layers */
  blur: {
    nav: 65,
    tabBar: 72,
    card: 55,
    sheet: 80,
    modal: 90,
    tooltip: 75,
  } as const,

  /** Morph transition durations (ms) for reanimated animations */
  morph: {
    fast: 200,
    normal: 350,
    slow: 500,
    spring: { damping: 18, stiffness: 200, mass: 1 },
    bouncy: { damping: 12, stiffness: 180, mass: 1 },
  } as const,

  /** Surface opacity tiers for light/dark adaptive glass */
  opacity: {
    dark: {
      surface: 'rgba(19,20,22,0.72)',
      elevated: 'rgba(26,27,29,0.65)',
      subtle: 'rgba(35,36,40,0.55)',
      border: 'rgba(255,255,255,0.06)',
      borderActive: 'rgba(94,106,210,0.4)',
      glow: 'rgba(94,106,210,0.14)',
    },
    light: {
      surface: 'rgba(252,252,252,0.78)',
      elevated: 'rgba(255,255,255,0.72)',
      subtle: 'rgba(243,244,245,0.65)',
      border: 'rgba(11,13,15,0.06)',
      borderActive: 'rgba(94,106,210,0.3)',
      glow: 'rgba(94,106,210,0.1)',
    },
  } as const,

  /** Whether platform supports continuous corner curves */
  supportsContinuous: Platform.OS === 'ios',
} as const;

export const Colors = {
  // Linear indigo-violet — the only chromatic color in the chrome.
  primary: {
    50: '#f2f3fc',
    100: '#e6e8fa',
    200: '#cdd2f5',
    300: '#828fff',
    400: '#7170ff',
    500: '#5e6ad2',
    600: '#4752c4',
    700: '#3a44a4',
    800: '#2c3582',
    900: '#1d2352',
  },
  success: {
    50: '#eef8f0',
    100: '#d9f2de',
    400: '#3fb950',
    500: '#2ea043',
    600: '#1a7f37',
  },
  warning: {
    50: '#fdf7e8',
    100: '#f9edc7',
    400: '#d9a62e',
    500: '#bf8b1a',
    600: '#9a6700',
  },
  danger: {
    50: '#fdeef0',
    100: '#fadadb',
    400: '#eb4d55',
    500: '#dc2626',
    600: '#b91c1c',
    700: '#951117',
  },
  surface: {
    50: '#f7f8f8',
    100: '#f3f4f5',
    200: '#ececee',
    300: '#d9dadd',
    400: '#9095a0',
    500: '#6f747e',
    600: '#42454c',
    700: '#2c2e33',
    800: '#191a1d',
    900: '#0f1011',
  },

  dark: {
    bg: '#08090a',
    groupedBg: '#08090a',
    secondaryBg: '#0f1011',
    card: '#131416',
    cardBorder: 'rgba(255,255,255,0.08)',
    elevated: '#191a1d',
    subtle: '#232428',
    inputBg: 'rgba(255,255,255,0.03)',
    inputBorder: 'rgba(255,255,255,0.1)',
    separator: 'rgba(255,255,255,0.06)',
    text: '#f7f8f8',
    textSecondary: 'rgba(208,214,224,0.85)',
    textTertiary: '#8a8f98',
    glassNav: 'rgba(15,16,17,0.85)',
    glassCard: 'rgba(19,20,22,0.72)',
    glassTabBar: 'rgba(15,16,17,0.8)',
    accentBg: 'rgba(94,106,210,0.22)',
    accentBorder: 'rgba(94,106,210,0.42)',
    successBg: 'rgba(63,185,80,0.13)',
    dangerBg: 'rgba(235,77,85,0.12)',
  },

  light: {
    bg: '#f7f8f8',
    groupedBg: '#f7f8f8',
    secondaryBg: '#ffffff',
    card: '#ffffff',
    cardBorder: 'rgba(11,13,15,0.08)',
    elevated: '#f3f4f5',
    subtle: '#ebedef',
    inputBg: '#ffffff',
    inputBorder: 'rgba(11,13,15,0.1)',
    separator: 'rgba(11,13,15,0.06)',
    text: '#1b1d22',
    textSecondary: 'rgba(27,29,34,0.66)',
    textTertiary: 'rgba(27,29,34,0.46)',
    glassNav: 'rgba(252,252,252,0.85)',
    glassCard: 'rgba(255,255,255,0.72)',
    glassTabBar: 'rgba(252,252,252,0.8)',
    accentBg: 'rgba(94,106,210,0.1)',
    accentBorder: 'rgba(94,106,210,0.26)',
    successBg: 'rgba(26,127,55,0.1)',
    dangerBg: 'rgba(207,34,46,0.08)',
  },

  glassGradient: {
    dark: {
      from: 'rgba(19,20,22,0.45)',
      to: 'rgba(25,26,29,0.25)',
      accentFrom: 'rgba(94,106,210,0.18)',
      accentTo: 'rgba(94,106,210,0.05)',
    },
    light: {
      from: 'rgba(255,255,255,0.55)',
      to: 'rgba(252,252,252,0.25)',
      accentFrom: 'rgba(94,106,210,0.1)',
      accentTo: 'rgba(94,106,210,0.02)',
    },
  },

  terminal: {
    light: {
      bg: '#ffffff',
      fg: '#1b1d22',
      cursor: '#5e6ad2',
      black: '#6f747e',
      red: '#cf222e',
      green: '#1a7f37',
      yellow: '#9a6700',
      blue: '#4752c4',
      magenta: '#8250df',
      cyan: '#1b7c83',
      white: '#42454c',
      brightBlack: '#9095a0',
      brightRed: '#eb4d55',
      brightGreen: '#3fb950',
      brightYellow: '#d9a62e',
      brightBlue: '#7170ff',
      brightMagenta: '#ab7df8',
      brightCyan: '#00ac96',
      brightWhite: '#1b1d22',
    },
    dark: {
      bg: '#0f1011',
      fg: '#e8eaed',
      cursor: '#7170ff',
      black: '#2e3033',
      red: '#eb4d55',
      green: '#3fb950',
      yellow: '#d9a62e',
      blue: '#7170ff',
      magenta: '#c472fb',
      cyan: '#39c5cf',
      white: '#d0d6e0',
      brightBlack: '#62666d',
      brightRed: '#ff6b70',
      brightGreen: '#56d364',
      brightYellow: '#e3b341',
      brightBlue: '#828fff',
      brightMagenta: '#d2a8ff',
      brightCyan: '#39c5cf',
      brightWhite: '#f7f8f8',
    },
  },
} as const;

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  '2xl': 24,
  '3xl': 32,
  '4xl': 48,
} as const;

/**
 * Display face for large titles / big numerals; mono for machine data
 * (URLs, ids, counters). Loaded via useFonts in app/_layout.tsx — falls
 * back to the system font until ready. Inter is the Linear identity face;
 * body text keeps the SF Pro system stack.
 */
export const FontFamily = {
  display: 'Inter_600SemiBold',
  displayMedium: 'Inter_500Medium',
  mono: 'JetBrainsMono_400Regular',
  monoSemiBold: 'JetBrainsMono_600SemiBold',
} as const;

export const Typography = {
  caption2: { fontSize: 11, lineHeight: 13 },
  caption1: { fontSize: 12, lineHeight: 16 },
  footnote: { fontSize: 13, lineHeight: 18 },
  subhead: { fontSize: 15, lineHeight: 20 },
  body: { fontSize: 17, lineHeight: 22 },
  headline: { fontSize: 17, lineHeight: 22, fontWeight: '600' as const },
  title3: { fontSize: 20, lineHeight: 25, fontWeight: '600' as const },
  title2: { fontSize: 22, lineHeight: 28, fontWeight: '700' as const },
  title1: { fontSize: 28, lineHeight: 34, fontWeight: '700' as const },
  largeTitle: {
    fontSize: 34,
    lineHeight: 40,
    fontWeight: '600' as const,
    letterSpacing: -0.8,
    fontFamily: FontFamily.display,
  },
  /** Big numerals (stats, counters) — tabular so they don't jitter. */
  statValue: {
    fontSize: 28,
    lineHeight: 32,
    fontFamily: FontFamily.display,
    fontVariant: ['tabular-nums'] as TextStyle['fontVariant'],
    letterSpacing: -0.5,
  },
  /** Machine data: daemon URLs, session ids, timestamps. */
  mono: { fontSize: 13, lineHeight: 18, fontFamily: FontFamily.mono },
  monoSemiBold: {
    fontSize: 13,
    lineHeight: 18,
    fontFamily: FontFamily.monoSemiBold,
  },
  /** Tiny uppercase label for section eyebrows. */
  overline: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '600' as const,
    letterSpacing: 0.8,
    textTransform: 'uppercase' as const,
  },
} as const;

export const Radius = {
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
  full: 999,
} as const;

export const CornerRadius = {
  small: 8,
  medium: 12,
  large: 16,
  xl: 22,
} as const;

export const STATUS_COLORS: Record<string, string> = {
  running: Colors.success[400],
  thinking: Colors.primary[300],
  executing: Colors.primary[300],
  waiting_input: Colors.warning[400],
  idle: Colors.surface[400],
  stopped: Colors.surface[400],
  starting: Colors.primary[300],
  error: Colors.danger[400],
};

/** Change-type tints: soft alpha bg + mid-weight text, readable on both themes. */
export const CHANGE_COLORS: Record<string, { bg: string; text: string }> = {
  create: { bg: 'rgba(63,185,80,0.15)', text: '#2ea043' },
  modify: { bg: 'rgba(94,106,210,0.18)', text: '#6e79d9' },
  delete: { bg: 'rgba(235,77,85,0.15)', text: '#dc5050' },
};

export const InsetGrouped = {
  horizontal: 20,
  sectionGap: 24,
  rowMinHeight: 44,
  headerHeight: 32,
} as const;

export const Shadows = {
  // Tinted toward the near-black canvas hue instead of pure black, so cards
  // sit in the scene rather than floating on it.
  card: {
    shadowColor: '#08090a',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  elevated: {
    shadowColor: '#08090a',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.16,
    shadowRadius: 12,
    elevation: 5,
  },
} as const;

export const iOSGroupedRadius = 10;
