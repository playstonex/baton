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
  textPrimary: string;
  textSecondary: string;
  textTertiary: string;
}

export function useThemeColors(): ThemeColors {
  const theme = useThemeStore((s) => s.theme);
  const systemScheme = useColorScheme();

  const isDark = theme === 'dark' || (theme === 'system' && systemScheme !== 'light');

  const palette = isDark ? Colors.dark : Colors.light;

  return {
    isDark,
    bg: palette.bg,
    card: palette.card,
    cardBorder: palette.cardBorder,
    elevated: palette.elevated,
    subtle: palette.subtle,
    inputBg: palette.inputBg,
    inputBorder: palette.inputBorder,
    textPrimary: palette.text,
    textSecondary: palette.textSecondary,
    textTertiary: palette.textTertiary,
  };
}

export function getTerminalColors(isDark: boolean) {
  return isDark ? Colors.terminal.dark : Colors.terminal.light;
}