import { Alert } from 'react-native';
import { View, Text, TextInput, TouchableOpacity, FlatList, ActivityIndicator } from 'react-native';
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'expo-router';
import type { AgentProcess, AgentType } from '@flowwhips/shared';
import { useAgentStore } from '../../src/stores/agents';
import { useConnectionStore } from '../../src/stores/connection';
import { wsService } from '../../src/services/websocket';
import { apiFetch } from '../../src/services/api';
import { STATUS_COLORS } from '../../src/constants/colors';

const AGENT_OPTIONS: { type: AgentType; label: string }[] = [
  { type: 'claude-code', label: 'Claude Code' },
  { type: 'codex', label: 'Codex' },
  { type: 'opencode', label: 'OpenCode' },
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
        setAgents(
          msg.agents.map((a) => ({
            id: a.id,
            type: a.type as AgentProcess['type'],
            projectPath: a.projectPath,
            status: a.status as AgentProcess['status'],
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
      router.push(`/terminal/${data.sessionId}`);
    } catch (err) {
      Alert.alert('Error', `Failed: ${err}`);
    } finally {
      setLoading(false);
    }
  }

  async function stopAgent(id: string) {
    try {
      await apiFetch('/api/agents/' + id + '/stop', { method: 'POST' });
      removeAgent(id);
    } catch {
      // ignore
    }
  }

  const running = agents.filter((a) => a.status !== 'stopped').length;

  return (
    <View style={{ flex: 1, backgroundColor: '#fff' }}>
      <View style={{ padding: 16 }}>
        {/* Connection status */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <Text style={{ fontSize: 20, fontWeight: '700' }}>Dashboard</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={{ fontSize: 12, color: '#6b7280' }}>{running} running / {agents.length} total</Text>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: connected ? '#22c55e' : '#ef4444' }} />
          </View>
        </View>

        {/* Agent type selector */}
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
          {AGENT_OPTIONS.map((opt) => (
            <TouchableOpacity
              key={opt.type}
              onPress={() => setAgentType(opt.type)}
              style={{
                flex: 1,
                padding: 10,
                borderRadius: 8,
                borderWidth: 1,
                borderColor: agentType === opt.type ? '#2563eb' : '#e5e7eb',
                backgroundColor: agentType === opt.type ? '#eff6ff' : '#f9fafb',
                alignItems: 'center',
              }}
            >
              <Text style={{ fontSize: 13, fontWeight: agentType === opt.type ? '600' : '400', color: agentType === opt.type ? '#2563eb' : '#374151' }}>
                {opt.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Start agent */}
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TextInput
            placeholder="/path/to/project"
            value={projectPath}
            onChangeText={setProjectPath}
            onSubmitEditing={startAgent}
            style={{
              flex: 1,
              padding: 10,
              borderWidth: 1,
              borderColor: '#d1d5db',
              borderRadius: 8,
              fontSize: 14,
              fontFamily: 'monospace',
            }}
          />
          <TouchableOpacity
            onPress={startAgent}
            disabled={loading || !projectPath.trim() || !connected}
            style={{
              paddingVertical: 10,
              paddingHorizontal: 16,
              backgroundColor: loading || !connected ? '#93c5fd' : '#2563eb',
              borderRadius: 8,
              justifyContent: 'center',
            }}
          >
            {loading ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={{ color: '#fff', fontWeight: '500', fontSize: 14 }}>Start</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>

      {/* Agent list */}
      <FlatList
        data={agents}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16, paddingTop: 0 }}
        ListEmptyComponent={
          <View style={{ padding: 40, alignItems: 'center' }}>
            <Text style={{ color: '#9ca3af' }}>No agents running</Text>
          </View>
        }
        renderItem={({ item: agent }) => (
          <TouchableOpacity
            onPress={() => router.push(`/agent/${agent.id}`)}
            style={{
              padding: 14,
              borderWidth: 1,
              borderColor: '#e5e7eb',
              borderRadius: 8,
              marginBottom: 8,
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              opacity: agent.status === 'stopped' ? 0.6 : 1,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
              <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: STATUS_COLORS[agent.status] ?? '#94a3b8' }} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: '500', fontSize: 14 }}>{agent.type}</Text>
                <Text style={{ fontSize: 12, color: '#6b7280', fontFamily: 'monospace' }} numberOfLines={1}>{agent.projectPath}</Text>
              </View>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={{ fontSize: 11, padding: 2, backgroundColor: '#f3f4f6', borderRadius: 4, overflow: 'hidden', color: '#6b7280' }}>
                {agent.status}
              </Text>
              {agent.status !== 'stopped' && (
                <TouchableOpacity onPress={() => stopAgent(agent.id)} style={{ padding: 4 }}>
                  <Text style={{ fontSize: 11, color: '#dc2626' }}>Stop</Text>
                </TouchableOpacity>
              )}
            </View>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}
