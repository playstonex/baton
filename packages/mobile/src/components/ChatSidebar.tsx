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
import { useRecentStore } from '../stores/recent';
import { useConnectionStore } from '../stores/connection';
import { useThemeStore } from '../stores/theme';
import { useThemeColors } from '../hooks/useThemeColors';
import { Typography, Spacing, Colors, CornerRadius } from '../constants/theme';
import type { AgentProcess } from '@baton/shared';
import {
  buildProjectLabels,
  groupSessions,
  sessionMatchesQuery,
  type SessionGroupMode,
} from '@baton/shared/utils';
import { wsService } from '../services/websocket';
import { apiFetch } from '../services/api';
import { useSidebarPrefs } from '../stores/sidebar-prefs';
import { ScalePressable } from './Pressables';
import { SessionRow, type SidebarSessionItem } from './session-list/SessionRow';
import { SessionGroupHeader } from './session-list/SessionGroupHeader';

const GROUP_MODE_OPTIONS: { mode: SessionGroupMode; label: string }[] = [
  { mode: 'project', label: 'Project' },
  { mode: 'status', label: 'Status' },
  { mode: 'time', label: 'Time' },
];

interface ChatSidebarProps {
  currentSessionId?: string;
  onSelectSession: (sessionId: string) => void;
  onNewChat: () => void;
  onClose?: () => void;
  isWide?: boolean;
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
  const activeHost = useConnectionStore(
    (s) => s.hosts.find((h) => h.id === s.activeHostId) ?? null,
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
              status: s.status,
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

  const groupMode = useSidebarPrefs((s) => s.groupMode);
  const setGroupMode = useSidebarPrefs((s) => s.setGroupMode);
  const loadSidebarPrefs = useSidebarPrefs((s) => s.load);
  const [collapsedKeys, setCollapsedKeys] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    void loadSidebarPrefs();
  }, [loadSidebarPrefs]);

  // Live agents overlay the stored history: the live status and detail win,
  // the stored row supplies sessions the agent list no longer carries.
  const items = useMemo(() => {
    const byId = new Map<string, SidebarSessionItem>();
    for (const s of sessions) {
      byId.set(s.id, {
        id: s.id,
        type: s.type,
        projectPath: s.projectPath,
        status: s.status ?? 'stopped',
        title: s.title,
        lastActivity: s.lastActivity,
        live: false,
      });
    }
    for (const agent of agents) {
      if (agent.archivedAt) continue;
      const previous = byId.get(agent.id);
      const activityAt = Date.parse(agent.lastActivityAt ?? agent.startedAt);
      byId.set(agent.id, {
        id: agent.id,
        type: agent.type,
        projectPath: agent.projectPath,
        status: agent.status,
        title: agent.title ?? previous?.title,
        lastActivity: Number.isNaN(activityAt)
          ? (previous?.lastActivity ?? Date.now())
          : activityAt,
        detail: agent.stateDetail,
        live: agent.status !== 'stopped',
      });
    }
    return [...byId.values()];
  }, [sessions, agents]);

  const projectLabels = useMemo(
    () => buildProjectLabels(items.map((item) => item.projectPath)),
    [items],
  );

  const groups = useMemo(() => {
    const visible = items.filter((item) =>
      sessionMatchesQuery(item, searchQuery, projectLabels.get(item.projectPath) ?? ''),
    );
    return groupSessions(visible, groupMode, { projectLabels });
  }, [items, searchQuery, groupMode, projectLabels]);

  const toggleGroup = useCallback((key: string) => {
    setCollapsedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const handleModeChange = useCallback(
    (mode: SessionGroupMode) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setGroupMode(mode);
      setCollapsedKeys(new Set());
    },
    [setGroupMode],
  );

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
    (id: string) => {
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
          <ScalePressable
            onPress={onClose}
            hitSlop={8}
            style={[styles.iconBtn]}
            accessibilityLabel="Close sidebar"
          >
            <Ionicons name="chevron-back" size={22} color={c.textSecondary} />
          </ScalePressable>
        )}
      </View>

      {/* Action: + New Chat Button (ChatGPT style) */}
      <ScalePressable
        pressedScale={0.98}
        onPress={handleNewChatPress}
        style={[
          styles.newChatBtn,
          {
            backgroundColor: c.isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.05)',
            borderColor: c.cardBorder,
          },
        ]}
      >
        <Ionicons name="create-outline" size={18} color={c.textPrimary} />
        <Text style={[styles.newChatText, { color: c.textPrimary }]}>New Chat</Text>
      </ScalePressable>

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

      {/* Grouping */}
      <View style={styles.modeRow}>
        {GROUP_MODE_OPTIONS.map((option) => {
          const active = option.mode === groupMode;
          return (
            <Pressable
              key={option.mode}
              onPress={() => handleModeChange(option.mode)}
              style={[
                styles.modeChip,
                {
                  backgroundColor: active
                    ? c.isDark
                      ? 'rgba(255, 255, 255, 0.14)'
                      : 'rgba(0, 0, 0, 0.08)'
                    : 'transparent',
                },
              ]}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              <Text
                style={[styles.modeChipText, { color: active ? c.textPrimary : c.textTertiary }]}
              >
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Sessions List */}
      <ScrollView
        style={styles.listScroll}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {groups.map((group) => {
          const collapsed = collapsedKeys.has(group.key);
          return (
            <View key={group.key} style={styles.section}>
              <SessionGroupHeader
                title={group.title}
                count={group.items.length}
                bucket={group.bucket}
                collapsed={collapsed}
                onToggle={() => toggleGroup(group.key)}
              />
              {!collapsed &&
                group.items.map((item) => (
                  <SessionRow
                    key={item.id}
                    item={item}
                    projectLabel={projectLabels.get(item.projectPath) ?? ''}
                    selected={item.id === currentSessionId}
                    onPress={handleSelect}
                    onDelete={item.live ? undefined : handleDeleteSession}
                  />
                ))}
            </View>
          );
        })}

        {groups.length === 0 && (
          <View style={styles.emptyState}>
            <Ionicons name="chatbubbles-outline" size={28} color={c.textTertiary} />
            <Text style={[styles.emptyText, { color: c.textTertiary }]}>No chats found</Text>
          </View>
        )}
      </ScrollView>

      {/* Footer Navigation: Host status, Settings, Theme */}
      <View style={[styles.footer, { borderTopColor: c.separator }]}>
        {/* Active Server Card */}
        <ScalePressable
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            router.push('/connect');
            if (!isWide && onClose) onClose();
          }}
          style={[
            styles.hostCard,
            {
              backgroundColor: c.isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.04)',
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
              {activeHost
                ? activeHost.localHttpUrl || activeHost.relayUrl || 'Active Server'
                : 'Connect Server'}
            </Text>
            <Text style={[styles.hostStatus, { color: c.textTertiary }]}>
              {connected ? 'Connected' : 'Disconnected'}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={14} color={c.textTertiary} />
        </ScalePressable>

        {/* Action Row */}
        <View style={styles.footerActions}>
          <ScalePressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.push('/settings');
              if (!isWide && onClose) onClose();
            }}
            style={[styles.actionButton]}
          >
            <Ionicons name="settings-outline" size={18} color={c.textSecondary} />
            <Text style={[styles.actionButtonText, { color: c.textSecondary }]}>Settings</Text>
          </ScalePressable>

          <ScalePressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.push('/pipelines');
              if (!isWide && onClose) onClose();
            }}
            style={[styles.actionButton]}
          >
            <Ionicons name="git-network-outline" size={18} color={c.textSecondary} />
            <Text style={[styles.actionButtonText, { color: c.textSecondary }]}>Pipelines</Text>
          </ScalePressable>

          <ScalePressable onPress={toggleTheme} style={[styles.themeToggleBtn]} hitSlop={6}>
            <Ionicons
              name={c.isDark ? 'sunny-outline' : 'moon-outline'}
              size={18}
              color={c.textSecondary}
            />
          </ScalePressable>
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
  modeRow: {
    flexDirection: 'row',
    gap: 6,
    marginHorizontal: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  modeChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  modeChipText: {
    ...Typography.caption1,
    fontSize: 12,
    fontWeight: '600',
  },
  listScroll: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: Spacing.sm,
    paddingBottom: Spacing.md,
  },
  section: {
    marginBottom: Spacing.sm,
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
