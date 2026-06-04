import { StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { View, Text, TextInput, FlatList, Pressable } from 'react-native';
import { useState, useEffect, useCallback } from 'react';
import type { AgentType } from '@baton/shared';
import { apiFetch } from '../../src/services/api';
import { useThemeColors } from '../../src/hooks/useThemeColors';
import { Typography, Spacing, CornerRadius, iOSGroupedRadius, Colors } from '../../src/constants/theme';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLayoutStore } from '../../src/stores/layout';

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

const AGENT_TYPES: AgentType[] = ['claude-code', 'codex', 'opencode', 'kiro-cli'];

const STEP_STATUS_COLOR: Record<string, string> = {
  pending: '#71717a',
  running: Colors.primary[500],
  completed: Colors.success[400],
  failed: Colors.danger[400],
};

const AGENT_LABELS: Record<string, string> = {
  'claude-code': 'Claude',
  codex: 'Codex',
  opencode: 'OpenCode',
};

export default function PipelinesScreen() {
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [name, setName] = useState('');
  const [steps, setSteps] = useState<PipelineStep[]>([
    { id: generateUUID(), agentType: 'claude-code', projectPath: '' },
  ]);
  const [creating, setCreating] = useState(false);
  const c = useThemeColors();
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const tabBarHeight = useLayoutStore((s) => s.tabBarHeight);

  const fetchPipelines = useCallback(async () => {
    try {
      const data = await apiFetch<Pipeline[]>('/api/pipelines');
      setPipelines(data);
    } catch {}
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
        body: JSON.stringify({
          name: name.trim(),
          steps: steps.filter((s) => s.projectPath.trim()),
        }),
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
    <View style={[styles.container, { backgroundColor: c.bg }]}>
      <FlatList
        data={pipelines}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[styles.listContent, { paddingTop: headerHeight + Spacing.lg, paddingBottom: insets.bottom + tabBarHeight + Spacing.lg }]}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={[Typography.largeTitle, { color: c.textPrimary }]}>Pipelines</Text>
            <Text style={[Typography.footnote, { color: c.textTertiary, marginTop: Spacing.xs }]}>
              Chain multiple agents in sequence
            </Text>

            <View
              style={[
                styles.formCard,
                { backgroundColor: c.card, borderColor: c.cardBorder, marginTop: Spacing.lg },
              ]}
            >
              <TextInput
                placeholder="Pipeline name"
                value={name}
                onChangeText={setName}
                placeholderTextColor={c.textTertiary}
                style={[
                  styles.nameInput,
                  {
                    backgroundColor: c.inputBg,
                    borderColor: c.inputBorder,
                    color: c.textPrimary,
                  },
                ]}
              />

              <View style={styles.stepsContainer}>
                {steps.map((step, i) => (
                  <View key={step.id}>
                    <View style={styles.stepRow}>
                      <View
                        style={[
                          styles.stepNumberCircle,
                          { backgroundColor: c.accentBg, borderColor: c.accentBorder },
                        ]}
                      >
                        <Text style={[Typography.caption1, { color: Colors.primary[500], fontWeight: '700' }]}>
                          {i + 1}
                        </Text>
                      </View>
                      <View style={styles.stepContent}>
                        <View style={styles.stepTypeRow}>
                          {AGENT_TYPES.map((t) => {
                            const active = step.agentType === t;
                            return (
                              <Pressable
                                key={t}
                                onPress={() => updateStep(i, { agentType: t })}
                                style={[
                                  styles.stepTypePill,
                                  {
                                    backgroundColor: active ? c.accentBg : c.elevated,
                                    borderColor: active ? c.accentBorder : 'transparent',
                                  },
                                ]}
                              >
                                <Text
                                  style={[
                                    Typography.caption1,
                                    {
                                      color: active ? Colors.primary[500] : c.textTertiary,
                                      fontWeight: active ? '600' : '400',
                                    },
                                  ]}
                                >
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
                          placeholderTextColor={c.textTertiary}
                          style={[
                            styles.pathInput,
                            {
                              backgroundColor: c.inputBg,
                              borderColor: c.inputBorder,
                              color: c.textSecondary,
                            },
                          ]}
                        />
                      </View>
                      {steps.length > 1 && (
                        <Pressable
                          onPress={() => removeStep(i)}
                          style={[styles.removeStepButton, { backgroundColor: c.dangerBg }]}
                        >
                          <Text style={[Typography.caption1, { color: Colors.danger[400], fontWeight: '600' }]}>
                            {'\u{2715}'}
                          </Text>
                        </Pressable>
                      )}
                    </View>
                    {i < steps.length - 1 && (
                      <View style={styles.stepConnector}>
                        <View style={[styles.stepConnectorLine, { backgroundColor: c.separator }]} />
                        <Text style={[Typography.caption2, { color: c.textTertiary }]}>
                          {'\u{25BC}'}
                        </Text>
                      </View>
                    )}
                  </View>
                ))}
              </View>

              <View style={styles.formActions}>
                <Pressable
                  onPress={addStep}
                  style={[
                    styles.addStepButton,
                    { backgroundColor: c.elevated, borderColor: c.cardBorder },
                  ]}
                >
                  <Text style={[Typography.subhead, { color: c.textSecondary, fontWeight: '500' }]}>
                    + Add Step
                  </Text>
                </Pressable>
                <Pressable
                  onPress={createAndRun}
                  style={[
                    styles.createButton,
                    {
                      backgroundColor: creating || !name.trim() ? Colors.primary[500] + '40' : Colors.primary[500],
                    },
                  ]}
                  disabled={creating || !name.trim()}
                >
                  {creating ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={[Typography.subhead, { color: '#fff', fontWeight: '600' }]}>
                      Create & Run
                    </Text>
                  )}
                </Pressable>
              </View>
            </View>

            {pipelines.length > 0 && (
              <Text
                style={[
                  Typography.headline,
                  { color: c.textPrimary, marginTop: Spacing.xl, marginBottom: Spacing.sm },
                ]}
              >
                History
              </Text>
            )}
          </View>
        }
        ListEmptyComponent={
          pipelines.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={[Typography.subhead, { color: c.textSecondary }]}>No pipelines</Text>
              <Text style={[Typography.footnote, { color: c.textTertiary, marginTop: Spacing.xs }]}>
                Create one above to get started
              </Text>
            </View>
          ) : null
        }
        renderItem={({ item: p }) => {
          const statusColor = STEP_STATUS_COLOR[p.status] ?? c.textTertiary;
          return (
            <View
              style={[
                styles.pipelineCard,
                { backgroundColor: c.card, borderColor: c.cardBorder },
              ]}
            >
              <View style={styles.pipelineHeader}>
                <View style={styles.pipelineTitleRow}>
                  <Text style={[Typography.headline, { color: c.textPrimary, flexShrink: 1 }]} numberOfLines={1}>
                    {p.name}
                  </Text>
                  <View
                    style={[
                      styles.pipelineStatusChip,
                      { backgroundColor: statusColor + '18' },
                    ]}
                  >
                    <View style={[styles.pipelineStatusDot, { backgroundColor: statusColor }]} />
                    <Text style={[Typography.caption1, { color: statusColor, fontWeight: '600' }]}>
                      {p.status}
                    </Text>
                  </View>
                </View>
                {p.status === 'pending' && (
                  <Pressable
                    onPress={() => runPipeline(p.id)}
                    style={[styles.runButton, { backgroundColor: Colors.primary[500] }]}
                  >
                    <Text style={[Typography.footnote, { color: '#fff', fontWeight: '600' }]}>
                      Run
                    </Text>
                  </Pressable>
                )}
              </View>

              <View style={styles.stepFlow}>
                {p.steps.map((step, i) => {
                  const result = p.results[i];
                  const color = STEP_STATUS_COLOR[result?.status ?? 'pending'] ?? c.textTertiary;
                  return (
                    <View key={step.id} style={styles.stepFlowItem}>
                      {i > 0 && (
                        <View style={styles.flowConnector}>
                          <View style={[styles.flowLine, { backgroundColor: c.separator }]} />
                          <Text style={[Typography.caption2, { color: c.textTertiary }]}>
                            {'\u{2192}'}
                          </Text>
                        </View>
                      )}
                      <View style={styles.flowStepColumn}>
                        <View style={[styles.flowStepCircle, { borderColor: color }]}>
                          <Text style={[Typography.caption2, { color, fontWeight: '700' }]}>
                            {i + 1}
                          </Text>
                        </View>
                        <Text style={[Typography.caption2, { color: c.textSecondary, marginTop: 2 }]}>
                          {AGENT_LABELS[step.agentType] ?? step.agentType.split('-')[0]}
                        </Text>
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
  container: { flex: 1 },
  listContent: {
    paddingHorizontal: Spacing.lg,
  },
  header: {
    marginBottom: Spacing.md,
  },
  formCard: {
    borderRadius: iOSGroupedRadius,
    borderCurve: 'continuous',
    borderWidth: 1,
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  nameInput: {
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    borderWidth: 1,
    borderRadius: CornerRadius.medium,
    borderCurve: 'continuous',
    ...Typography.subhead,
    fontWeight: '500',
  },
  stepsContainer: {
    gap: Spacing.xs,
  },
  stepRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    alignItems: 'flex-start',
  },
  stepNumberCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.xs,
  },
  stepContent: {
    flex: 1,
    gap: Spacing.sm,
  },
  stepTypeRow: {
    flexDirection: 'row',
    gap: Spacing.xs,
  },
  stepTypePill: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs + 1,
    borderRadius: CornerRadius.small,
    borderCurve: 'continuous',
    borderWidth: 1,
    minHeight: 28,
    justifyContent: 'center',
  },
  pathInput: {
    paddingVertical: Spacing.sm + 2,
    paddingHorizontal: Spacing.md,
    borderWidth: 1,
    borderRadius: CornerRadius.medium,
    borderCurve: 'continuous',
    ...Typography.footnote,
    fontFamily: 'monospace',
    fontWeight: '500',
  },
  removeStepButton: {
    width: 28,
    height: 28,
    borderRadius: CornerRadius.small,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.xs,
  },
  stepConnector: {
    alignItems: 'center',
    paddingVertical: Spacing.xs,
    paddingLeft: 10,
  },
  stepConnectorLine: {
    width: 1,
    height: Spacing.sm,
  },
  formActions: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: Spacing.xs,
  },
  addStepButton: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderRadius: CornerRadius.medium,
    borderCurve: 'continuous',
    borderWidth: 1,
    minHeight: 44,
    justifyContent: 'center',
  },
  createButton: {
    flex: 1,
    paddingVertical: Spacing.md,
    borderRadius: CornerRadius.medium,
    borderCurve: 'continuous',
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyState: {
    paddingVertical: Spacing['3xl'],
    alignItems: 'center',
  },
  pipelineCard: {
    borderRadius: iOSGroupedRadius,
    borderCurve: 'continuous',
    borderWidth: 1,
    padding: Spacing.lg,
    marginBottom: Spacing.sm,
    gap: Spacing.md,
  },
  pipelineHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  pipelineTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    flex: 1,
  },
  pipelineStatusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
    borderRadius: CornerRadius.small,
    borderCurve: 'continuous',
  },
  pipelineStatusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  runButton: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs + 2,
    borderRadius: CornerRadius.small,
    borderCurve: 'continuous',
    minHeight: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stepFlow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    flexWrap: 'wrap',
  },
  stepFlowItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  flowConnector: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginHorizontal: Spacing.xs,
    height: 24,
  },
  flowLine: {
    width: Spacing.md,
    height: 1,
  },
  flowStepColumn: {
    alignItems: 'center',
  },
  flowStepCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
