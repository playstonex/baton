import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import { sessionBucketLabel, type SessionBucket } from '@baton/shared/utils';
import { useThemeColors } from '../../hooks/useThemeColors';
import { Spacing, Typography } from '../../constants/theme';
import { BUCKET_COLOR } from './agentMeta';
import { StatusDot } from './SessionRow';

interface SessionGroupHeaderProps {
  title: string;
  count: number;
  bucket: SessionBucket;
  collapsed: boolean;
  onToggle: () => void;
}

export function SessionGroupHeader({
  title,
  count,
  bucket,
  collapsed,
  onToggle,
}: SessionGroupHeaderProps) {
  const c = useThemeColors();
  const urgent = bucket === 'needs_input' || bucket === 'failed';
  const showSummary = collapsed && bucket !== 'done' && bucket !== 'idle';

  return (
    <Pressable
      onPress={onToggle}
      style={styles.header}
      accessibilityRole="button"
      accessibilityState={{ expanded: !collapsed }}
    >
      <Ionicons
        name={collapsed ? 'chevron-forward' : 'chevron-down'}
        size={12}
        color={c.textTertiary}
      />
      <Text style={[styles.title, { color: c.textTertiary }]} numberOfLines={1}>
        {title}
      </Text>
      <Text style={[styles.count, { color: c.textTertiary }]}>{count}</Text>
      <View style={styles.spacer} />
      {(urgent || showSummary) && (
        <View style={styles.summary}>
          <StatusDot bucket={bucket} size={7} />
          <Text style={[styles.summaryText, { color: BUCKET_COLOR[bucket] }]}>
            {sessionBucketLabel(bucket)}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingLeft: Spacing.xs,
    paddingVertical: 6,
    marginBottom: 2,
  },
  title: { ...Typography.caption2, fontWeight: '700', letterSpacing: 0.4, flexShrink: 1 },
  count: { ...Typography.caption2, fontSize: 11 },
  spacer: { flex: 1 },
  summary: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingRight: 8 },
  summaryText: { fontSize: 10, fontWeight: '700' },
});
