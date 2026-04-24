import { StyleSheet, Alert } from 'react-native';
import { View, Text, TextInput, FlatList } from 'react-native';
import { useState, useEffect, useCallback } from 'react';
import { Button, Card, Chip, Spinner } from 'heroui-native';
import type { AgentType } from '@baton/shared';
import { apiFetch } from '../../src/services/api';

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

const STEP_CHIP_COLOR: Record<string, 'default' | 'accent' | 'success' | 'danger'> = {
  pending: 'default',
  running: 'accent',
  completed: 'success',
  failed: 'danger',
};

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
    <View style={styles.container}>
      <FlatList
        data={pipelines}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <View style={styles.form}>
            <Text style={styles.formTitle}>Pipelines</Text>

            <Card>
              <Card.Body style={styles.cardContent}>
                <TextInput
                  placeholder="Pipeline name"
                  value={name}
                  onChangeText={setName}
                  placeholderTextColor="#4b5563"
                  style={styles.nameInput}
                />

                {steps.map((step, i) => (
                  <View key={step.id} style={styles.stepRow}>
                    <Text style={styles.stepNumber}>{i + 1}.</Text>
                    {AGENT_TYPES.map((t) => (
                      <Button
                        key={t}
                        variant={step.agentType === t ? 'primary' : 'secondary'}
                        size="sm"
                        onPress={() => updateStep(i, { agentType: t })}
                      >
                        {t.split('-')[0]}
                      </Button>
                    ))}
                    <TextInput
                      placeholder="/path"
                      value={step.projectPath}
                      onChangeText={(v) => updateStep(i, { projectPath: v })}
                      placeholderTextColor="#4b5563"
                      style={styles.pathInput}
                    />
                    {steps.length > 1 && (
                      <Button variant="danger-soft" size="sm" isIconOnly onPress={() => removeStep(i)}>
                        ✕
                      </Button>
                    )}
                  </View>
                ))}

                <View style={styles.formActions}>
                  <Button variant="outline" size="sm" onPress={addStep}>
                    + Step
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    onPress={createAndRun}
                    isDisabled={creating || !name.trim()}
                  >
                    {creating ? <Spinner size="sm" color="#fff" /> : 'Create & Run'}
                  </Button>
                </View>
              </Card.Body>
            </Card>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>No pipelines yet</Text>
            <Text style={styles.emptySubtext}>Create one above to get started</Text>
          </View>
        }
        renderItem={({ item: p }) => {
          const chipColor = STEP_CHIP_COLOR[p.status] ?? 'default';
          return (
            <Card style={{ marginBottom: 8 }}>
              <Card.Body style={{ padding: 14 }}>
                <View style={styles.pipelineHeader}>
                  <View style={styles.pipelineTitleRow}>
                    <Text style={styles.pipelineName}>{p.name}</Text>
                    <Chip variant="soft" color={chipColor} size="sm">
                      {p.status}
                    </Chip>
                  </View>
                  {p.status === 'pending' && (
                    <Button variant="primary" size="sm" onPress={() => runPipeline(p.id)}>
                      Run
                    </Button>
                  )}
                </View>
                <View style={styles.stepFlow}>
                  {p.steps.map((step, i) => {
                    const result = p.results[i];
                    return (
                      <View key={step.id} style={styles.stepFlowItem}>
                        {i > 0 && <Text style={styles.stepArrow}>→</Text>}
                        <Chip variant="soft" color={STEP_CHIP_COLOR[result?.status ?? 'pending']} size="sm">
                          {step.agentType.split('-')[0]}
                        </Chip>
                      </View>
                    );
                  })}
                </View>
              </Card.Body>
            </Card>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0f' },
  listContent: { padding: 16 },
  form: { marginBottom: 24 },
  formTitle: { fontSize: 20, fontWeight: '700', color: '#fff', marginBottom: 12 },
  cardContent: { padding: 14, gap: 10 },
  nameInput: { padding: 10, borderWidth: 1, borderColor: '#1e1e26', borderRadius: 8, fontSize: 14, backgroundColor: '#1a1a22', color: '#fff' },
  stepRow: { flexDirection: 'row', gap: 4, marginBottom: 6, alignItems: 'center' },
  stepNumber: { fontSize: 12, fontWeight: '600', color: '#4b5563', width: 20 },
  pathInput: { flex: 1, paddingVertical: 4, paddingHorizontal: 8, borderWidth: 1, borderColor: '#1e1e26', borderRadius: 6, fontSize: 12, fontFamily: 'monospace', backgroundColor: '#1a1a22', color: '#d1d5db' },
  formActions: { flexDirection: 'row', gap: 8, marginTop: 4 },
  emptyState: { padding: 40, alignItems: 'center', borderWidth: 1, borderColor: '#1e1e26', borderStyle: 'dashed', borderRadius: 12, backgroundColor: '#141419' },
  emptyText: { fontSize: 14, color: '#9ca3af', fontWeight: '500' },
  emptySubtext: { fontSize: 12, color: '#4b5563', marginTop: 4 },
  pipelineHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  pipelineTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pipelineName: { fontWeight: '600', fontSize: 14, color: '#fff' },
  stepFlow: { flexDirection: 'row', gap: 4, alignItems: 'center', flexWrap: 'wrap' },
  stepFlowItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  stepArrow: { color: '#252530', fontSize: 12 },
});
