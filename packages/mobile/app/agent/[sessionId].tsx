import { View, Text, FlatList, Pressable } from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useEffect, useMemo } from 'react';
import type { ParsedEvent } from '@baton/shared';
import { useEventsStore } from '../../src/stores/events';
import { wsService } from '../../src/services/websocket';
import { useThemeColors } from '../../src/hooks/useThemeColors';
import { Typography, CornerRadius, Spacing, Colors } from '../../src/constants/theme';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  GlassCard,
  GlassStatCard,
  GlassButton,
  GlassSectionHeader,
} from '../../src/components/GlassKit';
import { BlurView } from 'expo-blur';

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
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (!sessionId) return;
    clearEvents();
    wsService.send({ type: 'control', action: 'attach_session', sessionId });

    const unsubEvent = wsService.on('parsed_event', (msg) => {
      if (msg.type === 'parsed_event' && msg.sessionId === sessionId) {
        addEvent(msg.event);
      }
    });

    const unsubEventHistory = wsService.on('event_history', (msg) => {
      if (msg.type === 'event_history' && msg.sessionId === sessionId) {
        for (const event of msg.events) {
          addEvent(event);
        }
      }
    });

    return () => {
      unsubEvent();
      unsubEventHistory();
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
    <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: headerHeight, paddingBottom: insets.bottom }}>

      {/* Glass toolbar */}
      <BlurView
        tint={c.isDark ? 'systemUltraThinMaterialDark' : 'systemUltraThinMaterialLight'}
        intensity={80}
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          paddingHorizontal: Spacing.lg,
          paddingVertical: Spacing.md,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm }}>
          <View style={{ width: 36, height: 36, borderRadius: CornerRadius.medium, alignItems: 'center', justifyContent: 'center', backgroundColor: c.accentBg }}>
            <Text style={{ fontSize: 16 }}>{'\u{1F916}'}</Text>
          </View>
          <View>
            <Text style={[Typography.headline, { color: c.textPrimary }]}>Agent Detail</Text>
            <Text style={[Typography.caption1, { color: c.textTertiary, fontFamily: 'monospace', fontWeight: '500' }]}>
              {sessionId?.slice(0, 8)}
            </Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.xs }}>
          <Pressable
            onPress={() => router.push(`/files/${sessionId}` as Href)}
            style={{ width: 36, height: 36, justifyContent: 'center', alignItems: 'center', borderRadius: CornerRadius.small }}
            hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
          >
            <Ionicons name="folder-outline" size={20} color={c.textSecondary} />
          </Pressable>
          <Pressable
            onPress={() => router.push(`/git/${sessionId}` as Href)}
            style={{ width: 36, height: 36, justifyContent: 'center', alignItems: 'center', borderRadius: CornerRadius.small }}
            hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
          >
            <Ionicons name="git-branch-outline" size={20} color={c.textSecondary} />
          </Pressable>
          <Pressable
            onPress={() => router.push(`/terminal/${sessionId}`)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: Spacing.xs,
              paddingHorizontal: Spacing.md,
              paddingVertical: Spacing.sm,
              borderRadius: CornerRadius.medium,
              minHeight: 36,
              backgroundColor: c.accentBg,
            }}
          >
            <Text style={[Typography.footnote, { color: Colors.primary[500], fontWeight: '600' }]}>Terminal</Text>
            <Text style={[Typography.footnote, { color: Colors.primary[500] }]}>{'\u{2192}'}</Text>
          </Pressable>
        </View>
      </BlurView>

      {/* Stats row */}
      <View style={{ flexDirection: 'row', gap: Spacing.sm, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md }}>
        <GlassStatCard c={c} value={fileChanges.length} label="Files Changed" icon="document-text-outline" color={Colors.primary[500]} />
        <GlassStatCard c={c} value={toolUses.length} label="Tool Calls" icon="construct-outline" color="#AF52DE" />
        <GlassStatCard c={c} value={events.length} label="Total Events" icon="flash-outline" color={Colors.success[400]} />
      </View>

      {/* File Changes */}
      {fileChanges.length > 0 && (
        <View style={{ paddingHorizontal: Spacing.lg, marginBottom: Spacing.sm }}>
          <GlassSectionHeader c={c} title="File Changes" />
          <GlassCard c={c} style={{ padding: 0 }}>
            {fileChanges.slice(0, 10).map((e, i) => {
              if (e.type !== 'file_change') return null;
              const colors = CHANGE_COLORS[e.changeType] ?? { bg: c.elevated, text: c.textSecondary, border: c.cardBorder };
              return (
                <View
                  key={i}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: Spacing.sm,
                    paddingVertical: Spacing.sm,
                    paddingHorizontal: Spacing.md,
                    borderLeftWidth: 3,
                    borderLeftColor: colors.border,
                    borderBottomWidth: i < Math.min(fileChanges.length, 10) - 1 ? 0 : 0,
                  }}
                >
                  <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: CornerRadius.small, backgroundColor: colors.bg }}>
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
          </GlassCard>
        </View>
      )}

      {/* Event Timeline */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm, paddingBottom: Spacing.xs }}>
        <Text style={[Typography.footnote, { color: c.textPrimary, fontWeight: '600' }]}>Event Timeline</Text>
        <View style={{ paddingHorizontal: Spacing.sm, paddingVertical: 2, borderRadius: CornerRadius.small, backgroundColor: c.subtle, minWidth: 24, alignItems: 'center' }}>
          <Text style={[Typography.caption2, { color: c.textTertiary, fontWeight: '600' }]}>{allEvents.length}</Text>
        </View>
      </View>

      <FlatList
        data={allEvents}
        keyExtractor={(_, i) => String(i)}
        contentContainerStyle={{ paddingHorizontal: Spacing.lg, paddingBottom: Spacing['3xl'], paddingTop: Spacing.xs }}
        ListEmptyComponent={
          <GlassCard c={c} style={{ alignItems: 'center', padding: Spacing['4xl'], marginTop: Spacing.xs }}>
            <Text style={[Typography.subhead, { color: c.textSecondary }]}>Waiting for events...</Text>
            <Text style={[Typography.caption1, { color: c.textTertiary, marginTop: Spacing.xs }]}>
              Events will appear as the agent runs
            </Text>
          </GlassCard>
        }
        renderItem={({ item: event, index }) => {
          const desc = eventDescription(event);
          const icon = EVENT_TYPE_ICON[event.type] ?? '\u{25CF}';
          return (
            <View style={{ flexDirection: 'row', gap: Spacing.sm }}>
              <View style={{ width: 24, alignItems: 'center' }}>
                <View style={{ width: 24, height: 24, borderRadius: CornerRadius.medium, alignItems: 'center', justifyContent: 'center', backgroundColor: c.subtle }}>
                  <Text style={{ fontSize: 10 }}>{icon}</Text>
                </View>
                {index < allEvents.length - 1 && <View style={{ width: 1.5, flex: 1, minHeight: Spacing.md, backgroundColor: c.separator }} />}
              </View>
              <View style={{ flex: 1, paddingVertical: 3, paddingBottom: Spacing.md }}>
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
