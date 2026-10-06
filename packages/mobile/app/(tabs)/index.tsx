import { Alert, FlatList, Modal, Pressable, TextInput, View, Text, StyleSheet, ScrollView } from 'react-native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useFocusEffect, Redirect, type Href } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
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
  GlassButton,
  GlassSearchBar,
} from '../../src/components/GlassKit';
import { FontFamily, Typography, Spacing, Glass, Colors, STATUS_COLORS } from '../../src/constants/theme';
import { DirectoryPicker } from '../../src/components/DirectoryPicker';
import { ResourceMonitor } from '../../src/components/ResourceMonitor';
import { WorktreeTabStrip } from '../../src/components/WorktreeTabStrip';

const AGENT_OPTIONS: {
  type: AgentType;
  label: string;
  desc: string;
  icon: string;
  color: string;
  /** For type 'acp': which ~/.baton/acp.json entry to spawn. */
  acpProvider?: string;
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
    type: 'kiro',
    label: 'Kiro',
    desc: 'Amazon Kiro agent',
    icon: 'rocket',
    color: '#FF9900',
  },
  {
    type: 'antigravity',
    label: 'Antigravity',
    desc: "Google's terminal agent",
    icon: 'planet-outline',
    color: '#4285F4',
  },
  {
    type: 'pi',
    label: 'Pi',
    desc: 'Minimal coding agent',
    icon: 'flask-outline',
    color: '#8B5CF6',
  },
];

function formatTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'Just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes}m ${total % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

/** Ticks once a second so status durations stay live on the dashboard. */
function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/**
 * Display-level staleness marker (open-claude-code's TOOL_DISPLAY_EXPIRY
 * idea): a "busy" session whose last output is over a minute old is probably
 * wedged — say so instead of ticking an ever-growing timer like nothing's wrong.
 */
function quietSuffix(agent: AgentProcess, now: number): string {
  const last = agent.lastActivityAt ? Date.parse(agent.lastActivityAt) : NaN;
  if (Number.isNaN(last)) return '';
  const quietMs = now - last;
  if (quietMs < 60_000) return '';
  return ` · no activity ${formatDuration(quietMs)}`;
}

/** One-line answer to "what is this session doing right now?" */
function agentActivity(agent: AgentProcess, now: number): string | null {
  const detail = agent.stateDetail;
  switch (agent.status) {
    case 'executing': {
      if (!detail) return null;
      const tool =
        detail.toolTitle ?? (detail.tool && detail.tool !== 'unknown' ? detail.tool : 'tool');
      return `Running ${tool} · ${formatDuration(now - detail.since)}${quietSuffix(agent, now)}`;
    }
    case 'thinking':
      return detail
        ? `Thinking · ${formatDuration(now - detail.since)}${quietSuffix(agent, now)}`
        : null;
    case 'running': {
      if (!detail) return null;
      const calls = detail.toolCount
        ? ` · ${detail.toolCount} tool call${detail.toolCount === 1 ? '' : 's'}`
        : '';
      return `Working${calls} · ${formatDuration(now - detail.since)}${quietSuffix(agent, now)}`;
    }
    case 'waiting_input': {
      const prompt = detail?.prompt?.replace(/\s+/g, ' ').trim();
      return prompt ? `Waiting for you: ${prompt}` : null;
    }
    case 'idle': {
      if (!detail) return null;
      const last = agent.lastActivityAt ? formatTime(Date.parse(agent.lastActivityAt)) : '';
      return `Idle${last && last !== 'Just now' ? ` · last activity ${last}` : ''}`;
    }
    case 'error':
      return detail?.error ?? null;
    case 'starting':
      return 'Starting…';
    default:
      return null;
  }
}

/** Needs-your-attention first, then busy, then idle (paseo's bucket order). */
const STATUS_PRIORITY: Record<string, number> = {
  waiting_input: 0,
  error: 1,
  executing: 2,
  thinking: 3,
  running: 4,
  starting: 5,
  idle: 6,
  stopped: 7,
};

/** Breathing halo behind the live-server dot — honest "this is live" signal. */
function PulseDot({ color }: { color: string }) {
  return (
    <View
      style={{
        position: 'absolute',
        width: 22,
        height: 22,
        borderRadius: 11,
        backgroundColor: color,
        opacity: 0.18,
      }}
    />
  );
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
  const hasSavedServers = useConnectionStore((s) => s.hosts.length > 0);
  const activeHost = useConnectionStore((s) =>
    s.hosts.find((h) => h.id === s.activeHostId) ?? null,
  );
  const { sessions, addSession, addSessions, removeSession } = useRecentStore();
  const [projectPath, setProjectPath] = useState('');
  const [agentType, setAgentType] = useState<AgentType>('claude-code');
  /** Which ~/.baton/acp.json provider when agentType === 'acp'. */
  const [acpProvider, setAcpProvider] = useState<string>('');
  const [chatMode, setChatMode] = useState<'chat' | 'terminal'>('chat');
  const [loading, setLoading] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  /** New-session compose sheet — the launcher lives here, not on the page. */
  const [sheetOpen, setSheetOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [pinnedIds, setPinnedIds] = useState<string[]>([]);
  const [showSearch, setShowSearch] = useState(false);
  /** Generic ACP providers from the daemon's ~/.baton/acp.json. */
  const [acpProviders, setAcpProviders] = useState<
    { name: string; label: string; available: boolean }[]
  >([]);
  const c = useThemeColors();
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const tabBarHeight = useLayoutStore((s) => s.tabBarHeight);
  const now = useNow();

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
          title: agent.title,
        });
      }
    } catch {
      // offline
    }
    // Server-backed session history: the daemon's persistent store knows
    // about sessions started from other clients and before daemon restarts —
    // the purely local recent list never did.
    try {
      const data = await apiFetch<{ sessions: import('@baton/shared').SessionSummary[] }>(
        '/api/sessions?limit=50',
      );
      addSessions(
        data.sessions.map((s) => ({
          id: s.id,
          type: s.type,
          projectPath: s.projectPath,
          lastActivity: Date.parse(s.updatedAt) || Date.now(),
          title: s.title,
          chatMode: s.mode === 'sdk' ? 'chat' : 'terminal',
        })),
      );
    } catch {
      // offline — local history stays as the fallback
    }
  }, [setAgents, addSession, addSessions]);

  // Generic ACP providers become selectable agent options when configured.
  useEffect(() => {
    apiFetch<Array<{ name: string; label: string; available: boolean }>>('/api/acp/providers')
      .then((list) => setAcpProviders(list.filter((p) => p.available)))
      .catch(() => {
        // daemon offline or no acp.json — static options only
      });
  }, []);

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
  }, [fetchAgents, setAgents, updateAgentStatus]);

  // Refresh the agent list whenever this tab gains focus. Covers the
  // return-from-background resume case: after a reconnect the local store may
  // be stale, and the WS agent_list push only fires on connect.
  useFocusEffect(
    useCallback(() => {
      fetchAgents();
    }, [fetchAgents]),
  );

  // "Active Sessions" means LIVE sessions — stopped ones are dead weight in
  // the list (they're not tappable and pile up across daemon restarts).
  // Needs-input / error sort first so they can't hide below idle rows.
  const liveAgents = useMemo(
    () =>
      agents
        .filter((a) => a.status !== 'stopped')
        .sort((a, b) => (STATUS_PRIORITY[a.status] ?? 9) - (STATUS_PRIORITY[b.status] ?? 9)),
    [agents],
  );
  // History dedup keys off LIVE agents only: a session stopped during this
  // daemon's lifetime then falls through to Session History, where it stays
  // tappable — instead of vanishing from both lists at once.
  const activeSessionIds = useMemo(() => new Set(liveAgents.map((a) => a.id)), [liveAgents]);

  const recentSessionList = useMemo(
    () => sessions.filter((s) => !activeSessionIds.has(s.id)),
    [sessions, activeSessionIds],
  );

  const { pinned, groups } = useMemo(
    () => getGroupedSessions(recentSessionList, pinnedIds, searchQuery),
    [recentSessionList, pinnedIds, searchQuery],
  );

  // Static options + one entry per configured generic ACP provider.
  const agentOptions = useMemo(
    () => [
      ...AGENT_OPTIONS,
      ...acpProviders.map((p) => ({
        type: 'acp' as AgentType,
        label: p.label,
        desc: 'Generic ACP provider',
        icon: 'hardware-chip-outline',
        color: '#8B5CF6',
        acpProvider: p.name,
      })),
    ],
    [acpProviders],
  );

  const selectedAgent =
    agentOptions.find(
      (o) => o.type === agentType && (!o.acpProvider || o.acpProvider === acpProvider),
    ) ??
    (agentType === 'acp' && agentOptions.some((o) => o.type === 'acp')
      ? agentOptions.find((o) => o.type === 'acp')!
      : AGENT_OPTIONS[0]);

  /** Hostname-only subtitle for the server card (no credentials in URLs). */
  const hostSubtitle = useMemo(() => {
    const url = activeHost?.mode === 'local' ? activeHost.localHttpUrl : activeHost?.relayUrl;
    if (!url) return connected ? 'Connected' : 'Reconnecting…';
    try {
      return new URL(url).host;
    } catch {
      return connected ? 'Connected' : 'Reconnecting…';
    }
  }, [activeHost, connected]);

  // Connection-first flow: with no saved servers, the connect screen is home.
  // Declared here (inside the mounted tab) so the navigator is ready.
  if (!hasSavedServers) {
    return <Redirect href="/connect" />;
  }

  function togglePin(id: string) {
    setPinnedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function deleteSession(session: RecentSession) {
    const label =
      session.title ?? (AGENT_OPTIONS.find((o) => o.type === session.type)?.label ?? session.type);
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
            // The daemon keeps the full transcript — delete there too so the
            // session doesn't reappear on the next server-history merge.
            apiFetch(`/api/agents/${session.id}`, { method: 'DELETE' }).catch(() => {});
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
          ...(agentType === 'acp' && selectedAgent.acpProvider
            ? { acpProvider: selectedAgent.acpProvider }
            : {}),
          projectPath: projectPath.trim(),
          mode: chatMode === 'chat' ? 'sdk' : 'pty',
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
        chatMode,
      });
      setSheetOpen(false);
      const route = chatMode === 'chat' ? 'chat' : 'terminal';
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
   * Sessions created in chat mode reopen in chat; terminal sessions open in terminal.
   */
  function openSession(sessionId: string, agentType: AgentType) {
    const stored = sessions.find((s) => s.id === sessionId);
    const isChat = stored?.chatMode === 'chat' || (!stored?.chatMode && chatMode === 'chat');
    const route = isChat ? 'chat' : 'terminal';
    addSession({
      id: sessionId,
      type: agentType,
      projectPath: stored?.projectPath ?? '',
      lastActivity: Date.now(),
      chatMode: stored?.chatMode ?? (isChat ? 'chat' : 'terminal'),
    });
    router.push(`/${route}/${sessionId}` as Href);
  }

  const renderAgentRow = (agent: AgentProcess) => {
    // Honest status: while disconnected, cached statuses are stale — grey the
    // dot, hide the live activity line and Stop (nothing can be sent anyway).
    const statusColor = connected
      ? (STATUS_COLORS?.[agent.status] ?? '#a8a29e')
      : c.textTertiary;
    const label = AGENT_OPTIONS.find((o) => o.type === agent.type)?.label ?? agent.type;
    const activity = connected ? agentActivity(agent, now) : null;
    return (
      <Pressable
        key={agent.id}
        onPress={() => openSession(agent.id, agent.type)}
        style={({ pressed }) => [{ opacity: pressed ? 0.9 : 1 }, { marginBottom: Spacing.sm }]}
      >
        <GlassCard c={c} blurIntensity={Glass.blur.card - 10}>
          <View style={styles.agentRow}>
            <View style={styles.agentLeft}>
              <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
              <View style={{ flex: 1 }}>
                <Text style={[Typography.subhead, { color: c.textPrimary, fontWeight: '600' }]}>
                  {agent.title ?? label}
                </Text>
                <Text
                  style={[Typography.caption1, { color: c.textTertiary, fontFamily: FontFamily.mono }]}
                  numberOfLines={1}
                >
                  {agent.projectPath}
                </Text>
                {activity ? (
                  <Text
                    style={[
                      Typography.caption2,
                      {
                        color: STATUS_COLORS?.[agent.status] ?? statusColor,
                        marginTop: 2,
                        fontWeight: '500',
                      },
                    ]}
                    numberOfLines={1}
                  >
                    {activity}
                  </Text>
                ) : !connected ? (
                  <Text
                    style={[
                      Typography.caption2,
                      { color: Colors.warning[400], marginTop: 2, fontWeight: '500' },
                    ]}
                    numberOfLines={1}
                  >
                    Waiting to reconnect…
                  </Text>
                ) : null}
              </View>
            </View>
            <View style={styles.agentRight}>
              <Text
                style={[
                  Typography.caption2,
                  {
                    color: connected ? statusColor : Colors.warning[400],
                    fontWeight: '600',
                    textTransform: 'capitalize',
                  },
                ]}
              >
                {connected ? agent.status.replace('_', ' ') : 'reconnecting'}
              </Text>
              {connected && (
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
                  {session.title ?? agentOption?.label ?? session.type}
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
                style={[Typography.mono, { color: c.textTertiary, marginTop: 2, fontSize: 12 }]}
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
        data={liveAgents}
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
            {/* Title row — search + new-session live here, always reachable */}
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
                <Pressable
                  onPress={() => setSheetOpen(true)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  style={[
                    styles.newBtn,
                    {
                      backgroundColor: c.isDark
                        ? Glass.opacity.dark.subtle
                        : Glass.opacity.light.subtle,
                    },
                  ]}
                  accessibilityLabel="New session"
                >
                  <Ionicons name="add" size={22} color={Colors.primary[500]} />
                </Pressable>
              </View>
            </View>

            {/* Server card — connection first: status, host, host stats */}
            <Pressable
              onPress={() => router.push('/connect')}
              style={({ pressed }) => [{ opacity: pressed ? 0.85 : 1 }]}
            >
              <GlassCard c={c} blurIntensity={Glass.blur.card - 10}>
                <View style={styles.serverRow}>
                  <View style={styles.serverDotWrap}>
                    {connected && <PulseDot color={Colors.success[400]} />}
                    <View
                      style={[
                        styles.statusDot,
                        {
                          backgroundColor: connected ? Colors.success[400] : Colors.danger[400],
                        },
                      ]}
                    />
                  </View>
                  <View style={{ flex: 1, gap: 1 }}>
                    <Text
                      style={[Typography.subhead, { color: c.textPrimary, fontWeight: '600' }]}
                      numberOfLines={1}
                    >
                      {activeHost?.label ?? 'Server'}
                    </Text>
                    <Text style={[Typography.caption1, { color: c.textTertiary }]} numberOfLines={1}>
                      {connected ? hostSubtitle : 'Reconnecting — sessions resume automatically'}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={14} color={c.textTertiary} />
                </View>
                {connected && (
                  <View
                    style={[
                      styles.serverMonitor,
                      {
                        borderTopColor: c.isDark
                          ? Glass.opacity.dark.border
                          : Glass.opacity.light.border,
                      },
                    ]}
                  >
                    <ResourceMonitor connected={connected} />
                  </View>
                )}
              </GlassCard>
            </Pressable>

            {/* New session — the one primary action */}
            <GlassButton
              c={c}
              label="New Session"
              icon="add"
              onPress={() => setSheetOpen(true)}
              variant="primary"
            />

            {/* Search bar */}
            {showSearch && (
              <GlassSearchBar
                c={c}
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder="Search sessions by project or agent"
              />
            )}

            {/* Active Sessions */}
            <GlassSectionHeader c={c} title="Active Sessions" count={liveAgents.length} />
            {liveAgents.length === 0 && (
              <GlassCard c={c}>
                <View
                  style={{ alignItems: 'center', paddingVertical: Spacing.xl, gap: Spacing.sm }}
                >
                  <View
                    style={{
                      width: 52,
                      height: 52,
                      borderRadius: 16,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: c.isDark
                        ? Glass.opacity.dark.subtle
                        : Glass.opacity.light.subtle,
                      marginBottom: Spacing.xs,
                    }}
                  >
                    <Ionicons name="cube-outline" size={26} color={c.textTertiary} />
                  </View>
                  <Text style={[Typography.subhead, { color: c.textPrimary, fontWeight: '600' }]}>
                    No active sessions
                  </Text>
                  <Text style={[Typography.footnote, { color: c.textTertiary }]}>
                    Tap New Session to launch your first agent
                  </Text>
                </View>
              </GlassCard>
            )}
            {!connected && liveAgents.length > 0 && (
              <Text style={[Typography.caption1, { color: c.textTertiary, paddingHorizontal: 2 }]}>
                Live status is paused until the server connection returns.
              </Text>
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
                  <Text style={[Typography.overline, { color: Colors.primary[500], marginBottom: Spacing.sm, paddingHorizontal: 2 }]}>
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

      {/* ── New Session sheet — the launcher, out of the page flow ── */}
      <Modal
        visible={sheetOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setSheetOpen(false)}
      >
        <Pressable style={styles.sheetBackdrop} onPress={() => setSheetOpen(false)}>
          <Pressable style={styles.sheetCard} onPress={() => {}}>
            <BlurView
              tint={c.isDark ? 'systemUltraThinMaterialDark' : 'systemUltraThinMaterialLight'}
              intensity={Glass.blur.sheet}
              style={styles.sheetBlur}
            >
              <View
                style={[
                  StyleSheet.absoluteFill,
                  {
                    backgroundColor: c.isDark
                      ? Glass.opacity.dark.elevated
                      : Glass.opacity.light.elevated,
                  },
                ]}
                pointerEvents="none"
              />
              <View
                style={[
                  StyleSheet.absoluteFill,
                  {
                    borderWidth: StyleSheet.hairlineWidth,
                    borderColor: c.isDark
                      ? Glass.opacity.dark.border
                      : Glass.opacity.light.border,
                  },
                ]}
                pointerEvents="none"
              />
              <View style={[styles.sheetHandle, { backgroundColor: c.separator }]} />
              <View style={styles.sheetTitleRow}>
                <Text style={[Typography.headline, { color: c.textPrimary }]}>New Session</Text>
                <Pressable
                  onPress={() => setSheetOpen(false)}
                  hitSlop={6}
                  style={[
                    styles.sheetClose,
                    {
                      backgroundColor: c.isDark
                        ? Glass.opacity.dark.subtle
                        : Glass.opacity.light.subtle,
                    },
                  ]}
                  accessibilityLabel="Close"
                >
                  <Ionicons name="close" size={16} color={c.textSecondary} />
                </Pressable>
              </View>

              <ScrollView showsVerticalScrollIndicator={false}>
                <Text style={[styles.fieldLabel, { color: c.textSecondary }]}>Agent</Text>
                <Pressable
                  onPress={() => setMenuOpen(true)}
                  style={({ pressed }) => [
                    styles.agentTrigger,
                    {
                      backgroundColor: pressed ? c.subtle : 'transparent',
                      borderColor: c.isDark
                        ? Glass.opacity.dark.border
                        : Glass.opacity.light.border,
                    },
                  ]}
                >
                  <Ionicons name={selectedAgent.icon as any} size={18} color={selectedAgent.color} />
                  <Text
                    style={[Typography.subhead, { color: c.textPrimary, fontWeight: '600', flex: 1 }]}
                  >
                    {selectedAgent.label}
                  </Text>
                  <Text style={[Typography.caption1, { color: c.textTertiary }]} numberOfLines={1}>
                    {selectedAgent.desc}
                  </Text>
                  <Ionicons name="chevron-down" size={16} color={c.textTertiary} />
                </Pressable>

                <Text style={[styles.fieldLabel, { color: c.textSecondary }]}>Project</Text>
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

                {/* Parallel worktrees for the entered project — picker helper */}
                {connected && projectPath.trim().length > 0 && (
                  <View style={{ marginTop: Spacing.sm }}>
                    <WorktreeTabStrip
                      c={c}
                      projectPath={projectPath.trim()}
                      onSelect={(w) => {
                        if (w) setProjectPath(w.path);
                      }}
                    />
                  </View>
                )}

                <Text style={[styles.fieldLabel, { color: c.textSecondary }]}>Mode</Text>
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
                <Text style={[Typography.caption2, { color: c.textTertiary, marginTop: Spacing.xs }]}>
                  {chatMode === 'chat'
                    ? 'Structured chat with tool cards & approvals'
                    : 'Raw PTY terminal'}
                </Text>

                <GlassButton
                  c={c}
                  label={`Launch ${selectedAgent.label}`}
                  icon={selectedAgent.icon}
                  onPress={startAgent}
                  disabled={loading || !projectPath.trim() || !connected}
                  loading={loading}
                  variant="primary"
                />
              </ScrollView>
            </BlurView>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Agent selector */}
      <Modal
        visible={menuOpen}
        animationType="fade"
        transparent
        onRequestClose={() => setMenuOpen(false)}
      >
        <Pressable style={styles.menuOverlay} onPress={() => setMenuOpen(false)}>
          <Pressable style={{ marginHorizontal: Spacing.xl }} onPress={() => {}}>
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
              {agentOptions.map((option) => {
                const active =
                  option.type === agentType &&
                  (!option.acpProvider || option.acpProvider === selectedAgent.acpProvider);
                return (
                  <Pressable
                    key={option.acpProvider ? `acp:${option.acpProvider}` : option.type}
                    onPress={() => {
                      setAgentType(option.type);
                      if (option.acpProvider) setAcpProvider(option.acpProvider);
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
                    <View style={[styles.menuIconWrap, { backgroundColor: option.color + '18' }]}>
                      <Ionicons name={option.icon as any} size={20} color={option.color} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[Typography.subhead, { color: c.textPrimary, fontWeight: '600' }]}>
                        {option.label}
                      </Text>
                      <Text style={[Typography.caption1, { color: c.textTertiary }]}>
                        {option.desc}
                      </Text>
                    </View>
                    {active && <Ionicons name="checkmark" size={20} color={Colors.primary[500]} />}
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
  newBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },

  serverRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    minHeight: 44,
  },
  serverDotWrap: {
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  serverMonitor: {
    marginTop: Spacing.sm,
    paddingTop: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  statusDot: { width: 10, height: 10, borderRadius: 5 },

  agentRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: 44,
  },
  agentLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, flex: 1 },
  agentRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },

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
    ...Typography.mono,
    minHeight: 44,
  },
  browseBtn: {
    borderRadius: 10,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  fieldLabel: {
    ...Typography.footnote,
    fontWeight: '600',
    marginBottom: Spacing.xs,
    marginTop: Spacing.sm,
  },

  sheetBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  sheetCard: {
    maxHeight: '82%',
    marginHorizontal: Spacing.md,
    marginBottom: Spacing.md,
  },
  sheetBlur: {
    borderRadius: 24,
    borderCurve: 'continuous',
    overflow: 'hidden',
    paddingTop: Spacing.xs,
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.lg,
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 36,
    height: 5,
    borderRadius: 3,
    marginTop: Spacing.xs,
    marginBottom: Spacing.xs,
  },
  sheetTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.xs,
  },
  sheetClose: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    borderColor: 'transparent',
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
