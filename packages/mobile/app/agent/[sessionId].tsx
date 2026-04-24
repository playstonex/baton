import { StyleSheet } from 'react-native';
import { View, Text, FlatList } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Button, Card, Chip } from 'heroui-native';
import type { ParsedEvent } from '@baton/shared';
import { useEventsStore } from '../../src/stores/events';
import { wsService } from '../../src/services/websocket';

const CHANGE_CHIP_COLOR: Record<string, 'success' | 'accent' | 'danger'> = {
  create: 'success',
  modify: 'accent',
  delete: 'danger',
};

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

  const statusEvents = events.filter(
    (e) => e.type === 'status_change' || e.type === 'thinking' || e.type === 'error',
  );

  const allEvents = [...statusEvents, ...toolUses].sort((a, b) => a.timestamp - b.timestamp);

  const time = (ts: number) => new Date(ts).toLocaleTimeString();

  return (
    <View style={styles.container}>
      <View style={styles.toolbar}>
        <Text style={styles.toolbarTitle}>
          Agent <Text style={styles.toolbarId}>{sessionId?.slice(0, 8)}</Text>
        </Text>
        <Button variant="ghost" size="sm" onPress={() => router.push(`/terminal/${sessionId}`)}>
          Terminal →
        </Button>
      </View>

      <View style={styles.statsRow}>
        {[
          { label: 'Files', value: fileChanges.length, borderColor: '#3b82f6' },
          { label: 'Tools', value: toolUses.length, borderColor: '#a855f7' },
          { label: 'Events', value: events.length, borderColor: '#22c55e' },
        ].map((s) => (
          <Card key={s.label} style={{ flex: 1, borderTopWidth: 2, borderTopColor: s.borderColor }}>
            <Card.Body style={{ padding: 14, alignItems: 'center' }}>
              <Text style={{ fontSize: 24, fontWeight: '600', color: s.borderColor }}>{s.value}</Text>
              <Text style={styles.statLabel}>{s.label}</Text>
            </Card.Body>
          </Card>
        ))}
      </View>

      {fileChanges.length > 0 && (
        <View style={styles.fileChangesSection}>
          <Text style={styles.sectionTitle}>File Changes</Text>
          {fileChanges.slice(0, 10).map((e, i) =>
            e.type === 'file_change' ? (
              <View key={i} style={styles.fileChangeRow}>
                <Chip variant="soft" color={CHANGE_CHIP_COLOR[e.changeType] ?? 'default'} size="sm">
                  {e.changeType}
                </Chip>
                <Text style={styles.changePath} numberOfLines={1}>{e.path}</Text>
              </View>
            ) : null,
          )}
        </View>
      )}

      <Text style={[styles.sectionTitle, { paddingHorizontal: 14 }]}>Timeline</Text>
      <FlatList
        data={allEvents}
        keyExtractor={(_, i) => String(i)}
        contentContainerStyle={{ paddingHorizontal: 14 }}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>Waiting for events...</Text>
          </View>
        }
        renderItem={({ item: event }) => {
          const desc = eventDescription(event);
          return (
            <View style={styles.timelineRow}>
              <Text style={styles.timelineTime}>{time(event.timestamp)}</Text>
              <Text style={styles.timelineDesc} numberOfLines={1}>{desc}</Text>
            </View>
          );
        }}
      />
    </View>
  );
}

function eventDescription(event: ParsedEvent): string {
  switch (event.type) {
    case 'status_change': return `Status → ${event.status}`;
    case 'thinking': return 'Thinking...';
    case 'tool_use': return `${event.tool}${event.args?.filePath ? ` → ${event.args.filePath}` : ''}`;
    case 'file_change': return `${event.changeType} ${event.path}`;
    case 'command_exec': return `$ ${event.command}`;
    case 'error': return event.message.slice(0, 60);
    default: return '';
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0f' },
  toolbar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 14, borderBottomWidth: 1, borderBottomColor: '#1e1e26', backgroundColor: '#141419' },
  toolbarTitle: { fontSize: 14, fontWeight: '600', color: '#fff' },
  toolbarId: { color: '#6b7280', fontWeight: '400' },
  statsRow: { flexDirection: 'row', gap: 8, padding: 14 },
  statLabel: { fontSize: 10, color: '#6b7280', marginTop: 2 },
  fileChangesSection: { paddingHorizontal: 14, marginBottom: 8 },
  sectionTitle: { fontSize: 14, fontWeight: '600', color: '#fff', marginBottom: 6 },
  fileChangeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 5 },
  changePath: { fontSize: 12, fontFamily: 'monospace', flex: 1, color: '#9ca3af' },
  emptyState: { padding: 40, alignItems: 'center' },
  emptyText: { fontSize: 14, color: '#4b5563' },
  timelineRow: { flexDirection: 'row', gap: 8, paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: '#1e1e26' },
  timelineTime: { fontSize: 10, color: '#4b5563', width: 60 },
  timelineDesc: { fontSize: 12, color: '#d1d5db', flex: 1 },
});
