import { StyleSheet } from 'react-native';
import { View, Text, FlatList, Pressable } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo } from 'react';
import { Button, Card, Chip } from 'heroui-native';
import type { ParsedEvent } from '@baton/shared';
import { useEventsStore } from '../../src/stores/events';
import { wsService } from '../../src/services/websocket';
import { Colors } from '../../src/constants/theme';

const CHANGE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  create: { bg: 'rgba(34,197,94,0.1)', text: '#4ade80', border: 'rgba(34,197,94,0.25)' },
  modify: { bg: 'rgba(59,130,246,0.1)', text: '#60a5fa', border: 'rgba(59,130,246,0.25)' },
  delete: { bg: 'rgba(239,68,68,0.1)', text: '#f87171', border: 'rgba(239,68,68,0.25)' },
};

const EVENT_TYPE_ICON: Record<string, string> = {
  status_change: '\u{21BB}',
  thinking: '\u{1F4AD}',
  tool_use: '\u{1F527}',
  file_change: '\u{1F4C4}',
  command_exec: '\u{2318}',
  error: '\u{26A0}',
};

const BG = '#09090b';
const CARD = '#111113';
const ELEVATED = '#1a1a1e';
const BORDER = 'rgba(255,255,255,0.06)';
const TEXT_PRIMARY = '#f4f4f5';
const TEXT_SECONDARY = '#a1a1aa';
const TEXT_MUTED = '#71717a';

export default function AgentDetailScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const router = useRouter();
  const events = useEventsStore((s) => s.events);
  const fileChanges = useEventsStore((s) => s.fileChanges);
  const toolUses = useEventsStore((s) => s.toolUses);
  const addEvent = useEventsStore((s) => s.addEvent);
  const clearEvents = useEventsStore((s) => s.clearEvents);

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
    <View style={styles.container}>
      <View style={styles.toolbar}>
        <View style={styles.toolbarLeft}>
          <View style={styles.toolbarIcon}>
            <Text style={styles.toolbarIconText}>{'\u{1F916}'}</Text>
          </View>
          <View>
            <Text style={styles.toolbarTitle}>Agent Detail</Text>
            <Text style={styles.toolbarId}>{sessionId?.slice(0, 8)}</Text>
          </View>
        </View>
        <Pressable
          onPress={() => router.push(`/terminal/${sessionId}`)}
          style={styles.terminalButton}
        >
          <Text style={styles.terminalButtonText}>Terminal</Text>
          <Text style={styles.terminalButtonArrow}>{'\u{2192}'}</Text>
        </Pressable>
      </View>

      <View style={styles.statsRow}>
        {[
          { label: 'Files Changed', value: fileChanges.length, color: '#3b82f6', icon: '\u{1F4C4}' },
          { label: 'Tool Calls', value: toolUses.length, color: '#a855f7', icon: '\u{1F527}' },
          { label: 'Total Events', value: events.length, color: '#22c55e', icon: '\u{26A1}' },
        ].map((s) => (
          <View key={s.label} style={[styles.statCard, { borderTopColor: s.color }]}>
            <Text style={styles.statIcon}>{s.icon}</Text>
            <Text style={[styles.statValue, { color: s.color }]}>{s.value}</Text>
            <Text style={styles.statLabel}>{s.label}</Text>
          </View>
        ))}
      </View>

      {fileChanges.length > 0 && (
        <View style={styles.fileChangesSection}>
          <Text style={styles.sectionTitle}>File Changes</Text>
          <View style={styles.fileChangesList}>
            {fileChanges.slice(0, 10).map((e, i) => {
              if (e.type !== 'file_change') return null;
              const colors = CHANGE_COLORS[e.changeType] ?? { bg: ELEVATED, text: TEXT_SECONDARY, border: BORDER };
              return (
                <View key={i} style={[styles.fileChangeRow, { borderLeftColor: colors.border }]}>
                  <View style={[styles.changeTypeChip, { backgroundColor: colors.bg }]}>
                    <Text style={[styles.changeTypeText, { color: colors.text }]}>{e.changeType}</Text>
                  </View>
                  <Text style={styles.changePath} numberOfLines={1}>{e.path}</Text>
                </View>
              );
            })}
          </View>
        </View>
      )}

      <View style={styles.timelineHeader}>
        <Text style={styles.sectionTitle}>Event Timeline</Text>
        <Text style={styles.timelineCount}>{allEvents.length}</Text>
      </View>
      <FlatList
        data={allEvents}
        keyExtractor={(_, i) => String(i)}
        contentContainerStyle={styles.timelineList}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>{'\u{23F3}'}</Text>
            <Text style={styles.emptyText}>Waiting for events...</Text>
            <Text style={styles.emptySubtext}>Events will appear as the agent runs</Text>
          </View>
        }
        renderItem={({ item: event, index }) => {
          const desc = eventDescription(event);
          const icon = EVENT_TYPE_ICON[event.type] ?? '\u{25CF}';
          return (
            <View style={styles.timelineRow}>
              <View style={styles.timelineTrack}>
                <View style={styles.timelineDot}>
                  <Text style={styles.timelineDotText}>{icon}</Text>
                </View>
                {index < allEvents.length - 1 && <View style={styles.timelineLine} />}
              </View>
              <View style={styles.timelineContent}>
                <Text style={styles.timelineTime}>{time(event.timestamp)}</Text>
                <Text style={styles.timelineDesc} numberOfLines={1}>{desc}</Text>
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
  container: { flex: 1, backgroundColor: BG },
  toolbar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    backgroundColor: CARD,
  },
  toolbarLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  toolbarIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderCurve: 'continuous',
    backgroundColor: '#3b82f618',
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolbarIconText: {
    fontSize: 16,
  },
  toolbarTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: TEXT_PRIMARY,
  },
  toolbarId: {
    fontSize: 11,
    color: TEXT_MUTED,
    fontFamily: 'monospace',
    fontWeight: '500',
    marginTop: 1,
  },
  terminalButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderCurve: 'continuous',
    backgroundColor: '#3b82f618',
    borderWidth: 1,
    borderColor: '#3b82f640',
    minHeight: 36,
  },
  terminalButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#3b82f6',
  },
  terminalButtonArrow: {
    fontSize: 14,
    color: '#3b82f6',
  },
  statsRow: {
    flexDirection: 'row',
    gap: 8,
    padding: 14,
  },
  statCard: {
    flex: 1,
    backgroundColor: CARD,
    borderRadius: 14,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: BORDER,
    borderTopWidth: 2,
    padding: 14,
    alignItems: 'center',
    gap: 2,
    boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
  },
  statIcon: {
    fontSize: 18,
    marginBottom: 4,
  },
  statValue: {
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -1,
  },
  statLabel: {
    fontSize: 10,
    color: TEXT_MUTED,
    fontWeight: '600',
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
    marginTop: 2,
  },
  fileChangesSection: {
    paddingHorizontal: 14,
    marginBottom: 8,
  },
  fileChangesList: {
    backgroundColor: CARD,
    borderRadius: 14,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: BORDER,
    overflow: 'hidden',
    marginTop: 6,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: TEXT_PRIMARY,
    letterSpacing: 0.2,
  },
  fileChangeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderLeftWidth: 3,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  changeTypeChip: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderCurve: 'continuous',
  },
  changeTypeText: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  },
  changePath: {
    fontSize: 12,
    fontFamily: 'monospace',
    flex: 1,
    color: TEXT_SECONDARY,
    fontWeight: '500',
  },
  timelineHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 14,
    marginBottom: 4,
  },
  timelineCount: {
    fontSize: 12,
    fontWeight: '600',
    color: TEXT_MUTED,
    backgroundColor: ELEVATED,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  timelineList: {
    paddingHorizontal: 14,
    paddingBottom: 20,
  },
  emptyState: {
    padding: 48,
    alignItems: 'center',
    backgroundColor: CARD,
    borderRadius: 14,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: BORDER,
    marginTop: 4,
  },
  emptyIcon: {
    fontSize: 32,
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 14,
    color: TEXT_SECONDARY,
    fontWeight: '600',
  },
  emptySubtext: {
    fontSize: 12,
    color: TEXT_MUTED,
    marginTop: 4,
  },
  timelineRow: {
    flexDirection: 'row',
    gap: 10,
  },
  timelineTrack: {
    width: 24,
    alignItems: 'center',
  },
  timelineDot: {
    width: 24,
    height: 24,
    borderRadius: 8,
    borderCurve: 'continuous',
    backgroundColor: ELEVATED,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timelineDotText: {
    fontSize: 10,
  },
  timelineLine: {
    width: 1.5,
    flex: 1,
    backgroundColor: BORDER,
    minHeight: 12,
  },
  timelineContent: {
    flex: 1,
    paddingVertical: 3,
    paddingBottom: 12,
  },
  timelineTime: {
    fontSize: 10,
    color: TEXT_MUTED,
    fontWeight: '500',
    fontVariant: ['tabular-nums'] as any,
  },
  timelineDesc: {
    fontSize: 13,
    color: TEXT_SECONDARY,
    lineHeight: 18,
  },
});
