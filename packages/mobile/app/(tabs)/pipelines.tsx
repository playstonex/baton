import { StyleSheet, Alert } from 'react-native';
import { View, Text, TextInput, FlatList, Pressable } from 'react-native';
import { useState, useEffect, useCallback } from 'react';
import { Button, Card, Chip, Spinner } from 'heroui-native';
import type { AgentType } from '@baton/shared';
import { apiFetch } from '../../src/services/api';

function generateUUID(): string {
  const hex = '0123456789abcdef';
  let uuid = '';
  for (let i = 0; i < 32; i++) {
    if (i === 12) uuid += '4';
    else if (i === 16) uuid += hex[(Math.random() * 4) | 0];
    else uuid += hex[(Math.random() * 16) | 0];
    if (i === 7 || i === 11 || i === 15 || i === 19) uuid += '-';
  }
  return uuid;
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

const STEP_STATUS_COLOR: Record<string, string> = {
  pending: '#71717a',
  running: '#3b82f6',
  completed: '#22c55e',
  failed: '#ef4444',
};

const STEP_CHIP_COLOR: Record<string, 'default' | 'accent' | 'success' | 'danger'> = {
  pending: 'default',
  running: 'accent',
  completed: 'success',
  failed: 'danger',
};

const AGENT_LABELS: Record<string, string> = {
  'claude-code': 'Claude',
  'codex': 'Codex',
  'opencode': 'OpenCode',
};

const BG = '#09090b';
const CARD = '#111113';
const ELEVATED = '#1a1a1e';
const BORDER = 'rgba(255,255,255,0.06)';
const TEXT_PRIMARY = '#f4f4f5';
const TEXT_SECONDARY = '#a1a1aa';
const TEXT_MUTED = '#71717a';

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
            <Text style={styles.formSubtitle}>Chain multiple agents in sequence</Text>

            <View style={styles.formCard}>
              <TextInput
                placeholder="Pipeline name"
                value={name}
                onChangeText={setName}
                placeholderTextColor={TEXT_MUTED}
                style={styles.nameInput}
              />

              <View style={styles.stepsContainer}>
                {steps.map((step, i) => (
                  <View key={step.id}>
                    <View style={styles.stepRow}>
                      <View style={styles.stepNumberCircle}>
                        <Text style={styles.stepNumberText}>{i + 1}</Text>
                      </View>
                      <View style={styles.stepContent}>
                        <View style={styles.stepTypeRow}>
                          {AGENT_TYPES.map((t) => {
                            const active = step.agentType === t;
                            return (
                              <Pressable
                                key={t}
                                onPress={() => updateStep(i, { agentType: t })}
                                style={[styles.stepTypePill, active && styles.stepTypePillActive]}
                              >
                                <Text style={[styles.stepTypeLabel, active && styles.stepTypeLabelActive]}>
                                  {AGENT_LABELS[t] ?? t.split('-')[0]}
                                </Text>
                              </Pressable>
                            );
                          })}
                        </View>
                        <TextInput
                          placeholder="/path/to/project"
                          value={step.projectPath}
                          onChangeText={(v) => updateStep(i, { projectPath: v })}
                          placeholderTextColor={TEXT_MUTED}
                          style={styles.pathInput}
                        />
                      </View>
                      {steps.length > 1 && (
                        <Pressable onPress={() => removeStep(i)} style={styles.removeStepButton}>
                          <Text style={styles.removeStepText}>{'\u{2715}'}</Text>
                        </Pressable>
                      )}
                    </View>
                    {i < steps.length - 1 && (
                      <View style={styles.stepConnector}>
                        <View style={styles.stepConnectorLine} />
                        <Text style={styles.stepConnectorArrow}>{'\u{25BC}'}</Text>
                      </View>
                    )}
                  </View>
                ))}
              </View>

              <View style={styles.formActions}>
                <Pressable onPress={addStep} style={styles.addStepButton}>
                  <Text style={styles.addStepText}>+ Add Step</Text>
                </Pressable>
                <Pressable
                  onPress={createAndRun}
                  style={[styles.createButton, (creating || !name.trim()) && styles.createButtonDisabled]}
                  disabled={creating || !name.trim()}
                >
                  {creating ? <Spinner size="sm" color="#fff" /> : (
                    <Text style={styles.createButtonText}>Create & Run</Text>
                  )}
                </Pressable>
              </View>
            </View>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>{'\u{1F517}'}</Text>
            <Text style={styles.emptyText}>No pipelines yet</Text>
            <Text style={styles.emptySubtext}>Create one above to get started</Text>
          </View>
        }
        renderItem={({ item: p }) => {
          const statusColor = STEP_STATUS_COLOR[p.status] ?? TEXT_MUTED;
          return (
            <View style={styles.pipelineCard}>
              <View style={styles.pipelineHeader}>
                <View style={styles.pipelineTitleRow}>
                  <Text style={styles.pipelineName}>{p.name}</Text>
                  <View style={[styles.pipelineStatusChip, { backgroundColor: statusColor + '18' }]}>
                    <View style={[styles.pipelineStatusDot, { backgroundColor: statusColor }]} />
                    <Text style={[styles.pipelineStatusText, { color: statusColor }]}>{p.status}</Text>
                  </View>
                </View>
                {p.status === 'pending' && (
                  <Pressable onPress={() => runPipeline(p.id)} style={styles.runButton}>
                    <Text style={styles.runButtonText}>Run</Text>
                  </Pressable>
                )}
              </View>
              <View style={styles.stepFlow}>
                {p.steps.map((step, i) => {
                  const result = p.results[i];
                  const color = STEP_STATUS_COLOR[result?.status ?? 'pending'] ?? TEXT_MUTED;
                  return (
                    <View key={step.id} style={styles.stepFlowItem}>
                      {i > 0 && (
                        <View style={styles.flowConnector}>
                          <View style={styles.flowLine} />
                          <Text style={styles.flowArrow}>{'\u{2192}'}</Text>
                        </View>
                      )}
                      <View style={[styles.flowStepCircle, { borderColor: color }]}>
                        <Text style={[styles.flowStepText, { color }]}>{i + 1}</Text>
                      </View>
                      <View style={styles.flowStepInfo}>
                        <Text style={styles.flowStepName}>{AGENT_LABELS[step.agentType] ?? step.agentType.split('-')[0]}</Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            </View>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  listContent: { padding: 16 },
  form: { marginBottom: 24 },
  formTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: TEXT_PRIMARY,
    letterSpacing: -0.5,
  },
  formSubtitle: {
    fontSize: 13,
    color: TEXT_MUTED,
    marginTop: 4,
    marginBottom: 16,
  },
  formCard: {
    backgroundColor: CARD,
    borderRadius: 16,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: BORDER,
    padding: 16,
    gap: 14,
  },
  nameInput: {
    padding: 12,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 10,
    borderCurve: 'continuous',
    fontSize: 14,
    fontWeight: '600',
    backgroundColor: ELEVATED,
    color: TEXT_PRIMARY,
  },
  stepsContainer: {
    gap: 4,
  },
  stepRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
  },
  stepNumberCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#3b82f618',
    borderWidth: 1,
    borderColor: '#3b82f640',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  stepNumberText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#3b82f6',
  },
  stepContent: {
    flex: 1,
    gap: 6,
  },
  stepTypeRow: {
    flexDirection: 'row',
    gap: 4,
  },
  stepTypePill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderCurve: 'continuous',
    backgroundColor: ELEVATED,
    minHeight: 28,
    justifyContent: 'center',
  },
  stepTypePillActive: {
    backgroundColor: '#3b82f618',
    borderWidth: 1,
    borderColor: '#3b82f6',
  },
  stepTypeLabel: {
    fontSize: 11,
    fontWeight: '500',
    color: TEXT_MUTED,
  },
  stepTypeLabelActive: {
    color: '#3b82f6',
    fontWeight: '600',
  },
  pathInput: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 8,
    borderCurve: 'continuous',
    fontSize: 12,
    fontFamily: 'monospace',
    backgroundColor: ELEVATED,
    color: TEXT_SECONDARY,
    fontWeight: '500',
  },
  removeStepButton: {
    width: 28,
    height: 28,
    borderRadius: 8,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(239,68,68,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  removeStepText: {
    fontSize: 12,
    color: '#f87171',
    fontWeight: '600',
  },
  stepConnector: {
    alignItems: 'center',
    paddingVertical: 4,
    paddingLeft: 10,
  },
  stepConnectorLine: {
    width: 1,
    height: 8,
    backgroundColor: BORDER,
  },
  stepConnectorArrow: {
    fontSize: 8,
    color: TEXT_MUTED,
  },
  formActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  addStepButton: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: ELEVATED,
    minHeight: 44,
    justifyContent: 'center',
  },
  addStepText: {
    fontSize: 13,
    fontWeight: '600',
    color: TEXT_SECONDARY,
  },
  createButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    borderCurve: 'continuous',
    backgroundColor: '#3b82f6',
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  createButtonDisabled: {
    opacity: 0.4,
  },
  createButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
  },
  emptyState: {
    padding: 48,
    alignItems: 'center',
    backgroundColor: CARD,
    borderRadius: 16,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: BORDER,
    borderStyle: 'dashed',
  },
  emptyIcon: {
    fontSize: 36,
    marginBottom: 10,
  },
  emptyText: {
    fontSize: 15,
    color: TEXT_SECONDARY,
    fontWeight: '600',
  },
  emptySubtext: {
    fontSize: 12,
    color: TEXT_MUTED,
    marginTop: 4,
  },
  pipelineCard: {
    backgroundColor: CARD,
    borderRadius: 14,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: BORDER,
    padding: 16,
    marginBottom: 10,
    boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
  },
  pipelineHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  pipelineTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  pipelineName: {
    fontWeight: '700',
    fontSize: 15,
    color: TEXT_PRIMARY,
    letterSpacing: -0.2,
  },
  pipelineStatusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderCurve: 'continuous',
  },
  pipelineStatusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  pipelineStatusText: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  runButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderCurve: 'continuous',
    backgroundColor: '#3b82f6',
    minHeight: 32,
    justifyContent: 'center',
  },
  runButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#fff',
  },
  stepFlow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 0,
  },
  stepFlowItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  flowConnector: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginHorizontal: 4,
  },
  flowLine: {
    width: 12,
    height: 1,
    backgroundColor: BORDER,
  },
  flowArrow: {
    fontSize: 10,
    color: TEXT_MUTED,
  },
  flowStepCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flowStepText: {
    fontSize: 10,
    fontWeight: '700',
  },
  flowStepInfo: {
    marginRight: 4,
  },
  flowStepName: {
    fontSize: 11,
    fontWeight: '500',
    color: TEXT_SECONDARY,
  },
});
