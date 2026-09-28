import { useEffect, useState, useCallback, memo } from 'react';
import { wsService } from '../services/websocket.js';
import { Card, EmptyState, StatusBadge, StatusDot, LoadingSpinner, Button } from '../lib/ui.js';
import { IconArrowRight, IconPlay } from '../lib/icons.js';
import { usePolling } from '../lib/hooks.js';

interface Pipeline {
  id: string;
  name: string;
  steps: PipelineStepInfo[];
  status: 'pending' | 'running' | 'completed' | 'failed';
}

interface PipelineStepInfo {
  id: string;
  agentType: string;
  projectPath: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  sessionId?: string;
}

const AGENT_LABELS: Record<string, string> = {
  'claude-code': 'Claude',
  codex: 'Codex',
  opencode: 'OpenCode',
  'kiro-cli': 'Kiro',
};

const STEP_STATUS_STYLES: Record<string, string> = {
  running:
    'border-geist-blue-200 bg-geist-blue-100 dark:border-geist-blue-1000 dark:bg-geist-blue-1000',
  completed:
    'border-geist-green-200 bg-geist-green-100 dark:border-geist-green-1000 dark:bg-geist-green-1000',
  failed: 'border-geist-red-200 bg-geist-red-100 dark:border-geist-red-1000 dark:bg-geist-red-1000',
};

export function OrchestrationScreen() {
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [loading, setLoading] = useState(true);
  const httpUrl = wsService.httpUrl;

  const fetchPipelines = useCallback(async () => {
    try {
      const res = await fetch(`${httpUrl}/api/pipelines`);
      if (res.ok) setPipelines(await res.json());
    } catch {
    } finally {
      setLoading(false);
    }
  }, [httpUrl]);

  useEffect(() => {
    fetchPipelines();
  }, [fetchPipelines]);

  usePolling(fetchPipelines, 15000);

  if (loading) return <LoadingSpinner />;

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <h2 className="text-xl font-bold text-geist-gray-1000">Orchestration</h2>
        <p className="mt-1 text-sm text-geist-gray-700">
          Multi-agent pipeline execution and sub-agent tree
        </p>
      </div>

      {pipelines.length === 0 ? (
        <EmptyState
          icon={<IconPlay className="h-6 w-6 text-geist-gray-700" />}
          title="No pipelines configured"
          description="Create a pipeline via the API to see it here."
        />
      ) : (
        <div className="space-y-3">
          {pipelines.map((pipeline) => (
            <PipelineCard key={pipeline.id} pipeline={pipeline} httpUrl={httpUrl} />
          ))}
        </div>
      )}
    </div>
  );
}

const PipelineCard = memo(function PipelineCard({
  pipeline,
  httpUrl,
}: {
  pipeline: Pipeline;
  httpUrl: string;
}) {
  const runPipeline = async () => {
    await fetch(`${httpUrl}/api/pipelines/${pipeline.id}/run`, { method: 'POST' });
  };

  return (
    <Card>
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="text-sm font-semibold text-geist-gray-1000">{pipeline.name}</span>
          <StatusBadge status={pipeline.status} />
        </div>
        {pipeline.status === 'pending' && (
          <Button size="sm" variant="primary" onClick={runPipeline}>
            <IconPlay className="mr-1.5 h-3.5 w-3.5" />
            Run
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {pipeline.steps.map((step, idx) => (
          <div key={step.id} className="flex items-center gap-1.5">
            {idx > 0 && <IconArrowRight className="h-3 w-3 text-geist-gray-alpha-500" />}
            <div
              className={`flex items-center gap-2.5 rounded-[var(--radius-sm)] border px-4 py-2.5 ${
                STEP_STATUS_STYLES[step.status] ??
                'border-geist-gray-alpha-400 bg-geist-background-100'
              }`}
            >
              <StatusDot status={step.status} />
              <div>
                <div className="text-xs font-medium text-geist-gray-900">
                  {AGENT_LABELS[step.agentType] ?? step.agentType}
                </div>
                <div className="text-[10px] text-geist-gray-700">
                  {step.projectPath.split('/').pop()}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
});
