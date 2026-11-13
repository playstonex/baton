import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  TextInput,
  Alert,
  Platform,
} from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAgentStore } from '../stores/agents';
import { useRecentStore, type RecentSession } from '../stores/recent';
import { useConnectionStore } from '../stores/connection';
import { useThemeStore } from '../stores/theme';
import { useThemeColors } from '../hooks/useThemeColors';
import { Typography, Spacing, Colors, CornerRadius } from '../constants/theme';
import type { AgentProcess } from '@baton/shared';
import { wsService } from '../services/websocket';
import { apiFetch } from '../services/api';

const AGENT_META: Record<string, { label: string; icon: string; color: string }> = {
  'claude-code': { label: 'Claude Code', icon: 'sparkles', color: '#D97757' },
  codex: { label: 'Codex', icon: 'terminal', color: '#10A37F' },
  opencode: { label: 'OpenCode', icon: 'code-slash', color: '#6366F1' },
  kiro: { label: 'Kiro', icon: 'rocket', color: '#FF9900' },
  antigravity: { label: 'Antigravity', icon: 'planet-outline', color: '#4285F4' },
  pi: { label: 'Pi', icon: 'flask-outline', color: '#8B5CF6' },
  acp: { label: 'ACP', icon: 'hardware-chip-outline', color: '#8B5CF6' },
};

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'Just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

interface ChatSidebarProps {
  currentSessionId?: string;
  onSelectSession: (sessionId: string) => void;
  onNewChat: () => void;
  onClose?: () => void;
  isWide?: boolean;
}

interface HistoryGroup {
  title: string;
  items: RecentSession[];
}

export function ChatSidebar({
  currentSessionId,
  onSelectSession,
  onNewChat,
  onClose,
  isWide = false,
}: ChatSidebarProps) {
  const router = useRouter();
  const c = useThemeColors();
  const insets = useSafeAreaInsets();
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);

  const agents = useAgentStore((s) => s.agents);
  const setAgents = useAgentStore((s) => s.setAgents);
  const updateAgentStatus = useAgentStore((s) => s.updateAgentStatus);
  const { sessions, removeSession, addSessions } = useRecentStore();
  const connected = useConnectionStore((s) => s.connected);
  const activeHost = useConnectionStore((s) =>
    s.hosts.find((h) => h.id === s.activeHostId) ?? null,
  );

  const [searchQuery, setSearchQuery] = useState('');

  // Fetch agents & sessions periodically / on mount
  useEffect(() => {
    apiFetch<AgentProcess[]>('/api/agents')
      .then((list) => setAgents(list))
      .catch(() => {});

    apiFetch<{ sessions: import('@baton/shared').SessionSummary[] }>('/api/sessions?limit=50')
      .then((data) => {
        if (data.sessions?.length) {
          addSessions(
            data.sessions.map((s) => ({
              id: s.id,
              type: s.type,
              projectPath: s.projectPath,
              lastActivity: s.updatedAt ? Date.parse(s.updatedAt) : Date.now(),
              title: s.title,
              eventCount: s.eventCount,
            })),
          );
        }
      })
      .catch(() => {});

    const unsubList = wsService.on('agent_list', (msg: any) => {
      if (msg.type === 'agent_list' && Array.isArray(msg.agents)) {
        setAgents(
          msg.agents.map((agent: any) => ({
            id: agent.id,
            type: agent.type as AgentProcess['type'],
            projectPath: agent.projectPath,
            status: agent.status as AgentProcess['status'],
            startedAt: agent.startedAt ?? '',
            mode: agent.mode,
            title: agent.title,
            lastActivityAt: agent.lastActivityAt,
            stateDetail: agent.detail,
          })),
        );
      }
    });

    const unsubStatus = wsService.on('status_update', (msg: any) => {
      if (msg.type === 'status_update' && 'status' in msg) {
        updateAgentStatus(msg.sessionId, msg.status as AgentProcess['status'], msg.detail);
      }
    });

    return () => {
      unsubList();
      unsubStatus();
    };
  }, [setAgents, updateAgentStatus, addSessions]);

  // Live active agents
  const liveAgents = useMemo(
    () => agents.filter((a) => a.status !== 'stopped'),
    [agents],
  );

  const activeSessionIds = useMemo(() => new Set(liveAgents.map((a) => a.id)), [liveAgents]);

  // History sessions grouped ChatGPT-style (Today, Yesterday, Previous 7 Days, Older)
  const historyGroups = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const filtered = sessions.filter((s) => {
      if (activeSessionIds.has(s.id)) return false;
      if (!q) return true;
      const titleMatch = (s.title ?? '').toLowerCase().includes(q);
      const pathMatch = (s.projectPath ?? '').toLowerCase().includes(q);
      const typeMatch = (s.type ?? '').toLowerCase().includes(q);
      return titleMatch || pathMatch || typeMatch;
    });

    const now = Date.now();
    const oneDay = 24 * 60 * 60 * 1000;
    const today: RecentSession[] = [];
    const yesterday: RecentSession[] = [];
    const last7Days: RecentSession[] = [];
    const older: RecentSession[] = [];

    for (const s of filtered) {
      const age = now - s.lastActivity;
      if (age < oneDay) {
        today.push(s);
      } else if (age < 2 * oneDay) {
        yesterday.push(s);
      } else if (age < 7 * oneDay) {
        last7Days.push(s);
      } else {
        older.push(s);
      }
    }

    const groups: HistoryGroup[] = [];
    if (today.length > 0) groups.push({ title: 'Today', items: today });
    if (yesterday.length > 0) groups.push({ title: 'Yesterday', items: yesterday });
    if (last7Days.length > 0) groups.push({ title: 'Previous 7 Days', items: last7Days });
    if (older.length > 0) groups.push({ title: 'Older', items: older });
    return groups;
  }, [sessions, activeSessionIds, searchQuery]);

  const handleSelect = useCallback(
    (sessionId: string) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      onSelectSession(sessionId);
      if (!isWide && onClose) {
        onClose();
      }
    },
    [onSelectSession, isWide, onClose],
  );

  const handleNewChatPress = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onNewChat();
    if (!isWide && onClose) {
      onClose();
    }
  }, [onNewChat, isWide, onClose]);

  const handleDeleteSession = useCallback(
    (id: string, e: any) => {
      e.stopPropagation?.();
      Alert.alert('Remove Chat', 'Remove this chat session from history?', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => removeSession(id),
        },
      ]);
    },
    [removeSession],
  );

  const toggleTheme = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
  }, [theme, setTheme]);

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: c.secondaryBg,
          paddingLeft: insets.left + Spacing.sm,
          paddingTop: insets.top + Spacing.xs,
          paddingBottom: insets.bottom + Spacing.xs,
        },
      ]}
    >
      {/* Top Header: Brand + Controls */}
      <View style={styles.header}>
        <View style={styles.brandRow}>
          <View style={[styles.brandIcon, { backgroundColor: c.accentBg }]}>
            <Ionicons name="flash" size={14} color="#ffffff" />
          </View>
          <Text style={[styles.brandTitle, { color: c.textPrimary }]}>Baton</Text>
          <View
            style={[
              styles.connectionIndicator,
              { backgroundColor: connected ? Colors.success[500] : Colors.warning[500] },
            ]}
          />
        </View>

        {!isWide && onClose && (
          <Pressable
            onPress={onClose}
            hitSlop={8}
            style={({ pressed }) => [styles.iconBtn, { opacity: pressed ? 0.6 : 1 }]}
            accessibilityLabel="Close sidebar"
          >
            <Ionicons name="chevron-back" size={22} color={c.textSecondary} />
          </Pressable>
        )}
      </View>

      {/* Action: + New Chat Button (ChatGPT style) */}
      <Pressable
        onPress={handleNewChatPress}
        style={({ pressed }) => [
          styles.newChatBtn,
          {
            backgroundColor: c.isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.05)',
            borderColor: c.cardBorder,
            opacity: pressed ? 0.8 : 1,
            transform: [{ scale: pressed ? 0.98 : 1 }],
          },
        ]}
      >
        <Ionicons name="create-outline" size={18} color={c.textPrimary} />
        <Text style={[styles.newChatText, { color: c.textPrimary }]}>New Chat</Text>
      </Pressable>

      {/* Search Bar */}
      <View
        style={[
          styles.searchBox,
          {
            backgroundColor: c.isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.04)',
            borderColor: c.cardBorder,
          },
        ]}
      >
        <Ionicons name="search-outline" size={15} color={c.textTertiary} />
        <TextInput
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Search chats..."
          placeholderTextColor={c.textTertiary}
          style={[styles.searchInput, { color: c.textPrimary }]}
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
        />
        {searchQuery.length > 0 && Platform.OS !== 'ios' && (
          <Pressable onPress={() => setSearchQuery('')}>
            <Ionicons name="close-circle" size={14} color={c.textTertiary} />
          </Pressable>
        )}
      </View>

      {/* Sessions List */}
      <ScrollView
        style={styles.listScroll}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Active live agents (if any) */}
        {liveAgents.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionHeader, { color: c.textTertiary }]}>ACTIVE NOW</Text>
            {liveAgents.map((agent) => {
              const meta = AGENT_META[agent.type] ?? {
                label: agent.type,
                icon: 'cube-outline',
                color: Colors.primary[500],
              };
              const isSelected = agent.id === currentSessionId;
              const title =
                agent.title ||
                (agent.projectPath ? agent.projectPath.split('/').pop() : agent.id.slice(0, 8));

              return (
                <Pressable
                  key={agent.id}
                  onPress={() => handleSelect(agent.id)}
                  style={({ pressed }) => [
                    styles.sessionRow,
                    isSelected && [
                      styles.sessionRowActive,
                      {
                        backgroundColor: c.isDark
                          ? 'rgba(255, 255, 255, 0.12)'
                          : 'rgba(0, 0, 0, 0.07)',
                      },
                    ],
                    { opacity: pressed ? 0.7 : 1 },
                  ]}
                >
                  <View style={[styles.agentBadge, { backgroundColor: meta.color + '22' }]}>
                    <Ionicons name={meta.icon as any} size={14} color={meta.color} />
                  </View>
                  <View style={styles.sessionInfo}>
                    <Text
                      style={[
                        styles.sessionTitle,
                        { color: isSelected ? c.textPrimary : c.textSecondary },
                      ]}
                      numberOfLines={1}
                    >
                      {title}
                    </Text>
                    <View style={styles.liveMetaRow}>
                      <View style={styles.liveDot} />
                      <Text style={[styles.sessionSubtitle, { color: Colors.primary[400] }]}>
                        {agent.status}
                      </Text>
                    </View>
                  </View>
                </Pressable>
              );
            })}
          </View>
        )}

        {/* History Groups */}
        {historyGroups.map((group) => (
          <View key={group.title} style={styles.section}>
            <Text style={[styles.sectionHeader, { color: c.textTertiary }]}>{group.title}</Text>
            {group.items.map((session) => {
              const meta = AGENT_META[session.type] ?? {
                label: session.type,
                icon: 'chatbubble-outline',
                color: Colors.surface[400],
              };
              const isSelected = session.id === currentSessionId;
              const title =
                session.title ||
                (session.projectPath
                  ? session.projectPath.split('/').pop()
                  : session.id.slice(0, 8));

              return (
                <Pressable
                  key={session.id}
                  onPress={() => handleSelect(session.id)}
                  style={({ pressed }) => [
                    styles.sessionRow,
                    isSelected && [
                      styles.sessionRowActive,
                      {
                        backgroundColor: c.isDark
                          ? 'rgba(255, 255, 255, 0.12)'
                          : 'rgba(0, 0, 0, 0.07)',
                      },
                    ],
                    { opacity: pressed ? 0.7 : 1 },
                  ]}
                >
                  <View style={[styles.agentBadge, { backgroundColor: meta.color + '18' }]}>
                    <Ionicons name={meta.icon as any} size={13} color={meta.color} />
                  </View>
                  <View style={styles.sessionInfo}>
                    <Text
                      style={[
                        styles.sessionTitle,
                        { color: isSelected ? c.textPrimary : c.textSecondary },
                      ]}
                      numberOfLines={1}
                    >
                      {title}
                    </Text>
                    <Text style={[styles.sessionSubtitle, { color: c.textTertiary }]}>
                      {formatRelativeTime(session.lastActivity)}
                    </Text>
                  </View>
                  <Pressable
                    onPress={(e) => handleDeleteSession(session.id, e)}
                    hitSlop={8}
                    style={styles.deleteBtn}
                  >
                    <Ionicons name="trash-outline" size={13} color={c.textTertiary} />
                  </Pressable>
                </Pressable>
              );
            })}
          </View>
        ))}

        {liveAgents.length === 0 && historyGroups.length === 0 && (
          <View style={styles.emptyState}>
            <Ionicons name="chatbubbles-outline" size={28} color={c.textTertiary} />
            <Text style={[styles.emptyText, { color: c.textTertiary }]}>No chats found</Text>
          </View>
        )}
      </ScrollView>

      {/* Footer Navigation: Host status, Settings, Theme */}
      <View style={[styles.footer, { borderTopColor: c.separator }]}>
        {/* Active Server Card */}
        <Pressable
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            router.push('/connect');
            if (!isWide && onClose) onClose();
          }}
          style={({ pressed }) => [
            styles.hostCard,
            {
              backgroundColor: c.isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.04)',
              opacity: pressed ? 0.7 : 1,
            },
          ]}
        >
          <View
            style={[
              styles.hostDot,
              { backgroundColor: connected ? Colors.success[500] : Colors.warning[500] },
            ]}
          />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[styles.hostName, { color: c.textPrimary }]} numberOfLines={1}>
              {activeHost ? activeHost.localHttpUrl || activeHost.relayUrl || 'Active Server' : 'Connect Server'}
            </Text>
            <Text style={[styles.hostStatus, { color: c.textTertiary }]}>
              {connected ? 'Connected' : 'Disconnected'}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={14} color={c.textTertiary} />
        </Pressable>

        {/* Action Row */}
        <View style={styles.footerActions}>
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.push('/(tabs)/settings' as any);
              if (!isWide && onClose) onClose();
            }}
            style={({ pressed }) => [styles.actionButton, { opacity: pressed ? 0.6 : 1 }]}
          >
            <Ionicons name="settings-outline" size={18} color={c.textSecondary} />
            <Text style={[styles.actionButtonText, { color: c.textSecondary }]}>Settings</Text>
          </Pressable>

          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.push('/(tabs)/pipelines' as any);
              if (!isWide && onClose) onClose();
            }}
            style={({ pressed }) => [styles.actionButton, { opacity: pressed ? 0.6 : 1 }]}
          >
            <Ionicons name="git-network-outline" size={18} color={c.textSecondary} />
            <Text style={[styles.actionButtonText, { color: c.textSecondary }]}>Pipelines</Text>
          </Pressable>

          <Pressable
            onPress={toggleTheme}
            style={({ pressed }) => [styles.themeToggleBtn, { opacity: pressed ? 0.6 : 1 }]}
            hitSlop={6}
          >
            <Ionicons
              name={c.isDark ? 'sunny-outline' : 'moon-outline'}
              size={18}
              color={c.textSecondary}
            />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingRight: Spacing.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.sm,
    marginBottom: Spacing.sm,
    height: 40,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  brandIcon: {
    width: 24,
    height: 24,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandTitle: {
    ...Typography.headline,
    fontSize: 17,
    fontWeight: '700',
  },
  connectionIndicator: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  iconBtn: {
    padding: 4,
    borderRadius: 8,
  },
  newChatBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: Spacing.sm,
    marginBottom: Spacing.xs + 4,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: CornerRadius.medium,
    borderWidth: StyleSheet.hairlineWidth,
  },
  newChatText: {
    ...Typography.body,
    fontSize: 15,
    fontWeight: '600',
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: Spacing.sm,
    marginBottom: Spacing.sm,
    paddingHorizontal: 10,
    height: 36,
    borderRadius: CornerRadius.small,
    borderWidth: StyleSheet.hairlineWidth,
  },
  searchInput: {
    flex: 1,
    ...Typography.subhead,
    fontSize: 14,
    padding: 0,
  },
  listScroll: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: Spacing.sm,
    paddingBottom: Spacing.md,
  },
  section: {
    marginBottom: Spacing.md,
  },
  sectionHeader: {
    ...Typography.caption2,
    fontWeight: '600',
    letterSpacing: 0.5,
    marginBottom: Spacing.xs,
    paddingLeft: Spacing.xs,
  },
  sessionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: CornerRadius.medium,
    marginBottom: 2,
    gap: 10,
  },
  sessionRowActive: {
    borderRadius: CornerRadius.medium,
  },
  agentBadge: {
    width: 26,
    height: 26,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sessionInfo: {
    flex: 1,
    minWidth: 0,
  },
  sessionTitle: {
    ...Typography.subhead,
    fontSize: 14,
    fontWeight: '500',
  },
  sessionSubtitle: {
    ...Typography.caption2,
    fontSize: 11,
    marginTop: 1,
  },
  liveMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 1,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.primary[500],
  },
  deleteBtn: {
    padding: 4,
    opacity: 0.6,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
    gap: 8,
  },
  emptyText: {
    ...Typography.caption1,
    fontSize: 13,
  },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: Spacing.sm,
    paddingHorizontal: Spacing.sm,
    gap: Spacing.sm,
  },
  hostCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: CornerRadius.medium,
    gap: 8,
  },
  hostDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  hostName: {
    ...Typography.caption1,
    fontSize: 12,
    fontWeight: '600',
  },
  hostStatus: {
    ...Typography.caption2,
    fontSize: 10,
  },
  footerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: Spacing.xs,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: CornerRadius.small,
  },
  actionButtonText: {
    ...Typography.subhead,
    fontSize: 13,
    fontWeight: '500',
  },
  themeToggleBtn: {
    padding: 6,
    borderRadius: CornerRadius.small,
  },
});
