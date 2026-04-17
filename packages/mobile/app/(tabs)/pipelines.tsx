import { Alert } from 'react-native';
import { View, Text, TextInput, TouchableOpacity, FlatList, ActivityIndicator } from 'react-native';
import { useState, useEffect, useCallback } from 'react';
import type { AgentType } from '@flowwhips/shared';
import { apiFetch } from '../../src/services/api';

// Generate UUID for React Native
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

interface PipelineStep {
  id: string;
  agentType: AgentType;
  projectPath: string;
}

interface PipelineStepResult {
  stepId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
}

interface Pipeline {
  id: string;
  name: string;
  steps: PipelineStep[];
  status: 'pending' | 'running' | 'completed' | 'failed';
  currentStepIndex: number;
  results: PipelineStepResult[];
}

const AGENT_TYPES: AgentType[] = ['claude-code', 'codex', 'opencode'];
const STATUS_BG: Record<string, string> = { pending: '#f3f4f6', running: '#dbeafe', completed: '#dcfce7', failed: '#fef2f2' };
const STATUS_TEXT: Record<string, string> = { pending: '#6b7280', running: '#3b82f6', completed: '#166534', failed: '#991b1b' };

export default function PipelinesScreen() {
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [name, setName] = useState('');
  const [steps, setSteps] = useState<PipelineStep[]>([{ id: generateUUID(), agentType: 'claude-code', projectPath: '' }]);
  const [creating, setCreating] = useState(false);

  const fetchPipelines = useCallback(async () => {
    try {
      const data = await apiFetch<Pipeline[]>('/api/pipelines');
      setPipelines(data);
    } catch {
      // offline
    }
  }, []);

  useEffect(() => {
    fetchPipelines();
  }, [fetchPipelines]);

  function addStep() {
    setSteps([...steps, { id: generateUUID(), agentType: 'claude-code', projectPath: '' }]);
  }

  function updateStep(index: number, patch: Partial<PipelineStep>) {
    const updated = [...steps];
    updated[index] = { ...updated[index], ...patch };
    setSteps(updated);
  }

  function removeStep(index: number) {
    setSteps(steps.filter((_, i) => i !== index));
  }

  async function createAndRun() {
    if (!name.trim()) return;
    setCreating(true);
    try {
      const pipeline = await apiFetch<Pipeline>('/api/pipelines', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), steps: steps.filter((s) => s.projectPath.trim()) }),
      });
      await apiFetch(`/api/pipelines/${pipeline.id}/run`, { method: 'POST' });
      setName('');
      setSteps([{ id: generateUUID(), agentType: 'claude-code', projectPath: '' }]);
      await fetchPipelines();
    } catch (err) {
      Alert.alert('Error', `Failed: ${err}`);
    } finally {
      setCreating(false);
    }
  }

  async function runPipeline(id: string) {
    await apiFetch(`/api/pipelines/${id}/run`, { method: 'POST' });
    await fetchPipelines();
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#fff' }}>
      <FlatList
        data={pipelines}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16 }}
        ListHeaderComponent={
          <View style={{ marginBottom: 20 }}>
            <Text style={{ fontSize: 20, fontWeight: '700', marginBottom: 12 }}>Pipelines</Text>

            {/* Create form */}
            <View style={{ borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 10, padding: 14, marginBottom: 12 }}>
              <TextInput
                placeholder="Pipeline name"
                value={name}
                onChangeText={setName}
                style={{ padding: 8, borderWidth: 1, borderColor: '#d1d5db', borderRadius: 6, fontSize: 14, marginBottom: 10 }}
              />

              {steps.map((step, i) => (
                <View key={step.id} style={{ flexDirection: 'row', gap: 6, marginBottom: 6, alignItems: 'center' }}>
                  <Text style={{ fontSize: 13, fontWeight: '600', color: '#6b7280', width: 20 }}>{i + 1}.</Text>
                  {AGENT_TYPES.map((t) => (
                    <TouchableOpacity
                      key={t}
                      onPress={() => updateStep(i, { agentType: t })}
                      style={{
                        padding: 4,
                        borderWidth: 1,
                        borderColor: step.agentType === t ? '#2563eb' : '#e5e7eb',
                        borderRadius: 4,
                        backgroundColor: step.agentType === t ? '#eff6ff' : '#fff',
                      }}
                    >
                      <Text style={{ fontSize: 11, color: step.agentType === t ? '#2563eb' : '#374151' }}>{t.split('-')[0]}</Text>
                    </TouchableOpacity>
                  ))}
                  <TextInput
                    placeholder="/path"
                    value={step.projectPath}
                    onChangeText={(v) => updateStep(i, { projectPath: v })}
                    style={{ flex: 1, padding: 4, borderWidth: 1, borderColor: '#d1d5db', borderRadius: 4, fontSize: 12, fontFamily: 'monospace' }}
                  />
                  {steps.length > 1 && (
                    <TouchableOpacity onPress={() => removeStep(i)}>
                      <Text style={{ color: '#dc2626', fontSize: 12 }}>X</Text>
                    </TouchableOpacity>
                  )}
                </View>
              ))}

              <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
                <TouchableOpacity onPress={addStep} style={{ padding: 8, borderWidth: 1, borderColor: '#d1d5db', borderRadius: 6 }}>
                  <Text style={{ fontSize: 13, color: '#374151' }}>+ Step</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={createAndRun}
                  disabled={creating || !name.trim()}
                  style={{ padding: 8, backgroundColor: creating ? '#93c5fd' : '#2563eb', borderRadius: 6, marginLeft: 'auto', paddingHorizontal: 16 }}
                >
                  {creating ? <ActivityIndicator color="#fff" size="small" /> : <Text style={{ color: '#fff', fontWeight: '500' }}>Create & Run</Text>}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        }
        ListEmptyComponent={
          <View style={{ padding: 30, alignItems: 'center', borderWidth: 1, borderColor: '#d1d5db', borderStyle: 'dashed', borderRadius: 10 }}>
            <Text style={{ color: '#9ca3af' }}>No pipelines yet</Text>
          </View>
        }
        renderItem={({ item: p }) => (
          <View style={{ borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 8, padding: 14, marginBottom: 10 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={{ fontWeight: '600', fontSize: 14 }}>{p.name}</Text>
                <Text style={{ fontSize: 11, padding: 2, backgroundColor: STATUS_BG[p.status] ?? '#f3f4f6', color: STATUS_TEXT[p.status] ?? '#666', overflow: 'hidden', borderRadius: 4 }}>
                  {p.status}
                </Text>
              </View>
              {p.status === 'pending' && (
                <TouchableOpacity onPress={() => runPipeline(p.id)} style={{ padding: 4, backgroundColor: '#2563eb', borderRadius: 4, paddingHorizontal: 10 }}>
                  <Text style={{ color: '#fff', fontSize: 12 }}>Run</Text>
                </TouchableOpacity>
              )}
            </View>
            <View style={{ flexDirection: 'row', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
              {p.steps.map((step, i) => {
                const result = p.results[i];
                return (
                  <View key={step.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    {i > 0 && <Text style={{ color: '#d1d5db' }}>→</Text>}
                    <View style={{ padding: 4, borderRadius: 4, backgroundColor: STATUS_BG[result?.status ?? 'pending'] }}>
                      <Text style={{ fontSize: 11, fontWeight: '500' }}>{step.agentType.split('-')[0]}</Text>
                      <Text style={{ fontSize: 10, color: '#9ca3af' }}>{step.projectPath.split('/').pop()}</Text>
                    </View>
                  </View>
                );
              })}
            </View>
          </View>
        )}
      />
    </View>
  );
}
