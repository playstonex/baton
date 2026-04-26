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

const AGENT_LABELS: Record<string, string> = {
  'claude-code': 'Claude',
  codex: 'Codex',
  opencode: 'OpenCode',
};

const STEP_DOT_COLOR: Record<string, string> = {
  pending: 'bg-surface-300',
  running: 'bg-primary-500 animate-pulse-dot',
  completed: 'bg-success-500',
  failed: 'bg-danger-500',
  skipped: 'bg-surface-300',
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

  const PIPELINE_STATUS_BG: Record<string, string> = {
    pending: 'border-surface-300 dark:border-surface-600',
    running: 'border-primary-300 dark:border-primary-700 shadow-sm shadow-primary-100 dark:shadow-none',
    completed: 'border-success-300 dark:border-success-700',
    failed: 'border-danger-300 dark:border-danger-700',
  };

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <h2 className="text-xl font-bold text-surface-900 dark:text-white">Pipelines</h2>
        <p className="mt-1 text-sm text-surface-400">Chain agents sequentially to automate multi-step workflows</p>
      </div>

      <Card className="overflow-hidden border border-surface-200 shadow-sm dark:border-surface-700">
        <CardContent className="p-6">
          <div className="mb-4 flex items-center gap-3">
            <h3 className="text-sm font-semibold text-surface-900 dark:text-white">New Pipeline</h3>
            <div className="h-px flex-1 bg-surface-200 dark:bg-surface-700" />
          </div>

          <div className="mb-5">
            <label className="mb-1.5 block text-xs font-medium text-surface-500 dark:text-surface-400">
              Pipeline Name
            </label>
            <Input
              placeholder="e.g. review-and-fix"
              value={newName}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewName(e.target.value)}
            />
          </div>

          <div className="mb-4">
            <label className="mb-2.5 block text-xs font-medium text-surface-500 dark:text-surface-400">
              Steps
            </label>
            <div className="space-y-0">
              {newSteps.map((step, i) => (
                <div key={step.id} className="relative">
                  {i > 0 && (
                    <div className="flex items-center py-1.5 pl-4">
                      <div className="h-5 w-px bg-surface-300 dark:bg-surface-600" />
                      <svg className="mx-2 h-3 w-3 text-surface-300 dark:text-surface-600" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M3 8h10M10 5l3 3-3 3" />
                      </svg>
                    </div>
                  )}
                  <div className="flex items-center gap-2.5 rounded-lg border border-surface-200 bg-white p-3 dark:border-surface-700 dark:bg-surface-800/50">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-100 text-xs font-bold text-surface-500 dark:bg-surface-700 dark:text-surface-400">
                      {i + 1}
                    </span>
                    <select
                      value={step.agentType}
                      onChange={(e) => updateStep(i, { agentType: e.target.value as AgentType })}
                      className="rounded-lg border border-surface-200 bg-surface-50 px-2.5 py-1.5 text-[13px] font-medium text-surface-700 outline-none transition-colors hover:border-surface-300 dark:border-surface-600 dark:bg-surface-900 dark:text-surface-300"
                    >
                      {AGENT_TYPES.map((t) => (
                        <option key={t} value={t}>{AGENT_LABELS[t]}</option>
                      ))}
                    </select>
                    <Input
                      placeholder="/path/to/project"
                      value={step.projectPath}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateStep(i, { projectPath: e.target.value })}
                      className="flex-1 font-mono text-[13px]"
                    />
                    {newSteps.length > 1 && (
                      <Button size="sm" variant="danger-soft" onPress={() => removeStep(i)} className="shrink-0 px-2">
                        <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                          <path d="M4 4l8 8M12 4l-8 8" />
                        </svg>
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex gap-3">
            <Button variant="outline" size="sm" onPress={addStep} className="gap-1.5">
              <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M8 3v10M3 8h10" />
              </svg>
              Add Step
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

      <div>
        <div className="mb-4 flex items-center gap-3">
          <h3 className="text-sm font-semibold text-surface-900 dark:text-white">All Pipelines</h3>
          <span className="rounded-full bg-surface-100 px-2 py-0.5 text-xs font-medium tabular-nums text-surface-600 dark:bg-surface-800 dark:text-surface-400">
            {pipelines.length}
          </span>
          <div className="h-px flex-1 bg-surface-200 dark:bg-surface-700" />
        </div>

        {pipelines.length === 0 ? (
          <Card className="border border-dashed border-surface-300 bg-surface-50/50 dark:border-surface-600 dark:bg-surface-900/50">
            <CardContent className="flex flex-col items-center py-20 text-center">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-xl bg-surface-100 dark:bg-surface-800">
                <span className="text-3xl">🔗</span>
              </div>
              <h4 className="text-sm font-semibold text-surface-700 dark:text-surface-300">No pipelines yet</h4>
              <p className="mt-1 text-xs text-surface-400">Create one above to run agents sequentially.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {pipelines.map((p) => (
              <PipelineCard key={p.id} pipeline={p} onRun={() => runPipeline(p.id)} statusColor={PIPELINE_STATUS_COLOR} statusBg={PIPELINE_STATUS_BG} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PipelineCard({ pipeline, onRun, statusColor, statusBg }: { pipeline: Pipeline; onRun: () => void; statusColor: Record<string, 'default' | 'accent' | 'success' | 'danger'>; statusBg: Record<string, string> }) {
  const isRunning = pipeline.status === 'running';

  return (
    <Card className={`overflow-hidden border-2 transition-all duration-200 ${statusBg[pipeline.status] ?? 'border-surface-200 dark:border-surface-700'}`}>
      <CardContent className="p-5">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="text-sm font-semibold text-surface-900 dark:text-white">{pipeline.name}</span>
            <Chip size="sm" variant="soft" color={statusColor[pipeline.status] ?? 'default'}>
              {pipeline.status}
            </Chip>
          </div>
          <div className="flex items-center gap-2">
            {isRunning && (
              <span className="text-xs text-surface-400">
                Step {pipeline.currentStepIndex + 1}/{pipeline.steps.length}
              </span>
            )}
            {pipeline.status === 'pending' && (
              <Button size="sm" variant="primary" onPress={onRun}>
                Run
              </Button>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1">
          {pipeline.steps.map((step, i) => {
            const result = pipeline.results[i];
            return (
              <div key={step.id} className="flex items-center gap-1">
                {i > 0 && (
                  <div className="flex items-center px-0.5">
                    <svg className="h-3 w-3 text-surface-300 dark:text-surface-600" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M3 8h10M10 5l3 3-3 3" />
                    </svg>
                  </div>
                )}
                <div
                  className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 ${
                    result?.status === 'running'
                      ? 'border-primary-300 bg-primary-50 dark:border-primary-700 dark:bg-primary-950/40'
                      : result?.status === 'completed'
                        ? 'border-success-200 bg-success-50 dark:border-success-800 dark:bg-success-950/30'
                        : result?.status === 'failed'
                          ? 'border-danger-200 bg-danger-50 dark:border-danger-800 dark:bg-danger-950/30'
                          : 'border-surface-200 bg-white dark:border-surface-700 dark:bg-surface-800/50'
                  }`}
                >
                  <span className={`inline-block h-1.5 w-1.5 rounded-full ${STEP_DOT_COLOR[result?.status ?? 'pending']}`} />
                  <span className="text-xs font-medium text-surface-700 dark:text-surface-300">
                    {AGENT_LABELS[step.agentType] ?? step.agentType}
                  </span>
                  <span className="text-[10px] text-surface-400">
                    {step.projectPath.split('/').pop()}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
