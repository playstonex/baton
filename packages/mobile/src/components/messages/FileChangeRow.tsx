import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { ThemeColors } from './TypingIndicator';

const CHANGE_COLORS: Record<string, string> = {
  create: '#21C45E',
  modify: '#FF9500',
  delete: '#F04545',
};

const CHANGE_LABELS: Record<string, string> = {
  create: 'Created',
  modify: 'Modified',
  delete: 'Deleted',
};

interface Props {
  path: string;
  changeType: 'create' | 'modify' | 'delete';
  diff?: string;
  colors: ThemeColors;
}

function parseDiffCounts(diff: string): { added: number; removed: number } | null {
  let added = 0;
  let removed = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) added++;
    else if (line.startsWith('-') && !line.startsWith('---')) removed++;
  }
  if (added === 0 && removed === 0) return null;
  return { added, removed };
}

export const FileChangeRow = React.memo(function FileChangeRow({ path, changeType, diff, colors: _colors }: Props) {
  const color = CHANGE_COLORS[changeType] ?? '#FF9500';
  const label = CHANGE_LABELS[changeType] ?? changeType;
  const counts = diff ? parseDiffCounts(diff) : null;

  return (
    <View style={styles.row}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={[styles.label, { color }]}>{label}</Text>
      <Text style={styles.filePath} numberOfLines={1} ellipsizeMode="middle">
        {path}
      </Text>
      {counts && (
        <Text style={styles.counts}>
          <Text style={{ color: '#21C45E' }}>+{counts.added}</Text>
          {' '}
          <Text style={{ color: '#F04545' }}>-{counts.removed}</Text>
        </Text>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 3,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  label: {
    fontSize: 11,
    fontWeight: '500',
  },
  filePath: {
    fontSize: 12,
    fontFamily: 'monospace',
    color: '#3b82f6',
    flexShrink: 1,
  },
  counts: {
    fontSize: 11,
    fontFamily: 'monospace',
  },
});
