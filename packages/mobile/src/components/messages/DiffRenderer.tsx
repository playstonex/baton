import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { ThemeColors } from './TypingIndicator';

type DiffLineKind = 'addition' | 'deletion' | 'hunk' | 'meta' | 'neutral';

interface DiffLine {
  text: string;
  kind: DiffLineKind;
}

const LINE_COLORS: Record<DiffLineKind, { text: string; bg: string; indicator: string }> = {
  addition: { text: '#21C45E', bg: 'rgba(33,196,94,0.12)', indicator: '#21C45E' },
  deletion: { text: '#F04545', bg: 'rgba(140,46,46,0.12)', indicator: '#F04545' },
  hunk: { text: 'rgb(179,189,217)', bg: 'transparent', indicator: 'transparent' },
  meta: { text: 'transparent', bg: 'transparent', indicator: 'transparent' },
  neutral: { text: 'inherit', bg: 'transparent', indicator: 'transparent' },
};

function classifyLine(line: string): DiffLineKind {
  if (line.startsWith('@@')) return 'hunk';
  if (line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('---') || line.startsWith('+++')) return 'meta';
  if (line.startsWith('+')) return 'addition';
  if (line.startsWith('-')) return 'deletion';
  return 'neutral';
}

function parseDiff(diff: string): DiffLine[] {
  return diff.split('\n').map((line) => ({ text: line, kind: classifyLine(line) }));
}

interface Props {
  diff: string;
  colors: ThemeColors;
  maxLines?: number;
}

export const DiffRenderer = React.memo(function DiffRenderer({ diff, colors, maxLines }: Props) {
  const lines = parseDiff(diff);
  const visibleLines = maxLines ? lines.filter((l) => l.kind !== 'meta').slice(0, maxLines) : lines.filter((l) => l.kind !== 'meta');
  const hiddenCount = maxLines ? lines.filter((l) => l.kind !== 'meta').length - maxLines : 0;

  return (
    <View style={[styles.container, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
      {visibleLines.map((line, i) => {
        const lc = LINE_COLORS[line.kind];
        if (line.kind === 'meta') return null;
        return (
          <View key={i} style={[styles.lineRow, { backgroundColor: lc.bg === 'transparent' ? undefined : lc.bg }]}>
            <View style={[styles.indicator, { backgroundColor: lc.indicator }]} />
            <Text
              style={[
                styles.lineText,
                { color: lc.text === 'inherit' ? colors.textPrimary : lc.text },
              ]}
            >
              {line.text}
            </Text>
          </View>
        );
      })}
      {hiddenCount > 0 && (
        <Text style={[styles.moreLines, { color: colors.textTertiary }]}>
          +{hiddenCount} more lines
        </Text>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1,
  },
  lineRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  indicator: {
    width: 2,
  },
  lineText: {
    fontFamily: 'monospace',
    fontSize: 11,
    paddingHorizontal: 10,
    paddingVertical: 1,
  },
  moreLines: {
    fontSize: 11,
    fontFamily: 'monospace',
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
});
