import {
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { Text } from 'react-native';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Spinner } from 'heroui-native';
import type { AgentProcess, AgentType } from '@baton/shared';
import { apiFetch } from '../../src/services/api';
import { wsService } from '../../src/services/websocket';
import { useAgentStore } from '../../src/stores/agents';
import { useRecentStore } from '../../src/stores/recent';
import type { RecentSession } from '../../src/stores/recent';
import { useConnectionStore } from '../../src/stores/connection';
import { useLayoutStore } from '../../src/stores/layout';
import {
  Colors,
  CornerRadius,
  Spacing,
  STATUS_COLORS,
  Typography,
} from '../../src/constants/theme';
import { useThemeColors } from '../../src/hooks/useThemeColors';
import { DirectoryPicker } from '../../src/components/DirectoryPicker';

const AGENT_OPTIONS: { type: AgentType; label: string; desc: string }[] = [
  { type: 'claude-code', label: 'Claude Code', desc: 'Deep code work' },
  { type: 'codex', label: 'Codex', desc: 'Fast execution' },
  { type: 'opencode', label: 'OpenCode', desc: 'Open stack' },
];

function formatTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'Just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

export default function DashboardScreen() {
  const router = useRouter();
  const agents = useAgentStore((s) => s.agents);
  const setAgents = useAgentStore((s) => s.setAgents);
  const updateAgentStatus = useAgentStore((s) => s.updateAgentStatus);
  const addAgent = useAgentStore((s) => s.addAgent);
  const removeAgent = useAgentStore((s) => s.removeAgent);
  const connected = useConnectionStore((s) => s.connected);
  const recentSessions = useRecentStore((s) => s.sessions);
  const addRecentSession = useRecentStore((s) => s.addSession);
  const [projectPath, setProjectPath] = useState('');
  const [agentType, setAgentType] = useState<AgentType>('claude-code');
  const [loading, setLoading] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const c = useThemeColors();
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const tabBarHeight = useLayoutStore((s) => s.tabBarHeight);

  const fetchAgents = useCallback(async () => {
    try {
      const list = await apiFetch<AgentProcess[]>('/api/agents');
      setAgents(list);
      for (const agent of list) {
        addRecentSession({
          id: agent.id,
          type: agent.type,
          projectPath: agent.projectPath,
          lastActivity: Date.now(),
        });
      }
    } catch {
      // offline
    }
  }, [setAgents, addRecentSession]);

  useEffect(() => {
    fetchAgents();
    const unsubList = wsService.on('agent_list', (msg) => {
      if (msg.type === 'agent_list') {
        setAgents(
          msg.agents.map((agent) => ({
            id: agent.id,
            type: agent.type as AgentProcess['type'],
            projectPath: agent.projectPath,
            status: agent.status as AgentProcess['status'],
            startedAt: '',
          })),
        );
      }
    });
    const unsubStatus = wsService.on('status_update', (msg) => {
      if (msg.type === 'status_update' && 'status' in msg) {
        updateAgentStatus(msg.sessionId, msg.status as AgentProcess['status']);
      }
    });

    return () => {
      unsubList();
      unsubStatus();
    };
  }, [fetchAgents, setAgents, updateAgentStatus]);

  async function startAgent() {
    if (!projectPath.trim()) return;
    setLoading(true);
    try {
      const data = await apiFetch<{ sessionId: string }>('/api/agents/start', {
        method: 'POST',
        body: JSON.stringify({ agentType, projectPath: projectPath.trim() }),
      });
      addAgent({
        id: data.sessionId,
        type: agentType,
        projectPath: projectPath.trim(),
        status: 'running',
        startedAt: new Date().toISOString(),
      });
      addRecentSession({
        id: data.sessionId,
        type: agentType,
        projectPath: projectPath.trim(),
        lastActivity: Date.now(),
      });
      router.push(`/terminal/${data.sessionId}`);
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

  const running = agents.filter((agent) => agent.status !== 'stopped').length;
  const activeSessionIds = new Set(agents.map((a) => a.id));
  const inactiveRecent = recentSessions.filter((s) => !activeSessionIds.has(s.id));
  const selectedAgent =
    AGENT_OPTIONS.find((option) => option.type === agentType) ?? AGENT_OPTIONS[0];

  return (
    <View style={[styles.root, { backgroundColor: c.bg }]}>
      <FlatList
        data={agents}
        keyExtractor={(item) => item.id}
        style={styles.list}
        contentContainerStyle={[styles.listContent, { paddingTop: headerHeight + Spacing.lg, paddingBottom: insets.bottom + tabBarHeight + Spacing.lg }]}
        ListHeaderComponent={
          <View style={styles.headerContent}>
            <View style={styles.titleRow}>
              <Text style={[styles.largeTitle, { color: c.textPrimary }]}>Baton</Text>
              <View
                style={[
                  styles.connectionBadge,
                  {
                    backgroundColor: connected ? c.successBg : c.dangerBg,
                  },
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
                    styles.connectionText,
                    { color: connected ? Colors.success[400] : Colors.danger[400] },
                  ]}
                >
                  {connected ? 'Online' : 'Offline'}
                </Text>
              </View>
            </View>

            <View style={styles.statsRow}>
              <View style={[styles.statCard, { backgroundColor: c.card }]}>
                <Text style={[styles.statValue, { color: c.textPrimary }]}>{running}</Text>
                <Text style={[styles.statLabel, { color: c.textTertiary }]}>Running</Text>
              </View>
              <View style={[styles.statCard, { backgroundColor: c.card }]}>
                <Text style={[styles.statValue, { color: c.textPrimary }]}>{agents.length}</Text>
                <Text style={[styles.statLabel, { color: c.textTertiary }]}>Total</Text>
              </View>
            </View>

            <View style={[styles.launchCard, { backgroundColor: c.card }]}>
              <Text style={[styles.sectionTitle, { color: c.textPrimary }]}>Launch Session</Text>

              <View style={styles.agentPills}>
                {AGENT_OPTIONS.map((option) => {
                  const active = option.type === agentType;
                  return (
                    <Pressable
                      key={option.type}
                      onPress={() => setAgentType(option.type)}
                      style={[
                        styles.agentPill,
                        {
                          backgroundColor: active ? c.accentBg : c.subtle,
                          borderColor: active ? c.accentBorder : 'transparent',
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.agentPillText,
                          {
                            color: active ? Colors.primary[500] : c.textSecondary,
                          },
                        ]}
                      >
                        {option.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={[styles.inputLabel, { color: c.textSecondary }]}>Project Path</Text>
              <View style={styles.inputRow}>
                <TextInput
                  style={[
                    styles.pathInput,
                    {
                      backgroundColor: c.inputBg,
                      borderColor: c.inputBorder,
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
                      backgroundColor: connected ? c.subtle : c.cardBorder,
                      opacity: connected ? 1 : 0.5,
                    },
                  ]}
                >
                  <Text style={[styles.browseText, { color: c.textPrimary }]}>Browse</Text>
                </Pressable>
              </View>

              <DirectoryPicker
                visible={pickerOpen}
                onClose={() => setPickerOpen(false)}
                onSelect={(path) => {
                  setProjectPath(path);
                  setPickerOpen(false);
                }}
                initialPath={projectPath || '/'}
              />

              <Text style={[styles.agentDesc, { color: c.textTertiary }]}>
                {selectedAgent.desc}
              </Text>

              <Pressable
                onPress={startAgent}
                disabled={loading || !projectPath.trim() || !connected}
                style={[
                  styles.launchBtn,
                  {
                    backgroundColor:
                      loading || !projectPath.trim() || !connected
                        ? c.subtle
                        : Colors.primary[500],
                  },
                ]}
              >
                {loading ? (
                  <Spinner size="sm" color="#fff" />
                ) : (
                  <Text style={styles.launchBtnText}>
                    Launch {selectedAgent.label}
                  </Text>
                )}
              </Pressable>
            </View>

            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, { color: c.textPrimary }]}>
                Active Sessions
              </Text>
              <Text style={[styles.sectionCount, { color: c.textTertiary }]}>
                {agents.length}
              </Text>
            </View>

            {agents.length === 0 && (
              <View style={[styles.emptyState, { backgroundColor: c.card }]}>
                <Text style={[styles.emptyText, { color: c.textSecondary }]}>
                  No active sessions
                </Text>
                <Text style={[styles.emptySubtext, { color: c.textTertiary }]}>
                  Launch a new agent session to get started
                </Text>
              </View>
            )}

            {inactiveRecent.length > 0 && (
              <View style={styles.recentSection}>
                <View style={styles.sectionHeader}>
                  <Text style={[styles.sectionTitle, { color: c.textPrimary }]}>
                    Recent Sessions
                  </Text>
                </View>
                {inactiveRecent.slice(0, 8).map((session) => (
                  <Pressable
                    key={session.id}
                    onPress={() => {
                      addRecentSession({
                        ...session,
                        lastActivity: Date.now(),
                      });
                      router.push(`/terminal/${session.id}`);
                    }}
                    style={({ pressed }) => [
                      styles.recentRow,
                      {
                        backgroundColor: pressed ? c.subtle : c.card,
                      },
                    ]}
                  >
                    <View style={styles.recentLeft}>
                      <Text style={[styles.recentType, { color: c.textPrimary }]}>
                        {AGENT_OPTIONS.find((o) => o.type === session.type)?.label ?? session.type}
                      </Text>
                      <Text
                        style={[styles.recentPath, { color: c.textTertiary }]}
                        numberOfLines={1}
                      >
                        {session.projectPath}
                      </Text>
                    </View>
                    <Text style={[styles.recentTime, { color: c.textTertiary }]}>
                      {formatTime(session.lastActivity)}
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}
          </View>
        }
        renderItem={({ item: agent }) => (
          <AgentRow
            agent={agent}
            onOpen={() => {
              if (agent.status !== 'stopped') {
                addRecentSession({
                  id: agent.id,
                  type: agent.type,
                  projectPath: agent.projectPath,
                  lastActivity: Date.now(),
                });
                router.push(`/terminal/${agent.id}`);
              }
            }}
            onStop={() => stopAgent(agent.id)}
          />
        )}
      />
    </View>
  );
}

function AgentRow({
  agent,
  onOpen,
  onStop,
}: {
  agent: AgentProcess;
  onOpen: () => void;
  onStop: () => void;
}) {
  const c = useThemeColors();
  const statusColor = STATUS_COLORS[agent.status] ?? '#a8a29e';
  const isStopped = agent.status === 'stopped';
  const label = AGENT_OPTIONS.find((option) => option.type === agent.type)?.label ?? agent.type;

  return (
    <Pressable
      onPress={onOpen}
      style={({ pressed }) => [
        styles.agentRow,
        {
          backgroundColor: pressed ? c.subtle : c.card,
          opacity: isStopped ? 0.5 : 1,
        },
      ]}
    >
      <View style={styles.agentLeft}>
        <View style={[styles.agentDot, { backgroundColor: statusColor }]} />
        <View style={styles.agentInfo}>
          <Text style={[styles.agentLabel, { color: c.textPrimary }]}>{label}</Text>
          <Text style={[styles.agentPath, { color: c.textTertiary }]} numberOfLines={1}>
            {agent.projectPath}
          </Text>
        </View>
      </View>
      <View style={styles.agentRight}>
        <Text style={[styles.agentStatus, { color: statusColor }]}>
          {agent.status.replace('_', ' ')}
        </Text>
        {!isStopped && (
          <Pressable
            onPress={onStop}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={styles.stopBtn}
          >
            <Text style={styles.stopBtnText}>Stop</Text>
          </Pressable>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: Spacing.lg,
    gap: Spacing.lg,
  },
  headerContent: {
    gap: Spacing.lg,
  },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.xs,
  },
  largeTitle: {
    fontSize: Typography.largeTitle.fontSize,
    lineHeight: Typography.largeTitle.lineHeight,
    fontWeight: '700',
    letterSpacing: 0.37,
  },
  connectionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    borderRadius: CornerRadius.large,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    minHeight: 32,
  },
  connectionDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  connectionText: {
    fontSize: Typography.caption1.fontSize,
    lineHeight: Typography.caption1.lineHeight,
    fontWeight: '600',
  },
  statsRow: {
    flexDirection: 'row',
    gap: Spacing.md,
  },
  statCard: {
    flex: 1,
    borderRadius: CornerRadius.large,
    paddingVertical: Spacing.lg,
    paddingHorizontal: Spacing.md,
    alignItems: 'center',
    gap: Spacing.xs,
  },
  statValue: {
    fontSize: Typography.title3.fontSize,
    lineHeight: Typography.title3.lineHeight,
    fontWeight: '700',
  },
  statLabel: {
    fontSize: Typography.caption1.fontSize,
    lineHeight: Typography.caption1.lineHeight,
  },
  launchCard: {
    borderRadius: CornerRadius.large,
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  sectionTitle: {
    fontSize: Typography.headline.fontSize,
    lineHeight: Typography.headline.lineHeight,
    fontWeight: '600',
  },
  agentPills: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  agentPill: {
    flex: 1,
    borderRadius: CornerRadius.large,
    borderWidth: 1,
    paddingVertical: Spacing.md,
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
  agentPillText: {
    fontSize: Typography.subhead.fontSize,
    lineHeight: Typography.subhead.lineHeight,
    fontWeight: '600',
  },
  inputLabel: {
    fontSize: Typography.subhead.fontSize,
    lineHeight: Typography.subhead.lineHeight,
    fontWeight: '600',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  pathInput: {
    flex: 1,
    borderRadius: CornerRadius.medium,
    borderWidth: 1,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    fontSize: Typography.body.fontSize,
    lineHeight: Typography.body.lineHeight,
    minHeight: 44,
    fontFamily: 'Menlo',
  },
  browseBtn: {
    borderRadius: CornerRadius.medium,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  browseText: {
    fontSize: Typography.subhead.fontSize,
    lineHeight: Typography.subhead.lineHeight,
    fontWeight: '600',
  },
  agentDesc: {
    fontSize: Typography.caption1.fontSize,
    lineHeight: Typography.caption1.lineHeight,
  },
  launchBtn: {
    borderRadius: CornerRadius.medium,
    paddingVertical: Spacing.md,
    minHeight: 50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  launchBtnText: {
    fontSize: Typography.headline.fontSize,
    lineHeight: Typography.headline.lineHeight,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.xs,
  },
  sectionCount: {
    fontSize: Typography.subhead.fontSize,
    lineHeight: Typography.subhead.lineHeight,
  },
  emptyState: {
    borderRadius: CornerRadius.large,
    paddingVertical: Spacing['3xl'],
    paddingHorizontal: Spacing.lg,
    alignItems: 'center',
    gap: Spacing.sm,
  },
  emptyText: {
    fontSize: Typography.subhead.fontSize,
    lineHeight: Typography.subhead.lineHeight,
    fontWeight: '600',
  },
  emptySubtext: {
    fontSize: Typography.caption1.fontSize,
    lineHeight: Typography.caption1.lineHeight,
  },
  recentSection: {
    gap: Spacing.sm,
  },
  recentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: CornerRadius.large,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    minHeight: 56,
    gap: Spacing.md,
  },
  recentLeft: {
    flex: 1,
    gap: 2,
  },
  recentType: {
    fontSize: Typography.subhead.fontSize,
    lineHeight: Typography.subhead.lineHeight,
    fontWeight: '600',
  },
  recentPath: {
    fontSize: Typography.caption1.fontSize,
    lineHeight: Typography.caption1.lineHeight,
    fontFamily: 'Menlo',
  },
  recentTime: {
    fontSize: Typography.caption2.fontSize,
    lineHeight: Typography.caption2.lineHeight,
  },
  agentRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderRadius: CornerRadius.large,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    minHeight: 60,
  },
  agentLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    flex: 1,
  },
  agentDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  agentInfo: {
    flex: 1,
    gap: 2,
  },
  agentLabel: {
    fontSize: Typography.subhead.fontSize,
    lineHeight: Typography.subhead.lineHeight,
    fontWeight: '600',
  },
  agentPath: {
    fontSize: Typography.caption1.fontSize,
    lineHeight: Typography.caption1.lineHeight,
    fontFamily: 'Menlo',
  },
  agentRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  agentStatus: {
    fontSize: Typography.caption2.fontSize,
    lineHeight: Typography.caption2.lineHeight,
    fontWeight: '500',
    textTransform: 'capitalize',
  },
  stopBtn: {
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
  },
  stopBtnText: {
    fontSize: Typography.subhead.fontSize,
    lineHeight: Typography.subhead.lineHeight,
    fontWeight: '600',
    color: Colors.danger[400],
  },
});
