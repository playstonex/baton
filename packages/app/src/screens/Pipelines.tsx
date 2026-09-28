import { useState, useEffect, useCallback, memo } from 'react';
import type { AgentType } from '@baton/shared';
import { Card, EmptyState, StatusBadge, StatusDot, SectionHeader, Button, Input } from '../lib/ui.js';
import { IconPlus, IconX, IconPlay, IconArrowRight, IconPipelines as IconPipeline } from '../lib/icons.js';

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

const AGENT_TYPES: AgentType[] = ['claude-code', 'codex', 'opencode', 'kiro-cli'];

const AGENT_LABELS: Record<string, string> = {
  'claude-code': 'Claude',
  codex: 'Codex',
  opencode: 'OpenCode',
  'kiro-cli': 'Kiro',
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

  const PIPELINE_STATUS_BORDER: Record<string, string> = {
    pending: 'border-geist-gray-alpha-400',
    running: 'border-geist-blue-500',
    completed: 'border-geist-green-600',
    failed: 'border-geist-red-600',
  };

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <h2 className="text-xl font-bold text-geist-gray-1000">Pipelines</h2>
        <p className="mt-1 text-sm text-geist-gray-700">
          Chain agents sequentially to automate multi-step workflows
        </p>
      </div>

      <Card>
        <SectionHeader title="New Pipeline" />

        <div className="mb-5">
          <label className="mb-1.5 block text-xs font-medium text-geist-gray-800">Pipeline Name</label>
          <Input
            placeholder="e.g. review-and-fix"
            value={newName}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewName(e.target.value)}
          />
        </div>

        <div className="mb-5">
          <label className="mb-2.5 block text-xs font-medium text-geist-gray-800">Steps</label>
          <div className="space-y-0">
            {newSteps.map((step, i) => (
              <div key={step.id} className="relative">
                {i > 0 && (
                  <div className="flex items-center py-2 pl-4">
                    <div className="h-5 w-px bg-geist-gray-alpha-300" />
                    <IconArrowRight className="mx-2 h-3 w-3 text-geist-gray-alpha-500" />
                  </div>
                )}
                <div className="flex items-center gap-3 rounded-[var(--radius-sm)] border border-geist-gray-alpha-400 bg-geist-background-100 p-4">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-geist-gray-alpha-200 text-xs font-bold text-geist-gray-800">
                    {i + 1}
                  </span>
                  <select
                    value={step.agentType}
                    onChange={(e) => updateStep(i, { agentType: e.target.value as AgentType })}
                    className="h-8 rounded-[var(--radius-sm)] border border-geist-gray-alpha-400 bg-geist-background-100 px-2.5 text-[13px] font-medium text-geist-gray-1000 outline-none transition-colors hover:border-geist-gray-alpha-600 focus:border-geist-blue-700"
                  >
                    {AGENT_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {AGENT_LABELS[t]}
                      </option>
                    ))}
                  </select>
                  <Input
                    placeholder="/path/to/project"
                    value={step.projectPath}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      updateStep(i, { projectPath: e.target.value })
                    }
                    className="flex-1 font-mono"
                  />
                  {newSteps.length > 1 && (
                    <Button
                      size="sm"
                      variant="tertiary"
                      onClick={() => removeStep(i)}
                      className="min-w-0 shrink-0 px-2 text-geist-gray-700"
                    >
                      <IconX className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex gap-3">
          <Button variant="secondary" size="sm" onClick={addStep}>
            <IconPlus className="mr-1.5 h-3.5 w-3.5" />
            Add Step
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={createPipeline}
            disabled={creating || !newName.trim()}
            className="ml-auto"
          >
            {creating ? 'Creating…' : 'Create & Run'}
          </Button>
        </div>
      </Card>

      <div>
        <SectionHeader title="All Pipelines" count={pipelines.length} />

        {pipelines.length === 0 ? (
          <EmptyState
            icon={<IconPipeline className="h-6 w-6 text-geist-gray-700" />}
            title="No pipelines yet"
            description="Create one above to run agents sequentially."
          />
        ) : (
          <div className="space-y-3">
            {pipelines.map((p) => (
              <PipelineCard
                key={p.id}
                pipeline={p}
                onRun={() => runPipeline(p.id)}
                statusBorder={PIPELINE_STATUS_BORDER}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const STEP_STATUS_STYLES: Record<string, string> = {
  running:
    'border-geist-blue-200 bg-geist-blue-100 dark:border-geist-blue-1000 dark:bg-geist-blue-1000',
  completed:
    'border-geist-green-200 bg-geist-green-100 dark:border-geist-green-1000 dark:bg-geist-green-1000',
  failed: 'border-geist-red-200 bg-geist-red-100 dark:border-geist-red-1000 dark:bg-geist-red-1000',
};

const PipelineCard = memo(function PipelineCard({
  pipeline,
  onRun,
  statusBorder,
}: {
  pipeline: Pipeline;
  onRun: () => void;
  statusBorder: Record<string, string>;
}) {
  const isRunning = pipeline.status === 'running';

  return (
    <Card className={`border-2 ${statusBorder[pipeline.status] ?? 'border-geist-gray-alpha-400'}`}>
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="text-sm font-semibold text-geist-gray-1000">{pipeline.name}</span>
          <StatusBadge status={pipeline.status} />
        </div>
        <div className="flex items-center gap-2">
          {isRunning && (
            <span className="text-xs text-geist-gray-700">
              Step {pipeline.currentStepIndex + 1}/{pipeline.steps.length}
            </span>
          )}
          {pipeline.status === 'pending' && (
            <Button size="sm" variant="primary" onClick={onRun}>
              <IconPlay className="mr-1.5 h-3.5 w-3.5" />
              Run
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {pipeline.steps.map((step, i) => {
          const result = pipeline.results[i];
          return (
            <div key={step.id} className="flex items-center gap-1.5">
              {i > 0 && <IconArrowRight className="h-3 w-3 text-geist-gray-alpha-500" />}
              <div
                className={`flex items-center gap-2.5 rounded-[var(--radius-sm)] border px-4 py-2.5 ${
                  STEP_STATUS_STYLES[result?.status ?? ''] ??
                  'border-geist-gray-alpha-400 bg-geist-background-100'
                }`}
              >
                <StatusDot status={result?.status ?? 'pending'} />
                <span className="text-xs font-medium text-geist-gray-900">
                  {AGENT_LABELS[step.agentType] ?? step.agentType}
                </span>
                <span className="text-[10px] text-geist-gray-700">
                  {step.projectPath.split('/').pop()}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
});
