import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';

const SETTINGS_KEY = 'fw_terminal_settings';

export type TerminalTheme = 'default' | 'solarized-dark' | 'solarized-light' | 'monokai' | 'dracula' | 'nord' | 'one-dark';
export type TerminalFont = 'JetBrains Mono' | 'Menlo' | 'Monaco' | 'SF Mono' | 'Fira Code';

export interface TerminalSettings {
  fontSize: number;
  fontFamily: TerminalFont;
  theme: TerminalTheme;
  scrollback: number;
  cursorBlink: boolean;
}

interface TerminalSettingsState extends TerminalSettings {
  setFontSize: (size: number) => void;
  setFontFamily: (font: TerminalFont) => void;
  setTheme: (theme: TerminalTheme) => void;
  setScrollback: (scrollback: number) => void;
  setCursorBlink: (blink: boolean) => void;
  loadSettings: () => Promise<void>;
}

const DEFAULTS: TerminalSettings = {
  fontSize: 13,
  fontFamily: 'JetBrains Mono',
  theme: 'default',
  scrollback: 5000,
  cursorBlink: true,
};

export const useTerminalSettingsStore = create<TerminalSettingsState>()((set) => ({
  ...DEFAULTS,
  setFontSize: (fontSize) => {
    set({ fontSize });
    persistSettings(getCurrentSettings());
  },
  setFontFamily: (fontFamily) => {
    set({ fontFamily });
    persistSettings(getCurrentSettings());
  },
  setTheme: (theme) => {
    set({ theme });
    persistSettings(getCurrentSettings());
  },
  setScrollback: (scrollback) => {
    set({ scrollback });
    persistSettings(getCurrentSettings());
  },
  setCursorBlink: (cursorBlink) => {
    set({ cursorBlink });
    persistSettings(getCurrentSettings());
  },
  loadSettings: async () => {
    const saved = await SecureStore.getItemAsync(SETTINGS_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as Partial<TerminalSettings>;
        set({
          fontSize: parsed.fontSize ?? DEFAULTS.fontSize,
          fontFamily: parsed.fontFamily ?? DEFAULTS.fontFamily,
          theme: parsed.theme ?? DEFAULTS.theme,
          scrollback: parsed.scrollback ?? DEFAULTS.scrollback,
          cursorBlink: parsed.cursorBlink ?? DEFAULTS.cursorBlink,
        });
      } catch {
        // ignore corrupt data
      }
    }
  },
}));

function getCurrentSettings(): TerminalSettings {
  const s = useTerminalSettingsStore.getState();
  return {
    fontSize: s.fontSize,
    fontFamily: s.fontFamily,
    theme: s.theme,
    scrollback: s.scrollback,
    cursorBlink: s.cursorBlink,
  };
}

function persistSettings(settings: TerminalSettings) {
  SecureStore.setItemAsync(SETTINGS_KEY, JSON.stringify(settings));
}

export const TERMINAL_THEMES: { value: TerminalTheme; label: string }[] = [
  { value: 'default', label: 'Default' },
  { value: 'solarized-dark', label: 'Solarized Dark' },
  { value: 'solarized-light', label: 'Solarized Light' },
  { value: 'monokai', label: 'Monokai' },
  { value: 'dracula', label: 'Dracula' },
  { value: 'nord', label: 'Nord' },
  { value: 'one-dark', label: 'One Dark' },
];

export const TERMINAL_FONTS: { value: TerminalFont; label: string }[] = [
  { value: 'JetBrains Mono', label: 'JetBrains Mono' },
  { value: 'Menlo', label: 'Menlo' },
  { value: 'Monaco', label: 'Monaco' },
  { value: 'SF Mono', label: 'SF Mono' },
  { value: 'Fira Code', label: 'Fira Code' },
];

export const TERMINAL_THEME_COLORS: Record<TerminalTheme, { bg: string; fg: string }> = {
  default: { bg: '#191919', fg: '#e8e8e8' },
  'solarized-dark': { bg: '#002b36', fg: '#839496' },
  'solarized-light': { bg: '#fdf6e3', fg: '#657b83' },
  monokai: { bg: '#272822', fg: '#f8f8f2' },
  dracula: { bg: '#282a36', fg: '#f8f8f2' },
  nord: { bg: '#2e3440', fg: '#d8dee9' },
  'one-dark': { bg: '#282c34', fg: '#abb2bf' },
};

export function getTerminalThemeColors(name: TerminalTheme, isDark: boolean) {
  if (name === 'default') return null;

  const themes: Record<string, Record<string, string>> = {
    'solarized-dark': {
      background: '#002b36', foreground: '#839496', cursor: '#93a1a1',
      black: '#073642', red: '#dc322f', green: '#859900', yellow: '#b58900',
      blue: '#268bd2', magenta: '#6c71c4', cyan: '#2aa198', white: '#eee8d5',
      brightBlack: '#002b36', brightRed: '#cb4b16', brightGreen: '#586e75',
      brightYellow: '#657b83', brightBlue: '#839496', brightMagenta: '#6c71c4',
      brightCyan: '#93a1a1', brightWhite: '#fdf6e3',
    },
    'solarized-light': {
      background: '#fdf6e3', foreground: '#657b83', cursor: '#586e75',
      black: '#073642', red: '#dc322f', green: '#859900', yellow: '#b58900',
      blue: '#268bd2', magenta: '#6c71c4', cyan: '#2aa198', white: '#eee8d5',
      brightBlack: '#002b36', brightRed: '#cb4b16', brightGreen: '#586e75',
      brightYellow: '#657b83', brightBlue: '#839496', brightMagenta: '#6c71c4',
      brightCyan: '#93a1a1', brightWhite: '#fdf6e3',
    },
    monokai: {
      background: '#272822', foreground: '#f8f8f2', cursor: '#f8f8f0',
      black: '#272822', red: '#f92672', green: '#a6e22e', yellow: '#f4bf75',
      blue: '#66d9ef', magenta: '#ae81ff', cyan: '#a1efe4', white: '#f8f8f2',
      brightBlack: '#75715e', brightRed: '#f92672', brightGreen: '#a6e22e',
      brightYellow: '#f4bf75', brightBlue: '#66d9ef', brightMagenta: '#ae81ff',
      brightCyan: '#a1efe4', brightWhite: '#f9f8f5',
    },
    dracula: {
      background: '#282a36', foreground: '#f8f8f2', cursor: '#f8f8f2',
      black: '#21222c', red: '#ff5555', green: '#50fa7b', yellow: '#f1fa8c',
      blue: '#bd93f9', magenta: '#ff79c6', cyan: '#8be9fd', white: '#f8f8f2',
      brightBlack: '#6272a4', brightRed: '#ff6e6e', brightGreen: '#69ff94',
      brightYellow: '#ffffa5', brightBlue: '#d6acff', brightMagenta: '#ff92df',
      brightCyan: '#a4ffff', brightWhite: '#ffffff',
    },
    nord: {
      background: '#2e3440', foreground: '#d8dee9', cursor: '#d8dee9',
      black: '#3b4252', red: '#bf616a', green: '#a3be8c', yellow: '#ebcb8b',
      blue: '#81a1c1', magenta: '#b48ead', cyan: '#88c0d0', white: '#e5e9f0',
      brightBlack: '#4c566a', brightRed: '#bf616a', brightGreen: '#a3be8c',
      brightYellow: '#ebcb8b', brightBlue: '#81a1c1', brightMagenta: '#b48ead',
      brightCyan: '#8fbcbb', brightWhite: '#eceff4',
    },
    'one-dark': {
      background: '#282c34', foreground: '#abb2bf', cursor: '#528bff',
      black: '#282c34', red: '#e06c75', green: '#98c379', yellow: '#e5c07b',
      blue: '#61afef', magenta: '#c678dd', cyan: '#56b6c2', white: '#abb2bf',
      brightBlack: '#5c6370', brightRed: '#e06c75', brightGreen: '#98c379',
      brightYellow: '#e5c07b', brightBlue: '#61afef', brightMagenta: '#c678dd',
      brightCyan: '#56b6c2', brightWhite: '#ffffff',
    },
  };

  return themes[name] ?? null;
}
