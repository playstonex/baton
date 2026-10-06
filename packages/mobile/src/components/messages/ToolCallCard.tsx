import React, { useState, useCallback } from 'react';
import { View, Text, Pressable, StyleSheet, LayoutAnimation, ActivityIndicator } from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import type { ThemeColors } from './TypingIndicator';
import { FontFamily, Colors } from '../../constants/theme';

interface Props {
  toolName: string;
  title?: string;
  args?: Record<string, unknown>;
  output?: string;
  /** Live call in flight (tool_call_start seen, no end yet). */
  isRunning?: boolean;
  durationMs?: number;
  success?: boolean;
  colors: ThemeColors;
}

function formatDuration(ms?: number): string | null {
  if (ms === undefined || ms < 0) return null;
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`;
  const total = Math.floor(ms / 1000);
  if (total < 60) return `${total}s`;
  const m = Math.floor(total / 60);
  return `${m}m ${String(total % 60).padStart(2, '0')}s`;
}

export const ToolCallCard = React.memo(function ToolCallCard({
  toolName,
  title,
  args,
  output,
  isRunning,
  durationMs,
  success,
  colors,
}: Props) {
  const [showOutput, setShowOutput] = useState(false);
  const filePath = (args?.filePath ?? args?.path ?? '') as string;
  const duration = formatDuration(durationMs);

  const toggle = useCallback(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setShowOutput((prev) => !prev);
  }, []);

  const label = title || toolName;
  const hasDetail = Boolean(title && title !== toolName && filePath) || Boolean(output);

  return (
    <View style={styles.container}>
      <Pressable style={styles.row} onPress={hasDetail ? toggle : undefined} hitSlop={4}>
        {isRunning ? (
          <ActivityIndicator size="small" color={colors.textTertiary} style={styles.spinner} />
        ) : success === false ? (
          <Ionicons name="alert-circle" size={12} color={Colors.danger[400]} />
        ) : (
          <Ionicons name="construct-outline" size={12} color={colors.textTertiary} />
        )}
        <Text
          style={[styles.toolName, { color: success === false ? Colors.danger[400] : colors.textSecondary }]}
          numberOfLines={1}
          ellipsizeMode="middle"
        >
          {label}
        </Text>
        {filePath && title !== filePath ? (
          <>
            <Text style={[styles.arrow, { color: colors.textTertiary }]}>{' \u2192 '}</Text>
            <Text style={styles.filePath} numberOfLines={1} ellipsizeMode="middle">
              {filePath}
            </Text>
          </>
        ) : null}
        {duration ? (
          <Text style={[styles.duration, { color: colors.textTertiary }]}>{duration}</Text>
        ) : null}
        {hasDetail ? (
          <Ionicons
            name={showOutput ? 'chevron-up' : 'chevron-down'}
            size={11}
            color={colors.textTertiary}
          />
        ) : null}
      </Pressable>
      {output ? (
        <Pressable onPress={toggle}>
          <Text
            style={[styles.output, { color: colors.textTertiary }]}
            numberOfLines={showOutput ? undefined : 3}
          >
            {output}
          </Text>
          {!showOutput && output.length > 120 && (
            <Text style={[styles.more, { color: colors.textTertiary }]}>Show more</Text>
          )}
        </Pressable>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    paddingVertical: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  spinner: {
    transform: [{ scale: 0.7 }],
  },
  toolName: {
    fontSize: 12,
    fontWeight: '500',
    fontFamily: FontFamily.mono,
    flexShrink: 1,
  },
  arrow: {
    fontSize: 12,
  },
  filePath: {
    fontSize: 12,
    fontFamily: FontFamily.mono,
    color: Colors.primary[500],
    flexShrink: 1,
  },
  duration: {
    fontSize: 11,
    fontFamily: FontFamily.mono,
    fontVariant: ['tabular-nums'],
    marginLeft: 2,
  },
  output: {
    fontSize: 11,
    fontFamily: FontFamily.mono,
    marginTop: 4,
    lineHeight: 15,
  },
  more: {
    fontSize: 11,
    marginTop: 2,
  },
});
