import { View, Text, TextInput, FlatList, Pressable, Alert, ActivityIndicator } from 'react-native';
import { useState, useEffect, useCallback } from 'react';
import type { AgentType } from '@baton/shared';
import { apiFetch } from '../../src/services/api';
import { useThemeColors } from '../../src/hooks/useThemeColors';
import { Typography, Spacing, CornerRadius, Colors } from '../../src/constants/theme';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLayoutStore } from '../../src/stores/layout';
import {
  GlassCard,
  GlassSectionHeader,
  GlassButton,
  GlassPill,
} from '../../src/components/GlassKit';

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

const AGENT_TYPES: AgentType[] = ['claude-code', 'codex', 'opencode', 'kiro-cli', 'kiro-cli-acp'];

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
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <FlatList
        data={pipelines}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{
          paddingHorizontal: Spacing.lg,
          paddingTop: headerHeight + Spacing.lg,
          paddingBottom: insets.bottom + tabBarHeight + Spacing.lg,
        }}
        ListHeaderComponent={
          <View style={{ marginBottom: Spacing.md }}>
            <Text style={[Typography.largeTitle, { color: c.textPrimary }]}>Pipelines</Text>
            <Text style={[Typography.footnote, { color: c.textTertiary, marginTop: Spacing.xs }]}>
              Chain multiple agents in sequence
            </Text>

            <GlassCard c={c} style={{ marginTop: Spacing.lg }}>
              <TextInput
                placeholder="Pipeline name"
                value={name}
                onChangeText={setName}
                placeholderTextColor={c.textTertiary}
                style={{
                  backgroundColor: c.isDark ? 'rgba(58,58,60,0.55)' : c.elevated,
                  borderWidth: 1,
                  borderColor: c.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(60,60,67,0.04)',
                  borderRadius: CornerRadius.medium,
                  paddingVertical: Spacing.md,
                  paddingHorizontal: Spacing.md,
                  color: c.textPrimary,
                  ...Typography.subhead,
                  fontWeight: '500',
                }}
              />

              <View style={{ gap: Spacing.xs }}>
                {steps.map((step, i) => (
                  <View key={step.id}>
                    <View style={{ flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start' }}>
                      <View
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: 14,
                          borderWidth: 1,
                          alignItems: 'center',
                          justifyContent: 'center',
                          marginTop: Spacing.xs,
                          backgroundColor: c.accentBg,
                          borderColor: c.accentBorder,
                        }}
                      >
                        <Text style={[Typography.caption1, { color: Colors.primary[500], fontWeight: '700' }]}>
                          {i + 1}
                        </Text>
                      </View>
                      <View style={{ flex: 1, gap: Spacing.sm }}>
                        <View style={{ flexDirection: 'row', gap: Spacing.xs }}>
                          {AGENT_TYPES.map((t) => {
                            const active = step.agentType === t;
                            return (
                              <GlassPill
                                key={t}
                                c={c}
                                label={AGENT_LABELS[t] ?? t.split('-')[0]}
                                active={active}
                                onPress={() => updateStep(i, { agentType: t })}
                              />
                            );
                          })}
                        </View>
                        <TextInput
                          placeholder="/path/to/project"
                          value={step.projectPath}
                          onChangeText={(v) => updateStep(i, { projectPath: v })}
                          placeholderTextColor={c.textTertiary}
                          style={{
                            backgroundColor: c.isDark ? 'rgba(58,58,60,0.55)' : c.elevated,
                            borderWidth: 1,
                            borderColor: c.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(60,60,67,0.04)',
                            borderRadius: CornerRadius.medium,
                            paddingVertical: Spacing.sm + 2,
                            paddingHorizontal: Spacing.md,
                            color: c.textSecondary,
                            ...Typography.footnote,
                            fontFamily: 'monospace',
                            fontWeight: '500',
                          }}
                        />
                      </View>
                      {steps.length > 1 && (
                        <Pressable
                          onPress={() => removeStep(i)}
                          style={{
                            width: 28,
                            height: 28,
                            borderRadius: CornerRadius.small,
                            alignItems: 'center',
                            justifyContent: 'center',
                            marginTop: Spacing.xs,
                            backgroundColor: c.dangerBg,
                          }}
                        >
                          <Text style={[Typography.caption1, { color: Colors.danger[400], fontWeight: '600' }]}>
                            {'\u{2715}'}
                          </Text>
                        </Pressable>
                      )}
                    </View>
                    {i < steps.length - 1 && (
                      <View style={{ alignItems: 'center', paddingVertical: Spacing.xs, paddingLeft: 10 }}>
                        <View style={{ width: 1, height: Spacing.sm, backgroundColor: c.separator }} />
                        <Text style={[Typography.caption2, { color: c.textTertiary }]}>
                          {'\u{25BC}'}
                        </Text>
                      </View>
                    )}
                  </View>
                ))}
              </View>

              <View style={{ flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.xs }}>
                <GlassButton
                  c={c}
                  label="+ Add Step"
                  onPress={addStep}
                  variant="secondary"
                />
                <GlassButton
                  c={c}
                  label={creating ? '' : 'Create & Run'}
                  onPress={createAndRun}
                  disabled={creating || !name.trim()}
                  loading={creating}
                  variant="primary"
                />
              </View>
            </GlassCard>

            {pipelines.length > 0 && (
              <GlassSectionHeader c={c} title="History" />
            )}
          </View>
        }
        ListEmptyComponent={
          pipelines.length === 0 ? (
            <View style={{ paddingVertical: Spacing['3xl'], alignItems: 'center' }}>
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
            <GlassCard c={c} style={{ marginBottom: Spacing.sm }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flex: 1 }}>
                  <Text style={[Typography.headline, { color: c.textPrimary, flexShrink: 1 }]} numberOfLines={1}>
                    {p.name}
                  </Text>
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: Spacing.xs,
                      paddingHorizontal: Spacing.sm,
                      paddingVertical: 3,
                      borderRadius: CornerRadius.small,
                      backgroundColor: statusColor + '18',
                    }}
                  >
                    <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: statusColor }} />
                    <Text style={[Typography.caption1, { color: statusColor, fontWeight: '600' }]}>
                      {p.status}
                    </Text>
                  </View>
                </View>
                {p.status === 'pending' && (
                  <Pressable
                    onPress={() => runPipeline(p.id)}
                    style={{
                      paddingHorizontal: Spacing.md,
                      paddingVertical: Spacing.xs + 2,
                      borderRadius: CornerRadius.small,
                      backgroundColor: Colors.primary[500],
                      minHeight: 32,
                      justifyContent: 'center',
                      alignItems: 'center',
                    }}
                  >
                    <Text style={[Typography.footnote, { color: '#fff', fontWeight: '600' }]}>
                      Run
                    </Text>
                  </Pressable>
                )}
              </View>

              <View style={{ flexDirection: 'row', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                {p.steps.map((step, i) => {
                  const result = p.results[i];
                  const color = STEP_STATUS_COLOR[result?.status ?? 'pending'] ?? c.textTertiary;
                  return (
                    <View key={step.id} style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
                      {i > 0 && (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2, marginHorizontal: Spacing.xs, height: 24 }}>
                          <View style={{ width: Spacing.md, height: 1, backgroundColor: c.separator }} />
                          <Text style={[Typography.caption2, { color: c.textTertiary }]}>
                            {'\u{2192}'}
                          </Text>
                        </View>
                      )}
                      <View style={{ alignItems: 'center' }}>
                        <View style={{ width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, borderColor: color, alignItems: 'center', justifyContent: 'center' }}>
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
            </GlassCard>
          );
        }}
      />
    </View>
  );
}
