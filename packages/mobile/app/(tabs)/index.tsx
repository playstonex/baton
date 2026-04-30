import { Alert, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { Text } from 'react-native';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { Button, Input, Spinner } from 'heroui-native';
import type { AgentProcess, AgentType } from '@baton/shared';
import { apiFetch } from '../../src/services/api';
import { wsService } from '../../src/services/websocket';
import { useAgentStore } from '../../src/stores/agents';
import { useConnectionStore } from '../../src/stores/connection';
import { STATUS_COLORS } from '../../src/constants/theme';
import { useThemeColors } from '../../src/hooks/useThemeColors';

const AGENT_OPTIONS: { type: AgentType; label: string; desc: string }[] = [
  { type: 'codex', label: 'Codex', desc: 'Remote AI coding agent' },
  { type: 'claude-code', label: 'Claude Code (PTY)', desc: 'Terminal-based' },
];

export default function DashboardScreen() {
  const router = useRouter();
  const agents = useAgentStore((s) => s.agents);
  const setAgents = useAgentStore((s) => s.setAgents);
  const updateAgentStatus = useAgentStore((s) => s.updateAgentStatus);
  const addAgent = useAgentStore((s) => s.addAgent);
  const removeAgent = useAgentStore((s) => s.removeAgent);
  const connected = useConnectionStore((s) => s.connected);
  const [projectPath, setProjectPath] = useState('');
  const [agentType, setAgentType] = useState<AgentType>('codex');
  const [loading, setLoading] = useState(false);
  const c = useThemeColors();

  const fetchAgents = useCallback(async () => {
    try {
      const list = await apiFetch<AgentProcess[]>('/api/agents');
      setAgents(list);
    } catch {
      // offline
    }
  }, [setAgents]);

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
      router.push(`/chat/${data.sessionId}`);
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
  const selectedAgent =
    AGENT_OPTIONS.find((option) => option.type === agentType) ?? AGENT_OPTIONS[0];

  return (
    <FlatList
      data={agents}
      keyExtractor={(item) => item.id}
      style={{ flex: 1, backgroundColor: c.bg }}
      contentContainerStyle={styles.listContent}
      maxToRenderPerBatch={10}
      windowSize={5}
      ListHeaderComponent={
        <View style={styles.headerContent}>
          <View style={[styles.headerCard, { backgroundColor: c.card, borderColor: c.cardBorder }]}>
            <View style={styles.headerTop}>
              <View>
                <Text style={[styles.title, { color: c.textPrimary }]}>Baton</Text>
                <Text style={[styles.subtitle, { color: c.textSecondary }]}>
                  Agent orchestration
                </Text>
              </View>
              <View
                style={[
                  styles.connectionBadge,
                  {
                    backgroundColor: connected ? '#f0fdf4' : '#fef2f2',
                    borderColor: connected ? '#22c55e' : '#ef4444',
                  },
                ]}
              >
                <View
                  style={[
                    styles.connectionDot,
                    { backgroundColor: connected ? '#22c55e' : '#ef4444' },
                  ]}
                />
                <Text
                  style={[
                    styles.connectionText,
                    { color: connected ? '#16a34a' : '#dc2626' },
                  ]}
                >
                  {connected ? 'Online' : 'Offline'}
                </Text>
              </View>
            </View>

            <View style={styles.statsRow}>
              <View style={[styles.statItem, { backgroundColor: c.subtle }]}>
                <Text style={[styles.statValue, { color: c.textPrimary }]}>{running}</Text>
                <Text style={[styles.statLabel, { color: c.textTertiary }]}>Running</Text>
              </View>
              <View style={[styles.statItem, { backgroundColor: c.subtle }]}>
                <Text style={[styles.statValue, { color: c.textPrimary }]}>{agents.length}</Text>
                <Text style={[styles.statLabel, { color: c.textTertiary }]}>Total</Text>
              </View>
            </View>
          </View>

          <View style={[styles.launchCard, { backgroundColor: c.card, borderColor: c.cardBorder }]}>
            <Text style={[styles.sectionTitle, { color: c.textPrimary }]}>Launch Session</Text>

            <View style={styles.agentOptions}>
              {AGENT_OPTIONS.map((option) => {
                const active = option.type === agentType;
                return (
                  <Pressable
                    key={option.type}
                    onPress={() => setAgentType(option.type)}
                    style={[
                      styles.agentOption,
                      {
                        backgroundColor: active ? '#eff6ff' : c.subtle,
                        borderColor: active ? '#2383e2' : c.cardBorder,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.agentOptionLabel,
                        { color: active ? '#1d4ed8' : c.textSecondary },
                      ]}
                    >
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <View style={styles.inputWrapper}>
              <Text style={[styles.inputLabel, { color: c.textSecondary }]}>Project Path</Text>
              <Input
                placeholder="/path/to/project"
                value={projectPath}
                onChangeText={setProjectPath}
                onSubmitEditing={startAgent}
                variant="secondary"
              />
            </View>

            <Text style={[styles.agentDesc, { color: c.textTertiary }]}>{selectedAgent.desc}</Text>

            <Button
              variant="primary"
              size="md"
              onPress={startAgent}
              isDisabled={loading || !projectPath.trim() || !connected}
            >
              {loading ? <Spinner size="sm" color="#fff" /> : `Launch ${selectedAgent.label}`}
            </Button>
          </View>

          <View style={styles.fleetHeader}>
            <Text style={[styles.sectionTitle, { color: c.textPrimary }]}>Active Sessions</Text>
            <Text style={[styles.fleetCount, { color: c.textTertiary }]}>{agents.length}</Text>
          </View>
        </View>
      }
      ListEmptyComponent={
        <View style={[styles.emptyCard, { backgroundColor: c.card, borderColor: c.cardBorder }]}>
          <Text style={[styles.emptyText, { color: c.textSecondary }]}>
            No active sessions
          </Text>
        </View>
      }
      renderItem={({ item: agent }) => (
        <AgentRow
          agent={agent}
          onOpen={() => agent.status !== 'stopped' && router.push(`/chat/${agent.id}`)}
          onStop={() => stopAgent(agent.id)}
        />
      )}
    />
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
          backgroundColor: c.card,
          borderColor: c.cardBorder,
          opacity: isStopped ? 0.5 : 1,
        },
      ]}
    >
      <View style={styles.agentLeft}>
        <View style={[styles.agentDot, { backgroundColor: statusColor }]} />
        <View style={styles.agentInfo}>
          <Text style={[styles.agentTitle, { color: c.textPrimary }]}>{label}</Text>
          <Text style={[styles.agentPath, { color: c.textSecondary }]} numberOfLines={1}>
            {agent.projectPath}
          </Text>
        </View>
      </View>
      <View style={styles.agentRight}>
        <Text style={[styles.statusText, { color: statusColor }]}>
          {agent.status.replace('_', ' ')}
        </Text>
        {!isStopped && (
          <Pressable
            onPress={onStop}
            style={[styles.stopButton, { borderColor: '#fecaca' }]}
          >
            <Text style={[styles.stopText, { color: '#dc2626' }]}>Stop</Text>
          </Pressable>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  listContent: {
    padding: 16,
    paddingBottom: 100,
    gap: 12,
  },
  headerContent: {
    gap: 12,
  },
  headerCard: {
    borderRadius: 8,
    borderWidth: 1,
    padding: 16,
    gap: 16,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  title: {
    fontSize: 24,
    fontWeight: '600',
  },
  subtitle: {
    fontSize: 14,
    marginTop: 2,
  },
  connectionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  connectionDot: {
    width: 6,
    height: 6,
    borderRadius: 99,
  },
  connectionText: {
    fontSize: 12,
    fontWeight: '500',
  },
  statsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  statItem: {
    flex: 1,
    borderRadius: 6,
    padding: 12,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 20,
    fontWeight: '600',
  },
  statLabel: {
    fontSize: 12,
    marginTop: 2,
  },
  launchCard: {
    borderRadius: 8,
    borderWidth: 1,
    padding: 16,
    gap: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  agentOptions: {
    flexDirection: 'row',
    gap: 8,
  },
  agentOption: {
    flex: 1,
    borderRadius: 6,
    borderWidth: 1,
    padding: 10,
    alignItems: 'center',
  },
  agentOptionLabel: {
    fontSize: 12,
    fontWeight: '500',
  },
  inputWrapper: {
    gap: 6,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '500',
  },
  agentDesc: {
    fontSize: 13,
  },
  fleetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
  },
  fleetCount: {
    fontSize: 14,
  },
  emptyCard: {
    borderRadius: 8,
    borderWidth: 1,
    borderStyle: 'dashed',
    padding: 24,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 14,
  },
  agentRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    padding: 12,
  },
  agentLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  agentDot: {
    width: 8,
    height: 8,
    borderRadius: 99,
  },
  agentInfo: {
    flex: 1,
  },
  agentTitle: {
    fontSize: 14,
    fontWeight: '500',
  },
  agentPath: {
    fontSize: 12,
    marginTop: 2,
  },
  agentRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '500',
    textTransform: 'capitalize',
  },
  stopButton: {
    borderRadius: 4,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  stopText: {
    fontSize: 12,
    fontWeight: '500',
  },
});