import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { ThemeColors } from './TypingIndicator';
import { TypingIndicator } from './TypingIndicator';
import { humanizeCommand } from './CommandHumanizer';

interface Props {
  command: string;
  output?: string;
  exitCode?: number;
  isStreaming?: boolean;
  colors: ThemeColors;
}

function truncateCommand(raw: string, maxLen = 200): string {
  const s = raw.replace(/\s+/g, ' ').trim();
  return s.length > maxLen ? s.slice(0, maxLen - 1) + '…' : s;
}

function StatusIcon({ isStreaming, isFailed }: { isStreaming: boolean; isFailed: boolean }) {
  if (isStreaming) {
    return (
      <View style={[statusStyles.circle, statusStyles.running]}>
        <View style={statusStyles.pulse} />
      </View>
    );
  }
  if (isFailed) {
    return (
      <View style={[statusStyles.circle, statusStyles.failedCircle]}>
        <Text style={statusStyles.xMark}>✕</Text>
      </View>
    );
  }
  return (
    <View style={[statusStyles.circle, statusStyles.doneCircle]}>
      <Text style={statusStyles.checkMark}>✓</Text>
    </View>
  );
}

const statusStyles = StyleSheet.create({
  circle: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneCircle: {
    backgroundColor: '#34C759',
  },
  failedCircle: {
    backgroundColor: '#F04545',
  },
  running: {
    backgroundColor: 'rgba(120,120,128,0.2)',
  },
  pulse: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#8E8E93',
  },
  checkMark: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 18,
    textAlign: 'center',
  },
  xMark: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
    lineHeight: 18,
    textAlign: 'center',
  },
});

export const CommandExecCard = React.memo(function CommandExecCard({ command, output, exitCode, isStreaming, colors }: Props) {
  const hasCommand = command && command.trim().length > 0;
  const hasOutput = output && output.trim().length > 0;

  if (!hasCommand && !hasOutput && exitCode == null) return null;

  const display = hasCommand ? humanizeCommand(command, isStreaming ?? false) : null;
  const isFailed = exitCode != null && exitCode !== 0;
  const verbText = display ? display.verb : isStreaming ? 'Running' : isFailed ? 'Failed' : 'Completed';
  const targetText = display ? display.target : 'command';

  return (
    <View style={[styles.card, { backgroundColor: colors.subtle }]}>
      <View style={styles.header}>
        <Text style={[styles.verb, { color: colors.textSecondary }]} numberOfLines={1}>
          {verbText}
          {targetText ? (
            <Text style={[styles.target, { color: colors.textTertiary }]}>
              {' '}{targetText}
            </Text>
          ) : null}
        </Text>
        <StatusIcon isStreaming={isStreaming ?? false} isFailed={isFailed} />
      </View>

      {hasCommand && (
        <Text
          style={[styles.cmdText, { color: colors.textTertiary }]}
          numberOfLines={3}
        >
          $ {truncateCommand(command)}
        </Text>
      )}

      {isStreaming && <TypingIndicator colors={colors} />}
    </View>
  );
});

const styles = StyleSheet.create({
  card: {
    width: '100%',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingTop: 5,
    paddingBottom: 4,
    marginBottom: 6,
    gap: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
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
    fontFamily: 'monospace',
    lineHeight: 15,
    opacity: 0.7,
  },
});
