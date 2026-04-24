import { useState, useEffect, useCallback } from 'react';
import { Button, Card, CardContent, Input, Chip } from '@heroui/react';
import type { AgentType } from '@baton/shared';

interface PipelineStep {
  id: string;
  agentType: AgentType;
  projectPath: string;
  args?: string[];
  env?: Record<string, string>;
}

interface PipelineStepResult {
  stepId: string;
  sessionId?: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  events: Array<{ type: string; timestamp: number }>;
  startedAt?: string;
  completedAt?: string;
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
  skipped: 'default',
};

export function PipelinesScreen() {
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newSteps, setNewSteps] = useState<PipelineStep[]>([
    { id: crypto.randomUUID(), agentType: 'claude-code', projectPath: '' },
  ]);

  const fetchPipelines = useCallback(async () => {
    try {
      const res = await fetch('/api/pipelines');
      if (res.ok) setPipelines((await res.json()) as Pipeline[]);
    } catch {
      // offline
    }
  }, []);

  useEffect(() => {
    fetchPipelines();
  }, [fetchPipelines]);

  function addStep() {
    setNewSteps([...newSteps, { id: crypto.randomUUID(), agentType: 'claude-code', projectPath: '' }]);
  }

  function updateStep(index: number, patch: Partial<PipelineStep>) {
    const updated = [...newSteps];
    updated[index] = { ...updated[index], ...patch };
    setNewSteps(updated);
  }

  function removeStep(index: number) {
    setNewSteps(newSteps.filter((_, i) => i !== index));
  }

  async function createPipeline() {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const res = await fetch('/api/pipelines', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), steps: newSteps.filter((s) => s.projectPath.trim()) }),
      });
      if (res.ok) {
        const pipeline = (await res.json()) as Pipeline;
        setNewName('');
        setNewSteps([{ id: crypto.randomUUID(), agentType: 'claude-code', projectPath: '' }]);
        await fetchPipelines();
        runPipeline(pipeline.id);
      }
    } finally {
      setCreating(false);
    }
  }

  async function runPipeline(id: string) {
    await fetch(`/api/pipelines/${id}/run`, { method: 'POST' });
    const interval = setInterval(async () => {
      await fetchPipelines();
      const p = pipelines.find((p) => p.id === id);
      if (p && p.status !== 'running') clearInterval(interval);
    }, 1000);
  }

  const PIPELINE_STATUS_COLOR: Record<string, 'default' | 'accent' | 'success' | 'danger'> = {
    pending: 'default',
    running: 'accent',
    completed: 'success',
    failed: 'danger',
  };

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <h2 className="text-xl font-bold text-surface-900 dark:text-white">Pipelines</h2>

      <Card>
        <CardContent className="p-5">
          <h3 className="mb-3 text-sm font-semibold text-surface-900 dark:text-white">New Pipeline</h3>

          <div className="mb-3">
            <Input
              placeholder="Pipeline name"
              value={newName}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewName(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            {newSteps.map((step, i) => (
              <div key={step.id} className="flex items-center gap-2">
                <span className="w-5 text-right text-xs font-semibold text-surface-400">{i + 1}.</span>
                {i > 0 && <span className="text-surface-300 dark:text-surface-600">-</span>}
                <select
                  value={step.agentType}
                  onChange={(e) => updateStep(i, { agentType: e.target.value as AgentType })}
                  className="rounded-md border border-surface-300 bg-white px-2 py-1.5 text-[13px] text-surface-700 outline-none dark:border-surface-600 dark:bg-surface-900 dark:text-surface-300"
                >
                  {AGENT_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
                <Input
                  placeholder="/path/to/project"
                  value={step.projectPath}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateStep(i, { projectPath: e.target.value })}
                  className="flex-1 font-mono text-[13px]"
                />
                {newSteps.length > 1 && (
                  <Button size="sm" variant="danger-soft" onPress={() => removeStep(i)}>
                    ✕
                  </Button>
                )}
              </div>
            ))}
          </div>

          <div className="mt-3 flex gap-2">
            <Button variant="outline" size="sm" onPress={addStep}>
              + Add Step
            </Button>
            <Button
              variant="primary"
              size="sm"
              onPress={createPipeline}
              isDisabled={creating || !newName.trim()}
              className="ml-auto"
            >
              {creating ? 'Creating...' : 'Create & Run'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {pipelines.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-sm text-surface-400">
            No pipelines yet. Create one above to run agents sequentially.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {pipelines.map((p) => (
            <PipelineCard key={p.id} pipeline={p} onRun={() => runPipeline(p.id)} statusColor={PIPELINE_STATUS_COLOR} />
          ))}
        </div>
      )}
    </div>
  );
}

function PipelineCard({ pipeline, onRun, statusColor }: { pipeline: Pipeline; onRun: () => void; statusColor: Record<string, 'default' | 'accent' | 'success' | 'danger'> }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-surface-900 dark:text-white">{pipeline.name}</span>
            <Chip size="sm" variant="soft" color={statusColor[pipeline.status] ?? 'default'}>
              {pipeline.status}
            </Chip>
          </div>
          {pipeline.status === 'pending' && (
            <Button size="sm" variant="primary" onPress={onRun}>
              Run
            </Button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {pipeline.steps.map((step, i) => {
            const result = pipeline.results[i];
            return (
              <div key={step.id} className="flex items-center gap-1.5">
                {i > 0 && (
                  <svg className="h-3 w-3 text-surface-300 dark:text-surface-600" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M3 8h10M10 5l3 3-3 3" />
                  </svg>
                )}
                <Chip size="sm" variant="soft" color={STEP_CHIP_COLOR[result?.status ?? 'pending']}>
                  <span className="font-medium">{step.agentType}</span>
                  <span className="ml-1 opacity-60">{step.projectPath.split('/').pop()}</span>
                </Chip>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
