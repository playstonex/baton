import { View, Text, FlatList, TouchableOpacity } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect } from 'react';
import type { ParsedEvent } from '@flowwhips/shared';
import { useEventsStore } from '../../src/stores/events';
import { wsService } from '../../src/services/websocket';
import { CHANGE_COLORS } from '../../src/constants/colors';

export default function AgentDetailScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const router = useRouter();
  const { events, fileChanges, toolUses, addEvent, clearEvents } = useEventsStore();

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
    <View style={{ flex: 1, backgroundColor: '#fff' }}>
      {/* Toolbar */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 12, borderBottomWidth: 1, borderBottomColor: '#e5e7eb' }}>
        <Text style={{ fontSize: 14, fontWeight: '600' }}>
          Agent <Text style={{ color: '#6b7280', fontWeight: '400' }}>{sessionId?.slice(0, 8)}</Text>
        </Text>
        <TouchableOpacity onPress={() => router.push(`/terminal/${sessionId}`)}>
          <Text style={{ color: '#2563eb', fontSize: 13 }}>Terminal</Text>
        </TouchableOpacity>
      </View>

      {/* Stats */}
      <View style={{ flexDirection: 'row', gap: 8, padding: 12 }}>
        {[
          { label: 'Files', value: fileChanges.length, color: '#3b82f6' },
          { label: 'Tools', value: toolUses.length, color: '#8b5cf6' },
          { label: 'Events', value: events.length, color: '#22c55e' },
        ].map((s) => (
          <View key={s.label} style={{ flex: 1, padding: 12, borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 8, alignItems: 'center' }}>
            <Text style={{ fontSize: 22, fontWeight: '600', color: s.color }}>{s.value}</Text>
            <Text style={{ fontSize: 12, color: '#6b7280' }}>{s.label}</Text>
          </View>
        ))}
      </View>

      {/* File Changes */}
      {fileChanges.length > 0 && (
        <View style={{ paddingHorizontal: 12, marginBottom: 8 }}>
          <Text style={{ fontSize: 14, fontWeight: '600', marginBottom: 6 }}>File Changes</Text>
          {fileChanges.slice(0, 10).map((e, i) =>
            e.type === 'file_change' ? (
              <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 3 }}>
                <Text style={{ fontSize: 10, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 3, overflow: 'hidden', backgroundColor: CHANGE_COLORS[e.changeType]?.bg ?? '#f3f4f6', color: CHANGE_COLORS[e.changeType]?.text ?? '#666', fontWeight: '500' }}>
                  {e.changeType}
                </Text>
                <Text style={{ fontSize: 12, fontFamily: 'monospace', flex: 1 }} numberOfLines={1}>{e.path}</Text>
              </View>
            ) : null,
          )}
        </View>
      )}

      {/* Event Timeline */}
      <Text style={{ fontSize: 14, fontWeight: '600', paddingHorizontal: 12, marginBottom: 6 }}>Timeline</Text>
      <FlatList
        data={allEvents}
        keyExtractor={(_, i) => String(i)}
        contentContainerStyle={{ paddingHorizontal: 12 }}
        ListEmptyComponent={
          <View style={{ padding: 30, alignItems: 'center' }}>
            <Text style={{ color: '#9ca3af' }}>Waiting for events...</Text>
          </View>
        }
        renderItem={({ item: event }) => {
          const desc = eventDescription(event);
          return (
            <View style={{ flexDirection: 'row', gap: 8, paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: '#f3f4f6' }}>
              <Text style={{ fontSize: 10, color: '#9ca3af', width: 60 }}>{time(event.timestamp)}</Text>
              <Text style={{ fontSize: 12, color: '#374151', flex: 1 }} numberOfLines={1}>{desc}</Text>
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
