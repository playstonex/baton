import React, { useEffect } from 'react';
import {
  LayoutAnimation,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import Ionicons from '@react-native-vector-icons/ionicons';
import {
  Colors,
  FontFamily,
  Glass,
  Radius,
  Spacing,
  Typography,
} from '../constants/theme';
import type { ThemeColors } from './messages';

export type ThinkingMode = 'none' | 'auto' | 'level';
export type ThinkingLevel = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
export type ServiceTier = 'default' | 'fast';
export type AccessMode = 'on-request' | 'full-access';

interface Props {
  visible: boolean;
  onClose: () => void;
  colors: ThemeColors;
  /** Adapter models + user provider models, merged by the caller. */
  models: string[];
  selectedModel: string | null;
  onSelectModel: (model: string) => void;
  thinkingMode: ThinkingMode;
  thinkingLevel: ThinkingLevel;
  onThinking: (mode: ThinkingMode, level?: ThinkingLevel) => void;
  serviceTier: ServiceTier;
  onServiceTier: (tier: ServiceTier) => void;
  accessMode: AccessMode;
  onAccessMode: (mode: AccessMode) => void;
  onInsertFile: () => void;
  /** Opens the local diff viewer — the one real client-side command (/review). */
  onReview: () => void;
  /** Sent as a literal prompt — no daemon-side handling. */
  onCommand: (command: '/plan' | '/compact') => void;
}

function shortModelName(model: string): string {
  const parts = model.split('-');
  return parts.length > 1 ? parts.slice(-2).join('-') : model;
}

/** HIG segmented control — Linear restraint: accent lives only on the active segment. */
function Segmented<T extends string>({
  value,
  options,
  onChange,
  colors,
}: {
  value: T;
  options: Array<{ label: string; value: T }>;
  onChange: (value: T) => void;
  colors: ThemeColors;
}) {
  return (
    <View
      style={[
        styles.segmented,
        {
          backgroundColor: colors.isDark
            ? Glass.opacity.dark.subtle
            : Glass.opacity.light.subtle,
        },
      ]}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            onPress={() => onChange(opt.value)}
            style={({ pressed }) => [
              styles.segment,
              active && [
                styles.segmentActive,
                { backgroundColor: Colors.primary[500] },
              ],
              !active && pressed && { opacity: 0.6 },
            ]}
            hitSlop={2}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
          >
            <Text
              numberOfLines={1}
              style={[
                styles.segmentText,
                active
                  ? styles.segmentTextActive
                  : { color: colors.textSecondary },
              ]}
            >
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function SectionHeader({ title, colors }: { title: string; colors: ThemeColors }) {
  return <Text style={[styles.sectionHeader, { color: colors.textTertiary }]}>{title}</Text>;
}

/** Inset-grouped container — rows live inside one rounded surface, iOS Settings style. */
function Group({ colors, children }: { colors: ThemeColors; children: React.ReactNode }) {
  return (
    <View
      style={[
        styles.group,
        {
          backgroundColor: colors.isDark
            ? Glass.opacity.dark.subtle
            : Glass.opacity.light.subtle,
        },
      ]}
    >
      {children}
    </View>
  );
}

function Checkmark({ colors }: { colors: ThemeColors }) {
  return <Ionicons name="checkmark" size={16} color={Colors.primary[400]} />;
}

function Row({
  label,
  sub,
  icon,
  warning,
  selected,
  colors,
  onPress,
  trailing,
}: {
  label: string;
  sub?: string;
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  warning?: boolean;
  selected?: boolean;
  colors: ThemeColors;
  onPress: () => void;
  trailing?: React.ReactNode;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      onPress={onPress}
    >
      {icon ? (
        <View style={[styles.rowIconWrap, { backgroundColor: Colors.primary[500] + '1f' }]}>
          <Ionicons name={icon} size={14} color={Colors.primary[400]} />
        </View>
      ) : null}
      <View style={styles.rowTextWrap}>
        <Text
          style={[styles.rowLabel, selected && styles.rowLabelSelected, { color: colors.textPrimary }]}
          numberOfLines={1}
        >
          {label}
        </Text>
        {sub ? (
          <Text
            style={[
              styles.rowSub,
              { color: warning && selected ? Colors.warning[400] : colors.textTertiary },
            ]}
            numberOfLines={1}
          >
            {sub}
          </Text>
        ) : null}
      </View>
      <View style={styles.rowSpacer} />
      {warning && selected ? (
        <Ionicons name="warning" size={15} color={Colors.warning[400]} />
      ) : null}
      {trailing ?? (selected ? <Checkmark colors={colors} /> : null)}
    </Pressable>
  );
}

/** Hairline separator inset to the text edge, per inset-grouped convention. */
function Separator({ colors, inset }: { colors: ThemeColors; inset: number }) {
  return (
    <View
      style={[styles.separator, { backgroundColor: colors.separator, marginLeft: inset }]}
    />
  );
}

const ACTION_TILES: Array<{
  label: string;
  sub: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
}> = [
  { label: 'Reference a file', sub: '@', icon: 'at-outline' },
  { label: 'Review changes', sub: '/review', icon: 'git-compare-outline' },
  { label: 'Plan this task', sub: '/plan', icon: 'list-outline' },
  { label: 'Compact context', sub: '/compact', icon: 'contract-outline' },
];

/**
 * Liquid-glass bottom sheet behind the composer's tune control — Linear
 * surfaces (Open Design "linear-app"), inset-grouped rows, segmented
 * controls for mutually exclusive settings. Every control maps to a real
 * protocol message or a real slash command.
 */
export function ComposerSettingsSheet({
  visible,
  onClose,
  colors,
  models,
  selectedModel,
  onSelectModel,
  thinkingMode,
  thinkingLevel,
  onThinking,
  serviceTier,
  onServiceTier,
  accessMode,
  onAccessMode,
  onInsertFile,
  onReview,
  onCommand,
}: Props) {
  const insets = useSafeAreaInsets();

  // The Manual branch reveals the level segmented row — animate the insert.
  useEffect(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
  }, [thinkingMode]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <BlurView
            tint={colors.isDark ? 'systemUltraThinMaterialDark' : 'systemUltraThinMaterialLight'}
            intensity={Glass.blur.sheet}
            style={styles.sheetBlur}
          >
            {/* Surface tint + hairline edge — same glass recipe as cards/nav. */}
            <View
              style={[
                StyleSheet.absoluteFill,
                {
                  backgroundColor: colors.isDark
                    ? Glass.opacity.dark.elevated
                    : Glass.opacity.light.elevated,
                },
              ]}
              pointerEvents="none"
            />
            <View
              style={[
                StyleSheet.absoluteFill,
                {
                  borderWidth: StyleSheet.hairlineWidth,
                  borderColor: colors.isDark
                    ? Glass.opacity.dark.border
                    : Glass.opacity.light.border,
                },
              ]}
              pointerEvents="none"
            />

            <View style={[styles.handle, { backgroundColor: colors.separator }]} />

            <View style={styles.titleRow}>
              <Text style={[styles.title, { color: colors.textPrimary }]}>Chat Settings</Text>
              <Pressable
                onPress={onClose}
                style={({ pressed }) => [
                  styles.closeLens,
                  {
                    backgroundColor: colors.isDark
                      ? Glass.opacity.dark.subtle
                      : Glass.opacity.light.subtle,
                    borderColor: colors.isDark
                      ? Glass.opacity.dark.border
                      : Glass.opacity.light.border,
                    opacity: pressed ? 0.6 : 1,
                    transform: [{ scale: pressed ? 0.92 : 1 }],
                  },
                ]}
                hitSlop={6}
                accessibilityLabel="Close settings"
              >
                <Ionicons name="close" size={16} color={colors.textSecondary} />
              </Pressable>
            </View>

            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: insets.bottom + Spacing.md }}
            >
              <SectionHeader title="Model" colors={colors} />
              <Group colors={colors}>
                {models.length === 0 && (
                  <Text style={[styles.emptyHint, { color: colors.textTertiary }]}>
                    No models reported by the agent yet
                  </Text>
                )}
                {models.map((m, i) => (
                  <React.Fragment key={m}>
                    {i > 0 && <Separator colors={colors} inset={Spacing.lg} />}
                    <Row
                      label={shortModelName(m)}
                      selected={m === selectedModel}
                      colors={colors}
                      onPress={() => {
                        onSelectModel(m);
                        onClose();
                      }}
                    />
                  </React.Fragment>
                ))}
              </Group>

              <SectionHeader title="Thinking & Speed" colors={colors} />
              <Group colors={colors}>
                <View style={styles.configRow}>
                  <Text style={[styles.configLabel, { color: colors.textPrimary }]}>Thinking</Text>
                  <Segmented<ThinkingMode>
                    value={thinkingMode}
                    onChange={(mode) => onThinking(mode)}
                    options={[
                      { label: 'Off', value: 'none' },
                      { label: 'Auto', value: 'auto' },
                      { label: 'Manual', value: 'level' },
                    ]}
                    colors={colors}
                  />
                </View>
                {thinkingMode === 'level' && (
                  <View style={styles.configRowSub}>
                    <Text style={[styles.configLabel, { color: colors.textSecondary }]}>
                      Level
                    </Text>
                    <Segmented<ThinkingLevel>
                      value={thinkingLevel}
                      onChange={(level) => onThinking('level', level)}
                      options={[
                        { label: 'Min', value: 'minimal' },
                        { label: 'Low', value: 'low' },
                        { label: 'Med', value: 'medium' },
                        { label: 'High', value: 'high' },
                        { label: 'Max', value: 'xhigh' },
                      ]}
                      colors={colors}
                    />
                  </View>
                )}
                <Separator colors={colors} inset={Spacing.lg} />
                <View style={styles.configRow}>
                  <Text style={[styles.configLabel, { color: colors.textPrimary }]}>Speed</Text>
                  <Segmented<ServiceTier>
                    value={serviceTier}
                    onChange={onServiceTier}
                    options={[
                      { label: 'Normal', value: 'default' },
                      { label: 'Fast', value: 'fast' },
                    ]}
                    colors={colors}
                  />
                </View>
              </Group>

              <SectionHeader title="Access" colors={colors} />
              <Group colors={colors}>
                <Row
                  label="Ask before acting"
                  sub="Confirm each tool use"
                  selected={accessMode === 'on-request'}
                  colors={colors}
                  onPress={() => {
                    onAccessMode('on-request');
                    onClose();
                  }}
                />
                <Separator colors={colors} inset={Spacing.lg} />
                <Row
                  label="Full access"
                  sub="Run without prompts"
                  warning={accessMode === 'full-access'}
                  selected={accessMode === 'full-access'}
                  colors={colors}
                  onPress={() => {
                    onAccessMode('full-access');
                    onClose();
                  }}
                />
              </Group>

              <SectionHeader title="Quick Actions" colors={colors} />
              <View style={styles.tileGrid}>
                {ACTION_TILES.map((tile) => (
                  <Pressable
                    key={tile.sub}
                    style={({ pressed }) => [
                      styles.tile,
                      {
                        backgroundColor: colors.isDark
                          ? Glass.opacity.dark.subtle
                          : Glass.opacity.light.subtle,
                        borderColor: colors.isDark
                          ? Glass.opacity.dark.border
                          : Glass.opacity.light.border,
                        opacity: pressed ? 0.7 : 1,
                        transform: [{ scale: pressed ? 0.97 : 1 }],
                      },
                    ]}
                    onPress={() => {
                      if (tile.sub === '@') onInsertFile();
                      else if (tile.sub === '/review') onReview();
                      else onCommand(tile.sub as '/plan' | '/compact');
                      onClose();
                    }}
                  >
                    <View
                      style={[styles.rowIconWrap, { backgroundColor: Colors.primary[500] + '1f' }]}
                    >
                      <Ionicons name={tile.icon} size={14} color={Colors.primary[400]} />
                    </View>
                    <Text style={[styles.tileLabel, { color: colors.textPrimary }]} numberOfLines={1}>
                      {tile.label}
                    </Text>
                    <Text style={[styles.tileSub, { color: colors.textTertiary }]} numberOfLines={1}>
                      {tile.sub}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </ScrollView>
          </BlurView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  /** Floating glass card above the composer. */
  sheet: {
    maxHeight: '68%',
    marginHorizontal: Spacing.md,
    marginBottom: Spacing.md,
  },
  sheetBlur: {
    borderRadius: 24,
    borderCurve: 'continuous',
    overflow: 'hidden',
    shadowColor: '#08090a',
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.4,
    shadowRadius: 50,
    elevation: 12,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 5,
    borderRadius: 3,
    marginTop: Spacing.sm,
    marginBottom: Spacing.xs,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.xs,
    paddingBottom: Spacing.sm,
  },
  title: { ...Typography.headline },
  closeLens: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },

  sectionHeader: {
    ...Typography.overline,
    paddingHorizontal: Spacing.lg + 2,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.xs,
  },
  group: {
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    minHeight: 44,
    paddingHorizontal: Spacing.sm + 2,
    borderRadius: Radius.md,
  },
  rowPressed: {
    opacity: 0.55,
    transform: [{ scale: 0.99 }],
  },
  rowIconWrap: {
    width: 26,
    height: 26,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowTextWrap: {
    flexShrink: 1,
    gap: 1,
  },
  rowLabel: { ...Typography.subhead },
  rowLabelSelected: { fontWeight: '600' },
  rowSub: { ...Typography.caption1 },
  rowSpacer: { flex: 1 },
  emptyHint: {
    ...Typography.footnote,
    paddingHorizontal: Spacing.md + 4,
    paddingVertical: Spacing.sm,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
  },

  configRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
    minHeight: 48,
    paddingHorizontal: Spacing.sm + 2,
  },
  configRowSub: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
    minHeight: 44,
    paddingHorizontal: Spacing.sm + 2,
    paddingLeft: Spacing.lg,
  },
  configLabel: { ...Typography.subhead },

  segmented: {
    flexDirection: 'row',
    borderRadius: 9,
    padding: 2,
    flex: 1,
    maxWidth: 210,
  },
  segment: {
    flex: 1,
    minHeight: 28,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  segmentActive: {},
  segmentText: {
    ...Typography.caption1,
    fontWeight: '600',
  },
  segmentTextActive: { color: '#ffffff' },

  tileGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg + 2,
  },
  tile: {
    width: '47%',
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: Spacing.sm + 2,
    paddingHorizontal: Spacing.sm + 2,
    alignItems: 'flex-start',
    gap: 4,
  },
  tileLabel: {
    ...Typography.caption1,
    fontWeight: '600',
  },
  tileSub: {
    ...Typography.caption2,
    fontFamily: FontFamily.mono,
  },
});
