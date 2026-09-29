import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import type { ThemeColors } from './TypingIndicator';
import { TypingIndicator } from './TypingIndicator';
import { humanizeCommand } from './CommandHumanizer';
import { Colors, FontFamily } from '../../constants/theme';

interface Props {
  command: string;
  output?: string;
  exitCode?: number;
  isStreaming?: boolean;
  colors: ThemeColors;
}

function truncateCommand(raw: string, maxLen = 160): string {
  const s = raw.replace(/\s+/g, ' ').trim();
  return s.length > maxLen ? s.slice(0, maxLen - 1) + '…' : s;
}

/** Quiet 16px status dot: soft tint + glyph, no saturated pills. */
function StatusIcon({ isStreaming, isFailed, colors }: { isStreaming: boolean; isFailed: boolean; colors: ThemeColors }) {
  if (isStreaming) {
    return (
      <View style={[statusStyles.circle, { backgroundColor: colors.isDark ? 'rgba(94,106,210,0.25)' : 'rgba(94,106,210,0.14)' }]}>
        <View style={[statusStyles.pulse, { backgroundColor: Colors.primary[300] }]} />
      </View>
    );
  }
  if (isFailed) {
    return (
      <View style={[statusStyles.circle, { backgroundColor: colors.isDark ? 'rgba(235,77,85,0.16)' : 'rgba(207,34,46,0.1)' }]}>
        <Ionicons name="close" size={10} color={Colors.danger[400]} />
      </View>
    );
  }
  return (
    <View style={[statusStyles.circle, { backgroundColor: colors.isDark ? 'rgba(63,185,80,0.16)' : 'rgba(26,127,55,0.1)' }]}>
      <Ionicons name="checkmark" size={10} color={colors.isDark ? Colors.success[400] : Colors.success[600]} />
    </View>
  );
}

const statusStyles = StyleSheet.create({
  circle: {
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulse: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
});

/**
 * Codex-style compact command row: verb + target on line one, the raw
 * command as a single middle-truncated mono line, quiet status dot.
 * Rows stack into a hairline-separated list — no card per call.
 */
export const CommandExecCard = React.memo(function CommandExecCard({ command, output, exitCode, isStreaming, colors }: Props) {
  const hasCommand = command && command.trim().length > 0;
  const hasOutput = output && output.trim().length > 0;

  if (!hasCommand && !hasOutput && exitCode == null) return null;

  const display = hasCommand ? humanizeCommand(command, isStreaming ?? false) : null;
  const isFailed = exitCode != null && exitCode !== 0;
  const verbText = display ? display.verb : isStreaming ? 'Running' : isFailed ? 'Failed' : 'Completed';
  const targetText = display ? display.target : 'command';

  return (
    <View style={[styles.rowWrap, { borderBottomColor: colors.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)' }]}>
      <View style={styles.header}>
        <StatusIcon isStreaming={isStreaming ?? false} isFailed={isFailed} colors={colors} />
        <Text style={[styles.verb, { color: colors.textSecondary }]} numberOfLines={1}>
          {verbText}
          {targetText ? (
            <Text style={[styles.target, { color: colors.textTertiary }]}>
              {' '}{targetText}
            </Text>
          ) : null}
        </Text>
      </View>

      {hasCommand && (
        <Text
          style={[styles.cmdText, { color: colors.textTertiary }]}
          numberOfLines={1}
          ellipsizeMode="middle"
        >
          {truncateCommand(command)}
        </Text>
      )}

      {isStreaming && <TypingIndicator colors={colors} />}
    </View>
  );
});

const styles = StyleSheet.create({
  rowWrap: {
    width: '100%',
    paddingHorizontal: 2,
    paddingTop: 5,
    paddingBottom: 7,
    gap: 3,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  verb: {
    flex: 1,
    fontSize: 13,
    fontWeight: '500',
  },
  target: {
    fontWeight: '400',
  },
  cmdText: {
    fontSize: 11,
    fontFamily: FontFamily.mono,
    lineHeight: 15,
    marginLeft: 23,
  },
});
