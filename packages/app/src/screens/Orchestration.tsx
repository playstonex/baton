import { useEffect, useState, useCallback, memo } from 'react';
import { wsService } from '../services/websocket.js';
import { Card, EmptyState, StatusBadge, StatusDot, LoadingSpinner, Button, PageHeader } from '../lib/ui.js';
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
  running: 'border-accent/40 bg-accent-soft',
  completed: 'border-success/40 bg-success-soft',
  failed: 'border-danger/40 bg-danger-soft',
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
      <PageHeader
        title="Orchestration"
        description="Multi-agent pipeline execution and sub-agent tree"
      />

      {pipelines.length === 0 ? (
        <EmptyState
          icon={<IconPlay className="h-5 w-5" />}
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
          <span className="text-[13px] font-semibold text-fg">{pipeline.name}</span>
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
            {idx > 0 && <IconArrowRight className="h-3 w-3 text-line-strong" />}
            <div
              className={`flex items-center gap-2.5 rounded-sm border px-3 py-2 ${
                STEP_STATUS_STYLES[step.status] ??
                'border-line bg-field'
              }`}
            >
              <StatusDot status={step.status} />
              <div>
                <div className="text-xs font-medium text-fg-2">
                  {AGENT_LABELS[step.agentType] ?? step.agentType}
                </div>
                <div className="font-mono text-[10px] text-meta">
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
