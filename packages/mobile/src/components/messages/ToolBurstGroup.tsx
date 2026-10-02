import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import { Colors, FontFamily } from '../../constants/theme';
import type { ThemeColors } from './TypingIndicator';

interface Props {
  /** Total tool/file/command messages captured by this run. */
  count: number;
  /** False while the run is still streaming — swaps ✓ for a live dot. */
  done?: boolean;
  /** Wall-clock span of the burst (last minus first message timestamp). */
  durationMs?: number;
  colors: ThemeColors;
  /** Rendered only when expanded (Codex-style collapsed run card). */
  children?: React.ReactNode;
  isExpanded: boolean;
  onToggle: () => void;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return '';
  const s = ms / 1000;
  if (s < 60) return `${s < 10 ? s.toFixed(1) : Math.round(s)}s`;
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

export const ToolBurstGroup = React.memo(function ToolBurstGroup({
  count,
  done = true,
  durationMs = 0,
  colors,
  children,
  isExpanded,
  onToggle,
}: Props) {
  const duration = done ? formatDuration(durationMs) : '';
  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: colors.isDark ? 'rgba(25,26,29,0.85)' : 'rgba(255,255,255,0.92)',
        },
      ]}
    >
      <Pressable
        style={({ pressed }) => [styles.header, { opacity: pressed ? 0.7 : 1 }]}
        onPress={onToggle}
        hitSlop={4}
        accessibilityLabel={isExpanded ? 'Collapse tool activity' : 'Expand tool activity'}
      >
        {done ? (
          <Ionicons name="checkmark" size={13} color={Colors.success[400]} />
        ) : (
          <View style={[styles.liveDot, { backgroundColor: Colors.primary[300] }]} />
        )}
        <Text style={[styles.title, { color: colors.textSecondary }]}>
          {done ? 'Ran' : 'Running'} {count} tool{count !== 1 ? 's' : ''}
        </Text>
        {duration ? (
          <Text style={[styles.duration, { color: colors.textTertiary }]}>{duration}</Text>
        ) : null}
        <Ionicons
          name="chevron-forward"
          size={10}
          color={colors.textTertiary}
          style={{ transform: [{ rotate: isExpanded ? '90deg' : '0deg' }] }}
        />
      </Pressable>
      {isExpanded && (
        <View style={[styles.body, { borderTopColor: colors.separator }]}>{children}</View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  card: {
    alignSelf: 'flex-start',
    minWidth: 150,
    borderRadius: 13,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingVertical: 9,
    paddingHorizontal: 12,
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  title: {
    fontSize: 12.5,
    fontWeight: '600',
  },
  duration: {
    fontFamily: FontFamily.mono,
    fontSize: 11,
  },
  body: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingTop: 3,
    paddingBottom: 9,
    gap: 8,
  },
});
