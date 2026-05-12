import { StyleSheet } from 'react-native';
import { View, Text, FlatList, Pressable } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo } from 'react';
import type { ParsedEvent } from '@baton/shared';
import { useEventsStore } from '../../src/stores/events';
import { wsService } from '../../src/services/websocket';
import { useThemeColors } from '../../src/hooks/useThemeColors';
import { Typography, CornerRadius, Spacing, Colors } from '../../src/constants/theme';
import { useHeaderHeight } from 'expo-router/react-navigation';

const CHANGE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  create: { bg: Colors.success[50], text: Colors.success[600], border: Colors.success[400] },
  modify: { bg: Colors.primary[50], text: Colors.primary[700], border: Colors.primary[500] },
  delete: { bg: Colors.danger[50], text: Colors.danger[600], border: Colors.danger[400] },
};

const EVENT_TYPE_ICON: Record<string, string> = {
  status_change: '\u{21BB}',
  thinking: '\u{1F4AD}',
  tool_use: '\u{1F527}',
  file_change: '\u{1F4C4}',
  command_exec: '\u{2318}',
  error: '\u{26A0}',
};

export default function AgentDetailScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const router = useRouter();
  const events = useEventsStore((s) => s.events);
  const fileChanges = useEventsStore((s) => s.fileChanges);
  const toolUses = useEventsStore((s) => s.toolUses);
  const addEvent = useEventsStore((s) => s.addEvent);
  const clearEvents = useEventsStore((s) => s.clearEvents);
  const c = useThemeColors();
  const headerHeight = useHeaderHeight();

  useEffect(() => {
    if (!sessionId) return;
    clearEvents();
    wsService.send({ type: 'control', action: 'attach_session', sessionId });

    const unsubEvent = wsService.on('parsed_event', (msg) => {
      if (msg.type === 'parsed_event' && msg.sessionId === sessionId) {
        addEvent(msg.event);
      }
    });

    return () => {
      unsubEvent();
    };
  }, [sessionId, addEvent, clearEvents]);

  const allEvents = useMemo(() => {
    const statusEvts = events.filter(
      (e) => e.type === 'status_change' || e.type === 'thinking' || e.type === 'error',
    );
    return [...statusEvts, ...toolUses]
      .sort((a, b) => a.timestamp - b.timestamp)
      .slice(-500);
  }, [events, toolUses]);

  const time = (ts: number) => new Date(ts).toLocaleTimeString();

  return (
    <View style={[styles.container, { backgroundColor: c.bg, paddingTop: headerHeight }]}>
      <View style={[styles.toolbar, { backgroundColor: c.card, borderBottomColor: c.separator }]}>
        <View style={styles.toolbarLeft}>
          <View style={[styles.toolbarIcon, { backgroundColor: c.accentBg }]}>
            <Text style={styles.toolbarIconText}>{'\u{1F916}'}</Text>
          </View>
          <View>
            <Text style={[Typography.headline, { color: c.textPrimary }]}>Agent Detail</Text>
            <Text style={[Typography.caption1, { color: c.textTertiary, fontFamily: 'monospace', fontWeight: '500' }]}>
              {sessionId?.slice(0, 8)}
            </Text>
          </View>
        </View>
        <Pressable
          onPress={() => router.push(`/terminal/${sessionId}`)}
          style={[styles.terminalButton, { backgroundColor: c.accentBg }]}
        >
          <Text style={[Typography.footnote, { color: Colors.primary[500], fontWeight: '600' }]}>Terminal</Text>
          <Text style={[Typography.footnote, { color: Colors.primary[500] }]}>{'\u{2192}'}</Text>
        </Pressable>
      </View>

      <View style={styles.statsRow}>
        {[
          { label: 'FILES CHANGED', value: fileChanges.length, color: Colors.primary[500], icon: '\u{1F4C4}' },
          { label: 'TOOL CALLS', value: toolUses.length, color: '#AF52DE', icon: '\u{1F527}' },
          { label: 'TOTAL EVENTS', value: events.length, color: Colors.success[400], icon: '\u{26A1}' },
        ].map((s) => (
          <View key={s.label} style={[styles.statCard, { backgroundColor: c.card }]}>
            <Text style={styles.statIcon}>{s.icon}</Text>
            <Text style={[Typography.title1, { color: s.color }]}>{s.value}</Text>
            <Text style={[Typography.caption1, { color: c.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: '600' }]}>
              {s.label}
            </Text>
          </View>
        ))}
      </View>

      {fileChanges.length > 0 && (
        <View style={styles.fileChangesSection}>
          <Text style={[Typography.footnote, { color: c.textTertiary, textTransform: 'uppercase', fontWeight: '600', letterSpacing: 0.5, marginBottom: Spacing.sm }]}>
            File Changes
          </Text>
          <View style={[styles.fileChangesList, { backgroundColor: c.card }]}>
            {fileChanges.slice(0, 10).map((e, i) => {
              if (e.type !== 'file_change') return null;
              const colors = CHANGE_COLORS[e.changeType] ?? { bg: c.elevated, text: c.textSecondary, border: c.cardBorder };
              return (
                <View
                  key={i}
                  style={[
                    styles.fileChangeRow,
                    { borderLeftColor: colors.border, borderBottomColor: i < Math.min(fileChanges.length, 10) - 1 ? c.separator : 'transparent' },
                  ]}
                >
                  <View style={[styles.changeTypeChip, { backgroundColor: colors.bg }]}>
                    <Text style={[Typography.caption2, { color: colors.text, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 }]}>
                      {e.changeType}
                    </Text>
                  </View>
                  <Text style={[Typography.caption1, { color: c.textSecondary, fontFamily: 'monospace', flex: 1 }]} numberOfLines={1}>
                    {e.path}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>
      )}

      <View style={styles.timelineHeader}>
        <Text style={[Typography.footnote, { color: c.textPrimary, fontWeight: '600' }]}>Event Timeline</Text>
        <View style={[styles.timelineCount, { backgroundColor: c.elevated }]}>
          <Text style={[Typography.caption2, { color: c.textTertiary, fontWeight: '600' }]}>{allEvents.length}</Text>
        </View>
      </View>
      <FlatList
        data={allEvents}
        keyExtractor={(_, i) => String(i)}
        contentContainerStyle={styles.timelineList}
        ListEmptyComponent={
          <View style={[styles.emptyState, { backgroundColor: c.card }]}>
            <Text style={[Typography.subhead, { color: c.textSecondary }]}>Waiting for events...</Text>
            <Text style={[Typography.caption1, { color: c.textTertiary, marginTop: Spacing.xs }]}>
              Events will appear as the agent runs
            </Text>
          </View>
        }
        renderItem={({ item: event, index }) => {
          const desc = eventDescription(event);
          const icon = EVENT_TYPE_ICON[event.type] ?? '\u{25CF}';
          return (
            <View style={styles.timelineRow}>
              <View style={styles.timelineTrack}>
                <View style={[styles.timelineDot, { backgroundColor: c.elevated }]}>
                  <Text style={styles.timelineDotText}>{icon}</Text>
                </View>
                {index < allEvents.length - 1 && <View style={[styles.timelineLine, { backgroundColor: c.separator }]} />}
              </View>
              <View style={styles.timelineContent}>
                <Text style={[Typography.caption2, { color: c.textTertiary, fontWeight: '500', fontVariant: ['tabular-nums'] as const }]}>
                  {time(event.timestamp)}
                </Text>
                <Text style={[Typography.subhead, { color: c.textSecondary }]} numberOfLines={1}>{desc}</Text>
              </View>
            </View>
          );
        }}
      />
    </View>
  );
}

function eventDescription(event: ParsedEvent): string {
  switch (event.type) {
    case 'status_change': return `Status \u{2192} ${event.status}`;
    case 'thinking': return 'Thinking...';
    case 'tool_use': return `${event.tool}${event.args?.filePath ? ` \u{2192} ${event.args.filePath}` : ''}`;
    case 'file_change': return `${event.changeType} ${event.path}`;
    case 'command_exec': return `$ ${event.command}`;
    case 'error': return event.message.slice(0, 60);
    default: return '';
  }
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  toolbar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  toolbarLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  toolbarIcon: {
    width: 36,
    height: 36,
    borderRadius: CornerRadius.medium,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolbarIconText: { fontSize: 16 },
  terminalButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: CornerRadius.medium,
    borderCurve: 'continuous',
    minHeight: 36,
  },
  statsRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  statCard: {
    flex: 1,
    borderRadius: CornerRadius.large,
    borderCurve: 'continuous',
    padding: Spacing.lg,
    alignItems: 'center',
    gap: 2,
  },
  statIcon: { fontSize: 18, marginBottom: Spacing.xs },
  fileChangesSection: {
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  fileChangesList: {
    borderRadius: CornerRadius.large,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  fileChangeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderLeftWidth: 3,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  changeTypeChip: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: CornerRadius.small,
    borderCurve: 'continuous',
  },
  timelineHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.xs,
  },
  timelineCount: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: CornerRadius.small,
    borderCurve: 'continuous',
    overflow: 'hidden',
    minWidth: 24,
    alignItems: 'center',
  },
  timelineList: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing['3xl'],
  },
  emptyState: {
    padding: Spacing['4xl'],
    alignItems: 'center',
    borderRadius: CornerRadius.large,
    borderCurve: 'continuous',
    marginTop: Spacing.xs,
  },
  timelineRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  timelineTrack: {
    width: 24,
    alignItems: 'center',
  },
  timelineDot: {
    width: 24,
    height: 24,
    borderRadius: CornerRadius.medium,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  timelineDotText: { fontSize: 10 },
  timelineLine: {
    width: 1.5,
    flex: 1,
    minHeight: Spacing.md,
  },
  timelineContent: {
    flex: 1,
    paddingVertical: 3,
    paddingBottom: Spacing.md,
  },
});
