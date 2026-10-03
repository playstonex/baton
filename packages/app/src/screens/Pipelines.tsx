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

const AGENT_TYPES: AgentType[] = ['claude-code', 'codex', 'opencode', 'kiro', 'antigravity', 'pi'];

const AGENT_LABELS: Record<string, string> = {
  'claude-code': 'Claude',
  codex: 'Codex',
  opencode: 'OpenCode',
  kiro: 'Kiro',
  antigravity: 'Antigravity',
  pi: 'Pi',
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

  const PIPELINE_STATUS_ACCENT: Record<string, string> = {
    pending: 'border-line-soft',
    running: 'border-accent/40',
    completed: 'border-success/40',
    failed: 'border-danger/40',
  };

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <h2 className="text-xl font-semibold tracking-[-0.02em] text-fg">Pipelines</h2>
        <p className="mt-1 text-[13px] text-muted">
          Chain agents sequentially to automate multi-step workflows
        </p>
      </div>

      <Card className="p-6">
        <SectionHeader title="New pipeline" />

        <div className="mb-5">
          <label className="mb-2 block text-xs font-medium text-muted">Pipeline name</label>
          <Input
            placeholder="e.g. review-and-fix"
            value={newName}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewName(e.target.value)}
          />
        </div>

        <div className="mb-5">
          <label className="mb-2.5 block text-xs font-medium text-muted">Steps</label>
          <div className="space-y-0">
            {newSteps.map((step, i) => (
              <div key={step.id} className="relative">
                {i > 0 && (
                  <div className="flex items-center py-2 pl-4">
                    <div className="h-5 w-px bg-line" />
                    <IconArrowRight className="mx-2 h-3 w-3 text-line-strong" />
                  </div>
                )}
                <div className="flex items-center gap-3 rounded-sm border border-line bg-field p-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-raised text-xs font-semibold tabular-nums text-muted">
                    {i + 1}
                  </span>
                  <select
                    value={step.agentType}
                    onChange={(e) => updateStep(i, { agentType: e.target.value as AgentType })}
                    className="h-7 rounded-sm border border-line bg-surface px-2 text-xs font-medium text-fg outline-none transition-colors duration-150 hover:border-line-strong focus:border-accent"
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
                      className="min-w-0 shrink-0 px-1.5 text-muted"
                    >
                      <IconX className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={addStep}>
            <IconPlus className="mr-1.5 h-3.5 w-3.5" />
            Add step
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={createPipeline}
            disabled={creating || !newName.trim()}
            className="ml-auto"
          >
            {creating ? 'Creating…' : 'Create & run'}
          </Button>
        </div>
      </Card>

      <div>
        <SectionHeader title="All pipelines" count={pipelines.length} />

        {pipelines.length === 0 ? (
          <EmptyState
            icon={<IconPipeline className="h-5 w-5" />}
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
                statusAccent={PIPELINE_STATUS_ACCENT}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const STEP_STATUS_STYLES: Record<string, string> = {
  running: 'border-accent/40 bg-accent-soft',
  completed: 'border-success/40 bg-success-soft',
  failed: 'border-danger/40 bg-danger-soft',
};

const PipelineCard = memo(function PipelineCard({
  pipeline,
  onRun,
  statusAccent,
}: {
  pipeline: Pipeline;
  onRun: () => void;
  statusAccent: Record<string, string>;
}) {
  const isRunning = pipeline.status === 'running';

  return (
    <Card className={`border ${statusAccent[pipeline.status] ?? 'border-line-soft'}`}>
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="text-[13px] font-semibold text-fg">{pipeline.name}</span>
          <StatusBadge status={pipeline.status} />
        </div>
        <div className="flex items-center gap-2">
          {isRunning && (
            <span className="text-xs tabular-nums text-meta">
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
              {i > 0 && <IconArrowRight className="h-3 w-3 text-line-strong" />}
              <div
                className={`flex items-center gap-2.5 rounded-sm border px-3 py-2 ${
                  STEP_STATUS_STYLES[result?.status ?? ''] ??
                  'border-line bg-field'
                }`}
              >
                <StatusDot status={result?.status ?? 'pending'} />
                <span className="text-xs font-medium text-fg-2">
                  {AGENT_LABELS[step.agentType] ?? step.agentType}
                </span>
                <span className="font-mono text-[10px] text-meta">
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
