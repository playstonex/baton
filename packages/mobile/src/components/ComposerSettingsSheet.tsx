import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import { Colors, FontFamily, Spacing, Typography } from '../constants/theme';
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

const LEVEL_ROWS: Array<{ label: string; level: ThinkingLevel }> = [
  { label: 'Minimal', level: 'minimal' },
  { label: 'Low', level: 'low' },
  { label: 'Medium', level: 'medium' },
  { label: 'High', level: 'high' },
  { label: 'X-High', level: 'xhigh' },
];

function SectionHeader({ title, colors }: { title: string; colors: ThemeColors }) {
  return (
    <Text style={[styles.sectionHeader, { color: colors.textTertiary }]}>{title}</Text>
  );
}

function Row({
  label,
  sub,
  icon,
  mono,
  selected,
  colors,
  onPress,
}: {
  label: string;
  sub?: string;
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  mono?: boolean;
  selected?: boolean;
  colors: ThemeColors;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.row, { opacity: pressed ? 0.55 : 1 }]}
      onPress={onPress}
    >
      {icon ? <Ionicons name={icon} size={15} color={colors.textTertiary} /> : null}
      <Text
        style={[styles.rowLabel, mono && styles.rowLabelMono, { color: colors.textPrimary }]}
        numberOfLines={1}
      >
        {label}
      </Text>
      {sub ? <Text style={[styles.rowSub, { color: colors.textTertiary }]}>{sub}</Text> : null}
      <View style={styles.rowSpacer} />
      {selected ? <Ionicons name="checkmark" size={15} color={Colors.primary[400]} /> : null}
    </Pressable>
  );
}

function Divider({ colors }: { colors: ThemeColors }) {
  return <View style={[styles.divider, { backgroundColor: colors.separator }]} />;
}

/**
 * Grouped bottom sheet behind the composer's condensed ≡ control — every
 * section maps to a real protocol message or a real slash command.
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
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[styles.sheet, { backgroundColor: colors.elevated }]}
          onPress={() => {}}
        >
          <View style={[styles.handle, { backgroundColor: colors.separator }]} />
          <ScrollView showsVerticalScrollIndicator={false} bounces={false}>
            <SectionHeader title="Model" colors={colors} />
            {models.length === 0 && (
              <Text style={[styles.emptyHint, { color: colors.textTertiary }]}>
                No models reported by the agent yet
              </Text>
            )}
            {models.map((m) => (
              <Row
                key={m}
                label={shortModelName(m)}
                mono
                selected={m === selectedModel}
                colors={colors}
                onPress={() => {
                  onSelectModel(m);
                  onClose();
                }}
              />
            ))}

            <Divider colors={colors} />
            <SectionHeader title="Thinking & Speed" colors={colors} />
            <Row
              label="Off"
              selected={thinkingMode === 'none'}
              colors={colors}
              onPress={() => onThinking('none')}
            />
            <Row
              label="Auto"
              selected={thinkingMode === 'auto'}
              colors={colors}
              onPress={() => onThinking('auto')}
            />
            {LEVEL_ROWS.map(({ label, level }) => (
              <Row
                key={level}
                label={label}
                selected={thinkingMode === 'level' && thinkingLevel === level}
                colors={colors}
                onPress={() => onThinking('level', level)}
              />
            ))}
            <Row
              label="Normal speed"
              sub="tier"
              selected={serviceTier === 'default'}
              colors={colors}
              onPress={() => onServiceTier('default')}
            />
            <Row
              label="Fast speed"
              sub="tier"
              selected={serviceTier === 'fast'}
              colors={colors}
              onPress={() => onServiceTier('fast')}
            />

            <Divider colors={colors} />
            <SectionHeader title="Access" colors={colors} />
            <Row
              label="Ask before acting"
              selected={accessMode === 'on-request'}
              colors={colors}
              onPress={() => {
                onAccessMode('on-request');
                onClose();
              }}
            />
            <Row
              label="Full access"
              selected={accessMode === 'full-access'}
              colors={colors}
              onPress={() => {
                onAccessMode('full-access');
                onClose();
              }}
            />

            <Divider colors={colors} />
            <SectionHeader title="Quick actions" colors={colors} />
            <Row
              label="Reference a file"
              sub="@"
              icon="at-outline"
              colors={colors}
              onPress={() => {
                onInsertFile();
                onClose();
              }}
            />
            <Row
              label="Review all changes"
              sub="/review"
              icon="git-compare-outline"
              colors={colors}
              onPress={() => {
                onReview();
                onClose();
              }}
            />
            <Row
              label="Plan this task"
              sub="/plan"
              icon="list-outline"
              colors={colors}
              onPress={() => {
                onCommand('/plan');
                onClose();
              }}
            />
            <Row
              label="Compact context"
              sub="/compact"
              icon="contract-outline"
              colors={colors}
              onPress={() => {
                onCommand('/compact');
                onClose();
              }}
            />
          </ScrollView>
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
  /** Floating card above the composer, per the chat-v3#sheet design frame. */
  sheet: {
    maxHeight: '62%',
    marginHorizontal: 12,
    marginBottom: 12,
    borderRadius: 18,
    borderCurve: 'continuous',
    paddingBottom: Spacing.sm,
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
  sectionHeader: {
    ...Typography.overline,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    minHeight: 44,
    paddingHorizontal: Spacing.lg,
  },
  rowLabel: {
    ...Typography.subhead,
    flexShrink: 1,
  },
  rowLabelMono: {
    fontFamily: FontFamily.mono,
    fontSize: 14,
  },
  rowSub: {
    ...Typography.caption1,
    fontFamily: FontFamily.mono,
  },
  rowSpacer: { flex: 1 },
  emptyHint: {
    ...Typography.footnote,
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.sm,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.sm,
  },
});
