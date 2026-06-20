import { useState, useEffect, useCallback, memo } from 'react';
import { Button, Input } from '@heroui/react';
import type { AgentType } from '@baton/shared';
import { Card, EmptyState, StatusBadge, StatusDot, SectionHeader } from '../lib/ui.js';
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

  const PIPELINE_STATUS_COLOR_MAP: Record<string, string> = {
    pending: 'bg-gray-300 dark:border-gray-600 border-gray-300 dark:border-gray-600',
    running: 'bg-primary-50 dark:bg-primary-950/30 border-primary-300 dark:border-primary-700 shadow-sm shadow-primary-100 dark:shadow-none',
    completed: 'bg-green-50 dark:bg-green-950/30 border-green-300 dark:border-green-700',
    failed: 'bg-red-50 dark:bg-red-950/30 border-red-300 dark:border-red-700',
  };

  return (
    <div className="mx-auto max-w-3xl space-y-10">
      <div>
        <h2 className="text-xl font-bold text-gray-900 dark:text-white">Pipelines</h2>
        <p className="mt-1 text-sm text-gray-400">Chain agents sequentially to automate multi-step workflows</p>
      </div>

      <Card>
        <SectionHeader title="New Pipeline" />

        <div className="mb-5">
          <label className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">
            Pipeline Name
          </label>
          <Input
            placeholder="e.g. review-and-fix"
            value={newName}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewName(e.target.value)}
          />
        </div>

        <div className="mb-5">
          <label className="mb-2.5 block text-xs font-medium text-gray-500 dark:text-gray-400">
            Steps
          </label>
          <div className="space-y-0">
            {newSteps.map((step, i) => (
              <div key={step.id} className="relative">
                {i > 0 && (
                  <div className="flex items-center py-2 pl-4">
                    <div className="h-5 w-px bg-gray-300 dark:bg-gray-600" />
                    <IconArrowRight className="mx-2 h-3 w-3 text-gray-300 dark:text-gray-600" />
                  </div>
                )}
                <div className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800/50">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-bold text-gray-500 dark:bg-gray-700 dark:text-gray-400">
                    {i + 1}
                  </span>
                  <select
                    value={step.agentType}
                    onChange={(e) => updateStep(i, { agentType: e.target.value as AgentType })}
                    className="rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-[13px] font-medium text-gray-700 outline-none transition-colors hover:border-gray-300 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-300"
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
                    <Button size="sm" variant="danger-soft" onPress={() => removeStep(i)} className="shrink-0 px-2 min-w-0">
                      <IconX className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex gap-3">
          <Button variant="outline" size="sm" onPress={addStep}>
            <IconPlus className="mr-1.5 h-3.5 w-3.5" />
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
      </Card>

      <div>
        <SectionHeader title="All Pipelines" count={pipelines.length} />

        {pipelines.length === 0 ? (
          <EmptyState
            icon={<IconPipeline className="h-6 w-6 text-gray-400" />}
            title="No pipelines yet"
            description="Create one above to run agents sequentially."
          />
        ) : (
          <div className="space-y-3">
            {pipelines.map((p) => (
              <PipelineCard key={p.id} pipeline={p} onRun={() => runPipeline(p.id)} statusColorMap={PIPELINE_STATUS_COLOR_MAP} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const PipelineCard = memo(function PipelineCard({ pipeline, onRun, statusColorMap }: { pipeline: Pipeline; onRun: () => void; statusColorMap: Record<string, string> }) {
  const isRunning = pipeline.status === 'running';

  return (
    <Card className={`overflow-hidden border-2 transition-all duration-200 ${statusColorMap[pipeline.status] ?? 'border-gray-200 dark:border-gray-700'}`}>
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="text-sm font-semibold text-gray-900 dark:text-white">{pipeline.name}</span>
          <StatusBadge status={pipeline.status} />
        </div>
        <div className="flex items-center gap-2">
          {isRunning && (
            <span className="text-xs text-gray-400">
              Step {pipeline.currentStepIndex + 1}/{pipeline.steps.length}
            </span>
          )}
          {pipeline.status === 'pending' && (
            <Button size="sm" variant="primary" onPress={onRun}>
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
              {i > 0 && (
                <IconArrowRight className="h-3 w-3 text-gray-300 dark:text-gray-600" />
              )}
              <div
                className={`flex items-center gap-2.5 rounded-lg border px-4 py-2.5 ${
                  result?.status === 'running'
                    ? 'border-primary-300 bg-primary-50 dark:border-primary-700 dark:bg-primary-950/40'
                    : result?.status === 'completed'
                      ? 'border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/30'
                      : result?.status === 'failed'
                        ? 'border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/30'
                        : 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800/50'
                }`}
              >
                <StatusDot status={result?.status ?? 'pending'} />
                <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                  {AGENT_LABELS[step.agentType] ?? step.agentType}
                </span>
                <span className="text-[10px] text-gray-400">
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
