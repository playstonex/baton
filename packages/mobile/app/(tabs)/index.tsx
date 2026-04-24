import { Alert, StyleSheet } from 'react-native';
import { View, Text, FlatList } from 'react-native';
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'expo-router';
import { Button, Card, Chip, Input, Spinner } from 'heroui-native';
import type { AgentProcess, AgentType } from '@baton/shared';
import { useAgentStore } from '../../src/stores/agents';
import { useConnectionStore } from '../../src/stores/connection';
import { wsService } from '../../src/services/websocket';
import { apiFetch } from '../../src/services/api';
import { Colors, STATUS_COLORS } from '../../src/constants/theme';

const AGENT_OPTIONS: { type: AgentType; label: string; icon: string }[] = [
  { type: 'claude-code', label: 'Claude', icon: '\u{1F9E0}' },
  { type: 'codex', label: 'Codex', icon: '\u{1F422}' },
  { type: 'opencode', label: 'OpenCode', icon: '\u{1F527}' },
];

const STATUS_CHIP_COLOR: Record<string, 'success' | 'accent' | 'default' | 'warning' | 'danger'> = {
  running: 'success',
  thinking: 'accent',
  executing: 'default',
  waiting_input: 'warning',
  idle: 'default',
  stopped: 'danger',
  starting: 'default',
  error: 'danger',
};

export default function DashboardScreen() {
  const router = useRouter();
  const agents = useAgentStore((s) => s.agents);
  const setAgents = useAgentStore((s) => s.setAgents);
  const updateAgentStatus = useAgentStore((s) => s.updateAgentStatus);
  const addAgent = useAgentStore((s) => s.addAgent);
  const removeAgent = useAgentStore((s) => s.removeAgent);
  const connected = useConnectionStore((s) => s.connected);
  const [projectPath, setProjectPath] = useState('');
  const [agentType, setAgentType] = useState<AgentType>('claude-code');
  const [loading, setLoading] = useState(false);

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
        setAgents(msg.agents.map((a) => ({ id: a.id, type: a.type as AgentProcess['type'], projectPath: a.projectPath, status: a.status as AgentProcess['status'], startedAt: '' })));
      }
    });
    const unsubStatus = wsService.on('status_update', (msg) => {
      if (msg.type === 'status_update' && 'status' in msg) updateAgentStatus(msg.sessionId, msg.status as AgentProcess['status']);
    });
    return () => { unsubList(); unsubStatus(); };
  }, [fetchAgents, setAgents, updateAgentStatus]);

  async function startAgent() {
    if (!projectPath.trim()) return;
    setLoading(true);
    try {
      const data = await apiFetch<{ sessionId: string }>('/api/agents/start', { method: 'POST', body: JSON.stringify({ agentType, projectPath: projectPath.trim() }) });
      addAgent({ id: data.sessionId, type: agentType, projectPath: projectPath.trim(), status: 'running', startedAt: new Date().toISOString() });
      router.push(`/terminal/${data.sessionId}`);
    } catch (err) { Alert.alert('Error', `Failed: ${err}`); }
    finally { setLoading(false); }
  }

  async function stopAgent(id: string) {
    try { await apiFetch('/api/agents/' + id + '/stop', { method: 'POST' }); removeAgent(id); } catch { /* ignore */ }
  }

  const running = agents.filter((a) => a.status !== 'stopped').length;

  return (
    <View style={styles.container}>
      <View style={styles.heroSection}>
        <View style={styles.heroRow}>
          <View>
            <Text style={styles.heroTitle}>Agents</Text>
            <Text style={styles.heroSubtitle}>{running} running, {agents.length} total</Text>
          </View>
          <Chip variant="soft" color={connected ? 'success' : 'danger'} size="sm">
            {connected ? 'Connected' : 'Offline'}
          </Chip>
        </View>
        <View style={styles.typeRow}>
          {AGENT_OPTIONS.map((opt) => (
            <Button
              key={opt.type}
              variant={agentType === opt.type ? 'primary' : 'secondary'}
              size="sm"
              onPress={() => setAgentType(opt.type)}
              style={{ flex: 1 }}
            >
              {opt.icon} {opt.label}
            </Button>
          ))}
        </View>
        <View style={styles.inputRow}>
          <View style={{ flex: 1 }}>
            <Input
              placeholder="Project path..."
              value={projectPath}
              onChangeText={setProjectPath}
              onSubmitEditing={startAgent}
              variant="secondary"
            />
          </View>
          <Button
            variant="primary"
            size="md"
            onPress={startAgent}
            isDisabled={loading || !projectPath.trim() || !connected}
          >
            {loading ? <Spinner size="sm" color="#fff" /> : 'Launch'}
          </Button>
        </View>
      </View>
      <FlatList data={agents} keyExtractor={(item) => item.id} contentContainerStyle={styles.listContent}
        ListEmptyComponent={<View style={styles.emptyState}><Text style={styles.emptyIcon}>{'\u{1F680}'}</Text><Text style={styles.emptyTitle}>No agents yet</Text><Text style={styles.emptySubtitle}>Enter a project path to launch your first agent</Text></View>}
        renderItem={({ item: agent }) => (
          <Card style={[styles.agentCard, agent.status === 'stopped' && styles.agentCardStopped]}>
            <Card.Body style={styles.agentCardInner}>
              <View style={[styles.agentGlow, { backgroundColor: STATUS_COLORS[agent.status] ?? Colors.surface[400] }]} />
              <View style={styles.agentCardContent}>
                <View style={styles.agentCardTop}>
                  <View style={styles.agentCardLeft}>
                    <View style={[styles.agentDot, { backgroundColor: STATUS_COLORS[agent.status] ?? Colors.surface[400] }]} />
                    <View>
                      <Text style={styles.agentName}>{AGENT_OPTIONS.find((o) => o.type === agent.type)?.label ?? agent.type}</Text>
                      <Text style={styles.agentPath} numberOfLines={1}>{agent.projectPath}</Text>
                    </View>
                  </View>
                  <View style={styles.agentCardRight}>
                    <Chip variant="soft" color={STATUS_CHIP_COLOR[agent.status] ?? 'default'} size="sm">
                      {agent.status}
                    </Chip>
                    {agent.status !== 'stopped' && (
                      <Button variant="danger-soft" size="sm" onPress={() => stopAgent(agent.id)}>
                        Stop
                      </Button>
                    )}
                  </View>
                </View>
              </View>
            </Card.Body>
          </Card>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0f' },
  heroSection: { backgroundColor: '#141419', padding: 16, borderBottomWidth: 1, borderBottomColor: '#1e1e26' },
  heroRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 },
  heroTitle: { fontSize: 24, fontWeight: '800', color: '#fff' },
  heroSubtitle: { fontSize: 12, color: '#9ca3af', marginTop: 2 },
  typeRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  inputRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  listContent: { padding: 16, paddingTop: 4 },
  emptyState: { padding: 48, alignItems: 'center' },
  emptyIcon: { fontSize: 40, marginBottom: 12 },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: '#9ca3af' },
  emptySubtitle: { fontSize: 12, color: '#6b7280', marginTop: 4, textAlign: 'center' },
  agentCard: { marginBottom: 8, overflow: 'hidden' },
  agentCardStopped: { opacity: 0.4 },
  agentCardInner: { position: 'relative', overflow: 'hidden' },
  agentGlow: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3 },
  agentCardContent: { padding: 12, paddingLeft: 19 },
  agentCardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  agentCardLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  agentDot: { width: 10, height: 10, borderRadius: 5 },
  agentName: { fontWeight: '700', fontSize: 14, color: '#fff' },
  agentPath: { fontSize: 10, color: '#6b7280', fontFamily: 'monospace', marginTop: 2 },
  agentCardRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
