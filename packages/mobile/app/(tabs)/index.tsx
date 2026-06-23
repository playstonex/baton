import { Alert, FlatList, Modal, Pressable, TextInput, View, Text, StyleSheet } from 'react-native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useFocusEffect, type Href } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Spinner } from 'heroui-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import type { AgentProcess, AgentType } from '@baton/shared';
import { apiFetch } from '../../src/services/api';
import { wsService } from '../../src/services/websocket';
import { useAgentStore } from '../../src/stores/agents';
import { useRecentStore } from '../../src/stores/recent';
import type { RecentSession } from '../../src/stores/recent';
import { useConnectionStore } from '../../src/stores/connection';
import { useLayoutStore } from '../../src/stores/layout';
import { useThemeColors } from '../../src/hooks/useThemeColors';
import {
  GlassCard,
  GlassSectionHeader,
  GlassStatCard,
  GlassButton,
  GlassSearchBar,
  GlassPill,
  GlassDivider,
} from '../../src/components/GlassKit';
import { Typography, Spacing, Glass, Colors, STATUS_COLORS } from '../../src/constants/theme';
import { DirectoryPicker } from '../../src/components/DirectoryPicker';
import { ResourceMonitor } from '../../src/components/ResourceMonitor';

const AGENT_OPTIONS: {
  type: AgentType;
  label: string;
  desc: string;
  icon: string;
  color: string;
}[] = [
  {
    type: 'claude-code',
    label: 'Claude Code',
    desc: 'Deep code work',
    icon: 'sparkles',
    color: '#D97757',
  },
  { type: 'codex', label: 'Codex', desc: 'Fast execution', icon: 'terminal', color: '#10A37F' },
  { type: 'opencode', label: 'OpenCode', desc: 'Open stack', icon: 'code-slash', color: '#6366F1' },
  {
    type: 'kiro-cli',
    label: 'Kiro CLI',
    desc: 'Amazon Kiro agent',
    icon: 'rocket',
    color: '#FF9900',
  },
  {
    type: 'kiro-cli-acp',
    label: 'Kiro ACP',
    desc: 'Structured ACP mode',
    icon: 'rocket',
    color: '#FF9900',
  },
];

function formatTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'Just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function getFilteredSessions(sessions: RecentSession[], pinnedIds: string[], query: string) {
  const filtered = query
    ? sessions.filter(
        (s) =>
          s.projectPath.toLowerCase().includes(query.toLowerCase()) ||
          s.type.toLowerCase().includes(query.toLowerCase()),
      )
    : sessions;
  const pinned: RecentSession[] = [];
  const unpinned: RecentSession[] = [];
  filtered.forEach((s) => {
    if (pinnedIds.includes(s.id)) pinned.push(s);
    else unpinned.push(s);
  });
  pinned.sort((a, b) => b.lastActivity - a.lastActivity);
  unpinned.sort((a, b) => b.lastActivity - a.lastActivity);
  return { pinned, unpinned };
}

function getGroupedSessions(sessions: RecentSession[], pinnedIds: string[], query: string) {
  const { pinned, unpinned } = getFilteredSessions(sessions, pinnedIds, query);
  const groups = new Map<string, RecentSession[]>();
  for (const s of unpinned) {
    const project = s.projectPath.split('/').pop() || s.projectPath;
    const list = groups.get(project) ?? [];
    list.push(s);
    groups.set(project, list);
  }
  const sorted = [...groups.entries()]
    .map(([project, list]) => ({
      project,
      sessions: list.sort((a, b) => b.lastActivity - a.lastActivity),
    }))
    .sort((a, b) => b.sessions[0].lastActivity - a.sessions[0].lastActivity);
  return { pinned, groups: sorted };
}

export default function DashboardScreen() {
  const router = useRouter();
  const agents = useAgentStore((s) => s.agents);
  const setAgents = useAgentStore((s) => s.setAgents);
  const updateAgentStatus = useAgentStore((s) => s.updateAgentStatus);
  const addAgent = useAgentStore((s) => s.addAgent);
  const removeAgent = useAgentStore((s) => s.removeAgent);
  const connected = useConnectionStore((s) => s.connected);
  const { sessions, addSession, removeSession } = useRecentStore();
  const [projectPath, setProjectPath] = useState('');
  const [agentType, setAgentType] = useState<AgentType>('claude-code');
  const [chatMode, setChatMode] = useState<'chat' | 'terminal'>('chat');
  const [loading, setLoading] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [pinnedIds, setPinnedIds] = useState<string[]>([]);
  const [showSearch, setShowSearch] = useState(false);
  const c = useThemeColors();
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const tabBarHeight = useLayoutStore((s) => s.tabBarHeight);

  const fetchAgents = useCallback(async () => {
    try {
      const list = await apiFetch<AgentProcess[]>('/api/agents');
      setAgents(list);
      for (const agent of list) {
        addSession({
          id: agent.id,
          type: agent.type,
          projectPath: agent.projectPath,
          lastActivity: Date.now(),
        });
      }
    } catch {
      // offline
    }
  }, [setAgents, addSession]);

  useEffect(() => {
    fetchAgents();
    const unsubList = wsService.on('agent_list', (msg: any) => {
      if (msg.type === 'agent_list') {
        setAgents(
          msg.agents.map((agent: any) => ({
            id: agent.id,
            type: agent.type as AgentProcess['type'],
            projectPath: agent.projectPath,
            status: agent.status as AgentProcess['status'],
            startedAt: '',
          })),
        );
      }
    });
    const unsubStatus = wsService.on('status_update', (msg: any) => {
      if (msg.type === 'status_update' && 'status' in msg) {
        updateAgentStatus(msg.sessionId, msg.status as AgentProcess['status']);
      }
    });
    return () => {
      unsubList();
      unsubStatus();
    };
  }, [fetchAgents, setAgents, updateAgentStatus]);

  // Refresh the agent list whenever this tab gains focus. Covers the
  // return-from-background resume case: after a reconnect the local store may
  // be stale, and the WS agent_list push only fires on connect.
  useFocusEffect(
    useCallback(() => {
      fetchAgents();
    }, [fetchAgents]),
  );

  const runningCount = useMemo(() => agents.filter((a) => a.status !== 'stopped').length, [agents]);
  const activeSessionIds = useMemo(() => new Set(agents.map((a) => a.id)), [agents]);

  const recentSessionList = useMemo(
    () => sessions.filter((s) => !activeSessionIds.has(s.id)),
    [sessions, activeSessionIds],
  );

  const { pinned, groups } = useMemo(
    () => getGroupedSessions(recentSessionList, pinnedIds, searchQuery),
    [recentSessionList, pinnedIds, searchQuery],
  );

  const selectedAgent = AGENT_OPTIONS.find((o) => o.type === agentType) ?? AGENT_OPTIONS[0];

  function togglePin(id: string) {
    setPinnedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function deleteSession(session: RecentSession) {
    const label = AGENT_OPTIONS.find((o) => o.type === session.type)?.label ?? session.type;
    Alert.alert(
      'Remove Session',
      `Remove "${label}" from history?${session.projectPath ? `\n\n${session.projectPath}` : ''}`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            removeSession(session.id);
            setPinnedIds((prev) => prev.filter((x) => x !== session.id));
          },
        },
      ],
    );
  }

  async function startAgent() {
    if (!projectPath.trim()) return;
    setLoading(true);
    try {
      const data = await apiFetch<{ sessionId: string }>('/api/agents/start', {
        method: 'POST',
        body: JSON.stringify({
          agentType,
          projectPath: projectPath.trim(),
          // Codex must run via the SDK adapter (codex app-server / JSON-RPC).
          // The default PTY path spawns the interactive `codex` TUI, whose render
          // frames flood the daemon and freeze the event loop. Chat mode requires SDK.
          mode: agentType === 'codex' ? 'sdk' : 'pty',
        }),
      });
      addAgent({
        id: data.sessionId,
        type: agentType,
        projectPath: projectPath.trim(),
        status: 'running',
        startedAt: new Date().toISOString(),
      });
      addSession({
        id: data.sessionId,
        type: agentType,
        projectPath: projectPath.trim(),
        lastActivity: Date.now(),
        // codex chat sessions remember their mode so re-entry reopens the chat
        // view instead of falling back to the terminal.
        chatMode: agentType === 'codex' ? chatMode : undefined,
      });
      const route = agentType === 'codex' && chatMode === 'chat' ? 'chat' : 'terminal';
      router.push(`/${route}/${data.sessionId}` as Href);
    } catch (err) {
      Alert.alert('Error', `Failed: ${err}`);
    } finally {
      setLoading(false);
    }
  }

  async function stopAgent(id: string) {
    try {
      await apiFetch(`/api/agents/${id}/stop`, { method: 'POST' });
      removeAgent(id);
    } catch {
      // ignore
    }
  }

  /**
   * Open a session, routing to chat vs terminal based on the stored mode.
   * codex sessions created in chat mode reopen in chat; everything else
   * (and codex terminal sessions) opens in the terminal.
   */
  function openSession(sessionId: string, agentType: AgentType) {
    const stored = sessions.find((s) => s.id === sessionId);
    const isChat = agentType === 'codex' && stored?.chatMode === 'chat';
    const route = isChat ? 'chat' : 'terminal';
    addSession({
      id: sessionId,
      type: agentType,
      projectPath: stored?.projectPath ?? '',
      lastActivity: Date.now(),
      chatMode: stored?.chatMode,
    });
    router.push(`/${route}/${sessionId}` as Href);
  }

  const renderAgentRow = (agent: AgentProcess) => {
    const statusColor = STATUS_COLORS?.[agent.status] ?? '#a8a29e';
    const isStopped = agent.status === 'stopped';
    const label = AGENT_OPTIONS.find((o) => o.type === agent.type)?.label ?? agent.type;
    return (
      <Pressable
        key={agent.id}
        onPress={() => {
          if (!isStopped) {
            openSession(agent.id, agent.type);
          }
        }}
        style={({ pressed }) => [
          { opacity: isStopped ? 0.5 : pressed ? 0.9 : 1 },
          { marginBottom: Spacing.sm },
        ]}
      >
        <GlassCard c={c} blurIntensity={Glass.blur.card - 10}>
          <View style={styles.agentRow}>
            <View style={styles.agentLeft}>
              <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
              <View style={{ flex: 1 }}>
                <Text style={[Typography.subhead, { color: c.textPrimary, fontWeight: '600' }]}>
                  {label}
                </Text>
                <Text
                  style={[Typography.caption1, { color: c.textTertiary, fontFamily: 'Menlo' }]}
                  numberOfLines={1}
                >
                  {agent.projectPath}
                </Text>
              </View>
            </View>
            <View style={styles.agentRight}>
              <Text
                style={[
                  Typography.caption2,
                  { color: statusColor, fontWeight: '600', textTransform: 'capitalize' },
                ]}
              >
                {agent.status.replace('_', ' ')}
              </Text>
              {!isStopped && (
                <Pressable
                  onPress={() => stopAgent(agent.id)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Text
                    style={[Typography.subhead, { color: Colors.danger[400], fontWeight: '600' }]}
                  >
                    Stop
                  </Text>
                </Pressable>
              )}
            </View>
          </View>
        </GlassCard>
      </Pressable>
    );
  };

  const renderSessionRow = (session: RecentSession, isPinned: boolean) => {
    const agentOption = AGENT_OPTIONS.find((o) => o.type === session.type);
    return (
      <Pressable
        key={session.id}
        onPress={() => openSession(session.id, session.type)}
        style={({ pressed }) => [{ opacity: pressed ? 0.85 : 1 }, { marginBottom: Spacing.xs }]}
      >
        <GlassCard c={c} blurIntensity={Glass.blur.card - 15}>
          <View style={styles.sessionRow}>
            <View style={{ flex: 1 }}>
              <View style={styles.sessionTop}>
                <Text
                  style={[Typography.subhead, { color: c.textPrimary, fontWeight: '600', flex: 1 }]}
                  numberOfLines={1}
                >
                  {agentOption?.label ?? session.type}
                </Text>
                <Pressable
                  onPress={() => togglePin(session.id)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons
                    name={isPinned ? 'pin' : 'pin-outline'}
                    size={14}
                    color={isPinned ? Colors.primary[500] : c.textTertiary}
                  />
                </Pressable>
                <Pressable
                  onPress={() => deleteSession(session)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  style={{ marginLeft: Spacing.sm }}
                >
                  <Ionicons name="trash-outline" size={14} color={Colors.danger[400]} />
                </Pressable>
              </View>
              <Text
                style={[Typography.caption1, { color: c.textTertiary, marginTop: 2 }]}
                numberOfLines={1}
              >
                {session.projectPath || 'terminal session'}
              </Text>
            </View>
            <Text style={[Typography.caption2, { color: c.textTertiary }]}>
              {formatTime(session.lastActivity)}
            </Text>
          </View>
        </GlassCard>
      </Pressable>
    );
  };

  return (
    <View style={[styles.root, { backgroundColor: c.bg }]}>
      <FlatList
        data={agents}
        keyExtractor={(item) => item.id}
        style={styles.list}
        contentContainerStyle={[
          styles.listContent,
          {
            paddingTop: headerHeight + Spacing.lg,
            paddingBottom: insets.bottom + tabBarHeight + Spacing.lg,
          },
        ]}
        ListHeaderComponent={
          <View style={{ gap: Spacing.md }}>
            {/* Header */}
            <View style={styles.headerRow}>
              <Text style={[Typography.largeTitle, { color: c.textPrimary, fontWeight: '700' }]}>
                Baton
              </Text>
              <View style={styles.headerRight}>
                <Pressable
                  onPress={() => setShowSearch(!showSearch)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons
                    name={showSearch ? 'close' : 'search'}
                    size={22}
                    color={showSearch ? Colors.primary[500] : c.textSecondary}
                  />
                </Pressable>
                <View
                  style={[
                    styles.connectionBadge,
                    { backgroundColor: connected ? c.successBg : c.dangerBg },
                  ]}
                >
                  <View
                    style={[
                      styles.connectionDot,
                      { backgroundColor: connected ? Colors.success[400] : Colors.danger[400] },
                    ]}
                  />
                  <Text
                    style={[
                      Typography.caption1,
                      {
                        color: connected ? Colors.success[400] : Colors.danger[400],
                        fontWeight: '600',
                      },
                    ]}
                  >
                    {connected ? 'Online' : 'Offline'}
                  </Text>
                </View>
              </View>
            </View>

            {/* Search bar */}
            {showSearch && (
              <GlassSearchBar
                c={c}
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder="Search sessions by project or agent"
              />
            )}

            {/* Stats row */}
            <View style={styles.statsRow}>
              <GlassStatCard
                c={c}
                value={runningCount}
                label="Running"
                icon="play"
                color={Colors.success[400]}
              />
              <GlassStatCard c={c} value={agents.length} label="Total agents" icon="grid" />
              <GlassStatCard c={c} value={recentSessionList.length} label="History" icon="time" />
            </View>

            {/* Resource monitor */}
            <GlassCard c={c} blurIntensity={Glass.blur.card - 10}>
              <ResourceMonitor connected={connected} />
            </GlassCard>

            {/* Launch Session */}
            <GlassSectionHeader c={c} title="Launch Session" />
            <GlassCard c={c}>
              <Text style={[Typography.footnote, { color: c.textSecondary, fontWeight: '600' }]}>
                Agent
              </Text>
              <Pressable
                onPress={() => setMenuOpen(true)}
                style={({ pressed }) => [
                  styles.agentTrigger,
                  {
                    backgroundColor: pressed ? c.subtle : 'transparent',
                    borderColor: c.isDark ? Glass.opacity.dark.border : Glass.opacity.light.border,
                  },
                ]}
              >
                <Ionicons name={selectedAgent.icon as any} size={18} color={selectedAgent.color} />
                <Text
                  style={[Typography.subhead, { color: c.textPrimary, fontWeight: '600', flex: 1 }]}
                >
                  {selectedAgent.label}
                </Text>
                <Ionicons name="chevron-down" size={16} color={c.textTertiary} />
              </Pressable>

              <Text style={[Typography.footnote, { color: c.textSecondary, fontWeight: '600' }]}>
                Project Path
              </Text>
              <View style={styles.inputRow}>
                <TextInput
                  style={[
                    styles.pathInput,
                    {
                      backgroundColor: c.isDark
                        ? Glass.opacity.dark.subtle
                        : Glass.opacity.light.subtle,
                      borderColor: c.isDark
                        ? Glass.opacity.dark.border
                        : Glass.opacity.light.border,
                      color: c.textPrimary,
                    },
                  ]}
                  placeholder="/path/to/project"
                  placeholderTextColor={c.textTertiary}
                  value={projectPath}
                  onChangeText={setProjectPath}
                  onSubmitEditing={startAgent}
                  returnKeyType="go"
                />
                <Pressable
                  onPress={() => setPickerOpen(true)}
                  disabled={!connected}
                  style={[
                    styles.browseBtn,
                    {
                      backgroundColor: connected
                        ? c.subtle
                        : c.isDark
                          ? Glass.opacity.dark.subtle
                          : Glass.opacity.light.subtle,
                      opacity: connected ? 1 : 0.5,
                    },
                  ]}
                >
                  <Text style={[Typography.subhead, { color: c.textPrimary, fontWeight: '600' }]}>
                    Browse
                  </Text>
                </Pressable>
              </View>

              <Text style={[Typography.caption1, { color: c.textTertiary }]}>
                {selectedAgent.desc}
              </Text>

              {/* Interaction mode — only Codex supports chat */}
              {agentType === 'codex' && (
                <View style={styles.modeRow}>
                  <Text
                    style={[Typography.footnote, { color: c.textSecondary, fontWeight: '600' }]}
                  >
                    Mode
                  </Text>
                  <View
                    style={[
                      styles.modeSegmented,
                      {
                        backgroundColor: c.isDark
                          ? Glass.opacity.dark.subtle
                          : Glass.opacity.light.subtle,
                        borderColor: c.isDark
                          ? Glass.opacity.dark.border
                          : Glass.opacity.light.border,
                      },
                    ]}
                  >
                    {(
                      [
                        { key: 'chat', label: 'Chat', icon: 'chatbubble-outline' },
                        { key: 'terminal', label: 'Terminal', icon: 'terminal-outline' },
                      ] as const
                    ).map((opt) => {
                      const active = chatMode === opt.key;
                      return (
                        <Pressable
                          key={opt.key}
                          onPress={() => setChatMode(opt.key)}
                          style={[
                            styles.modeSegment,
                            active && { backgroundColor: Colors.primary[500] + '20' },
                          ]}
                        >
                          <Ionicons
                            name={opt.icon as any}
                            size={13}
                            color={active ? Colors.primary[500] : c.textTertiary}
                          />
                          <Text
                            style={[
                              Typography.caption1,
                              {
                                color: active ? Colors.primary[500] : c.textTertiary,
                                fontWeight: active ? '600' : '500',
                              },
                            ]}
                          >
                            {opt.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  <Text style={[Typography.caption2, { color: c.textTertiary }]}>
                    {chatMode === 'chat'
                      ? 'Structured chat with tool calls & approvals'
                      : 'Raw PTY terminal'}
                  </Text>
                </View>
              )}

              <GlassButton
                c={c}
                label={`Launch ${selectedAgent.label}`}
                icon={selectedAgent.icon}
                onPress={startAgent}
                disabled={loading || !projectPath.trim() || !connected}
                loading={loading}
                variant="primary"
              />
            </GlassCard>

            {/* Agent selector modal */}
            <Modal
              visible={menuOpen}
              animationType="fade"
              transparent
              onRequestClose={() => setMenuOpen(false)}
            >
              <Pressable style={styles.menuOverlay} onPress={() => setMenuOpen(false)}>
                <Pressable
                  style={{ marginHorizontal: Spacing.xl }}
                  onPress={(e) => e.stopPropagation()}
                >
                  <GlassCard c={c} blurIntensity={Glass.blur.sheet}>
                    <Text
                      style={[
                        Typography.caption1,
                        {
                          color: c.textTertiary,
                          fontWeight: '600',
                          textTransform: 'uppercase',
                          letterSpacing: 0.5,
                        },
                      ]}
                    >
                      Select Agent
                    </Text>
                    {AGENT_OPTIONS.map((option) => {
                      const active = option.type === agentType;
                      return (
                        <Pressable
                          key={option.type}
                          onPress={() => {
                            setAgentType(option.type);
                            setMenuOpen(false);
                          }}
                          style={({ pressed }) => [
                            styles.menuRow,
                            {
                              backgroundColor: pressed
                                ? c.subtle
                                : active
                                  ? c.accentBg
                                  : 'transparent',
                            },
                          ]}
                        >
                          <View
                            style={[styles.menuIconWrap, { backgroundColor: option.color + '18' }]}
                          >
                            <Ionicons name={option.icon as any} size={20} color={option.color} />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text
                              style={[
                                Typography.subhead,
                                { color: c.textPrimary, fontWeight: '600' },
                              ]}
                            >
                              {option.label}
                            </Text>
                            <Text style={[Typography.caption1, { color: c.textTertiary }]}>
                              {option.desc}
                            </Text>
                          </View>
                          {active && (
                            <Ionicons name="checkmark" size={20} color={Colors.primary[500]} />
                          )}
                        </Pressable>
                      );
                    })}
                  </GlassCard>
                </Pressable>
              </Pressable>
            </Modal>

            <DirectoryPicker
              visible={pickerOpen}
              onClose={() => setPickerOpen(false)}
              onSelect={(path) => {
                setProjectPath(path);
                setPickerOpen(false);
              }}
              initialPath={projectPath || '/'}
            />

            {/* Active Sessions */}
            <GlassSectionHeader c={c} title="Active Sessions" count={agents.length} />
            {agents.length === 0 && (
              <GlassCard c={c}>
                <View
                  style={{ alignItems: 'center', paddingVertical: Spacing.md, gap: Spacing.sm }}
                >
                  <Ionicons name="cube-outline" size={32} color={c.textTertiary} />
                  <Text style={[Typography.subhead, { color: c.textSecondary, fontWeight: '500' }]}>
                    No active sessions
                  </Text>
                  <Text style={[Typography.caption1, { color: c.textTertiary }]}>
                    Launch a new agent to get started
                  </Text>
                </View>
              </GlassCard>
            )}
          </View>
        }
        renderItem={({ item }) => renderAgentRow(item)}
        ListFooterComponent={
          groups.length > 0 || pinned.length > 0 ? (
            <View style={{ marginTop: Spacing.lg }}>
              <GlassSectionHeader
                c={c}
                title="Session History"
                count={pinned.length + groups.reduce((n, g) => n + g.sessions.length, 0)}
              />
              {pinned.length > 0 && (
                <View style={{ marginBottom: Spacing.md }}>
                  <Text
                    style={[
                      Typography.caption2,
                      {
                        color: Colors.primary[500],
                        fontWeight: '600',
                        textTransform: 'uppercase',
                        letterSpacing: 0.5,
                        marginBottom: Spacing.sm,
                        paddingHorizontal: 2,
                      },
                    ]}
                  >
                    Pinned
                  </Text>
                  {pinned.map((s) => renderSessionRow(s, true))}
                </View>
              )}
              {groups.map((group) => (
                <View key={group.project} style={{ marginBottom: Spacing.md }}>
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: Spacing.sm,
                      marginBottom: Spacing.sm,
                      paddingHorizontal: 2,
                    }}
                  >
                    <Ionicons name="folder-outline" size={12} color={c.textTertiary} />
                    <Text
                      style={[Typography.footnote, { color: c.textSecondary, fontWeight: '600' }]}
                    >
                      {group.project}
                    </Text>
                    <Text style={[Typography.caption2, { color: c.textTertiary }]}>
                      {group.sessions.length}
                    </Text>
                  </View>
                  {group.sessions.map((s) => renderSessionRow(s, false))}
                </View>
              ))}
            </View>
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  list: { flex: 1 },
  listContent: { paddingHorizontal: Spacing.lg },

  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  connectionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    borderRadius: 10,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    minHeight: 32,
  },
  connectionDot: { width: 8, height: 8, borderRadius: 4 },

  statsRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },

  agentRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: 44,
  },
  agentLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, flex: 1 },
  agentRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  statusDot: { width: 8, height: 8, borderRadius: 4 },

  agentTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    minHeight: 44,
  },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },

  modeRow: { gap: Spacing.xs },
  modeSegmented: {
    flexDirection: 'row',
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 3,
    gap: 2,
  },
  modeSegment: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: Spacing.sm,
    borderRadius: 8,
  },
  pathInput: {
    flex: 1,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    ...Typography.body,
    minHeight: 44,
    fontFamily: 'Menlo',
  },
  browseBtn: {
    borderRadius: 10,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },

  menuOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    minHeight: 56,
    borderRadius: 10,
    marginHorizontal: 2,
  },
  menuIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },

  sessionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    minHeight: 40,
  },
  sessionTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
});
