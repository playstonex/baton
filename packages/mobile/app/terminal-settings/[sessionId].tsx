import { ActionSheetIOS, StyleSheet, ScrollView, Pressable, Platform } from 'react-native';
import { View, Text } from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import { useThemeColors } from '../../src/hooks/useThemeColors';
import {
  Typography,
  Spacing,
  Colors,
  iOSGroupedRadius,
} from '../../src/constants/theme';
import {
  useTerminalSettingsStore,
  TERMINAL_THEMES,
  TERMINAL_FONTS,
  type TerminalTheme,
  type TerminalFont,
} from '../../src/stores/terminal-settings';

export default function TerminalSettingsScreen() {
  const c = useThemeColors();
  const {
    fontSize,
    fontFamily,
    theme,
    scrollback,
    cursorBlink,
    setFontSize,
    setFontFamily,
    setTheme,
    setScrollback,
    setCursorBlink,
  } = useTerminalSettingsStore();

  const showThemePicker = () => {
    const options = TERMINAL_THEMES.map((t) => t.label).concat('Cancel');
    const cancelIdx = options.length - 1;
    const selectedIdx = TERMINAL_THEMES.findIndex((t) => t.value === theme);
    ActionSheetIOS.showActionSheetWithOptions(
      { options, cancelButtonIndex: cancelIdx, title: 'Terminal Theme' },
      (buttonIndex) => {
        if (buttonIndex !== cancelIdx && buttonIndex < TERMINAL_THEMES.length) {
          setTheme(TERMINAL_THEMES[buttonIndex].value);
        }
      },
    );
  };

  const showFontPicker = () => {
    const options = TERMINAL_FONTS.map((f) => f.label).concat('Cancel');
    const cancelIdx = options.length - 1;
    ActionSheetIOS.showActionSheetWithOptions(
      { options, cancelButtonIndex: cancelIdx, title: 'Font Family' },
      (buttonIndex) => {
        if (buttonIndex !== cancelIdx && buttonIndex < TERMINAL_FONTS.length) {
          setFontFamily(TERMINAL_FONTS[buttonIndex].value);
        }
      },
    );
  };

  const showScrollbackPicker = () => {
    const values = [1000, 5000, 10000, 50000];
    const options = values.map((v) => (v >= 1000 ? `${v / 1000}k lines` : `${v} lines`)).concat('Cancel');
    const cancelIdx = options.length - 1;
    ActionSheetIOS.showActionSheetWithOptions(
      { options, cancelButtonIndex: cancelIdx, title: 'Scrollback Buffer' },
      (buttonIndex) => {
        if (buttonIndex !== cancelIdx && buttonIndex < values.length) {
          setScrollback(values[buttonIndex]);
        }
      },
    );
  };

  const themeLabel = TERMINAL_THEMES.find((t) => t.value === theme)?.label ?? 'Default';
  const scrollbackLabel = scrollback >= 1000 ? `${scrollback / 1000}k lines` : `${scrollback} lines`;

  return (
    <ScrollView
      style={[s.screen, { backgroundColor: c.bg }]}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={s.content}
    >
      <Text style={s.header}>APPEARANCE</Text>
      <View style={[s.group, { backgroundColor: c.card }]}>
        <View style={s.groupInner}>
          <Pressable onPress={showThemePicker} style={s.row}>
            <Text style={[Typography.subhead, { color: c.textPrimary }]}>Theme</Text>
            <View style={s.spacer} />
            <View style={s.valueWrap}>
              <View style={[s.swatch, { backgroundColor: getSwatchBg(theme) }]}>
                <Text style={[Typography.caption2, { color: getSwatchFg(theme), fontWeight: '600', fontSize: 9 }]}>
                  Aa
                </Text>
              </View>
              <Text style={[Typography.subhead, { color: c.textSecondary }]}>{themeLabel}</Text>
            </View>
            <Ionicons name="chevron-forward" size={14} color={c.textTertiary} style={s.chevron} />
          </Pressable>

          <View style={[s.divider, { borderColor: c.separator }]} />

          <Pressable onPress={showFontPicker} style={s.row}>
            <Text style={[Typography.subhead, { color: c.textPrimary }]}>Font</Text>
            <View style={s.spacer} />
            <Text style={[Typography.subhead, { color: c.textSecondary, fontFamily: fontFamily }]}>
              {fontFamily}
            </Text>
            <Ionicons name="chevron-forward" size={14} color={c.textTertiary} style={s.chevron} />
          </Pressable>

          <View style={[s.divider, { borderColor: c.separator }]} />

          <View style={s.row}>
            <Text style={[Typography.subhead, { color: c.textPrimary }]}>Font Size</Text>
            <View style={s.spacer} />
            <Pressable onPress={() => fontSize > 8 && setFontSize(fontSize - 1)} hitSlop={{ top: 8, bottom: 8, left: 12, right: 4 }}>
              <Ionicons name="remove-circle-outline" size={24} color={fontSize <= 8 ? c.textTertiary : Colors.primary[500]} />
            </Pressable>
            <Text style={[Typography.body, { color: c.textPrimary, width: 32, textAlign: 'center', fontFamily: 'monospace' }]}>
              {fontSize}
            </Text>
            <Pressable onPress={() => fontSize < 28 && setFontSize(fontSize + 1)} hitSlop={{ top: 8, bottom: 8, left: 4, right: 12 }}>
              <Ionicons name="add-circle-outline" size={24} color={fontSize >= 28 ? c.textTertiary : Colors.primary[500]} />
            </Pressable>
          </View>
        </View>
      </View>

      <Text style={s.header}>BEHAVIOR</Text>
      <View style={[s.group, { backgroundColor: c.card }]}>
        <View style={s.groupInner}>
          <Pressable onPress={showScrollbackPicker} style={s.row}>
            <Text style={[Typography.subhead, { color: c.textPrimary }]}>Scrollback</Text>
            <View style={s.spacer} />
            <Text style={[Typography.subhead, { color: c.textSecondary }]}>{scrollbackLabel}</Text>
            <Ionicons name="chevron-forward" size={14} color={c.textTertiary} style={s.chevron} />
          </Pressable>

          <View style={[s.divider, { borderColor: c.separator }]} />

          <Pressable onPress={() => setCursorBlink(!cursorBlink)} style={s.row}>
            <Text style={[Typography.subhead, { color: c.textPrimary }]}>Cursor Blink</Text>
            <View style={s.spacer} />
            <Ionicons
              name={cursorBlink ? 'toggle' : 'toggle-outline'}
              size={28}
              color={cursorBlink ? Colors.primary[500] : c.textTertiary}
            />
          </Pressable>
        </View>
      </View>
    </ScrollView>
  );
}

function getSwatchBg(t: TerminalTheme): string {
  const map: Record<TerminalTheme, string> = {
    default: '#191919',
    'solarized-dark': '#002b36',
    'solarized-light': '#fdf6e3',
    monokai: '#272822',
    dracula: '#282a36',
    nord: '#2e3440',
    'one-dark': '#282c34',
  };
  return map[t] ?? '#191919';
}

function getSwatchFg(t: TerminalTheme): string {
  const map: Record<TerminalTheme, string> = {
    default: '#e8e8e8',
    'solarized-dark': '#839496',
    'solarized-light': '#657b83',
    monokai: '#f8f8f2',
    dracula: '#f8f8f2',
    nord: '#d8dee9',
    'one-dark': '#abb2bf',
  };
  return map[t] ?? '#e8e8e8';
}

const s = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingBottom: 40 },
  header: {
    ...Typography.footnote,
    fontWeight: '600',
    color: '#8e8e93',
    letterSpacing: 0.5,
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.sm,
  },
  group: {
    marginHorizontal: Spacing.lg,
    borderRadius: iOSGroupedRadius,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  groupInner: { paddingHorizontal: Spacing.lg },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
  },
  spacer: { flex: 1 },
  divider: { height: StyleSheet.hairlineWidth },
  valueWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  swatch: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chevron: { marginLeft: 4 },
});
