import { useColorScheme } from 'react-native';
import { useThemeStore } from '../stores/theme';
import { Colors } from '../constants/theme';

export interface ThemeColors {
  isDark: boolean;
  bg: string;
  card: string;
  cardBorder: string;
  elevated: string;
  subtle: string;
  inputBg: string;
  inputBorder: string;
  separator: string;
  textPrimary: string;
  textSecondary: string;
  textTertiary: string;
  glassNav: string;
  glassCard: string;
  glassTabBar: string;
  accentBg: string;
  accentBorder: string;
  successBg: string;
  dangerBg: string;
}

export function useThemeColors(): ThemeColors {
  const theme = useThemeStore((s) => s.theme);
  const systemScheme = useColorScheme();

  const isDark = theme === 'dark' || (theme === 'system' && systemScheme !== 'light');

  const p = isDark ? Colors.dark : Colors.light;

  return {
    isDark,
    bg: p.bg,
    card: p.card,
    cardBorder: p.cardBorder,
    elevated: p.elevated,
    subtle: p.subtle,
    inputBg: p.inputBg,
    inputBorder: p.inputBorder,
    separator: p.separator,
    textPrimary: p.text,
    textSecondary: p.textSecondary,
    textTertiary: p.textTertiary,
    glassNav: p.glassNav,
    glassCard: p.glassCard,
    glassTabBar: p.glassTabBar,
    accentBg: p.accentBg,
    accentBorder: p.accentBorder,
    successBg: p.successBg,
    dangerBg: p.dangerBg,
  };
}

export function getTerminalColors(isDark: boolean) {
  return isDark ? Colors.terminal.dark : Colors.terminal.light;
}
