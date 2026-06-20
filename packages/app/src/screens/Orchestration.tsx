import { useEffect, useState, useCallback, memo } from 'react';
import { Button } from '@heroui/react';
import { wsService } from '../services/websocket.js';
import { Card, EmptyState, StatusBadge, StatusDot, LoadingSpinner } from '../lib/ui.js';
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
    <div className="mx-auto max-w-3xl space-y-10">
      <div>
        <h2 className="text-xl font-bold text-gray-900 dark:text-white">Orchestration</h2>
        <p className="mt-1 text-sm text-gray-400">Multi-agent pipeline execution and sub-agent tree</p>
      </div>

      {pipelines.length === 0 ? (
        <EmptyState
          icon={<IconPlay className="h-6 w-6 text-gray-400" />}
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

const PipelineCard = memo(function PipelineCard({ pipeline, httpUrl }: { pipeline: Pipeline; httpUrl: string }) {
  const runPipeline = async () => {
    await fetch(`${httpUrl}/api/pipelines/${pipeline.id}/run`, { method: 'POST' });
  };

  return (
    <Card>
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="text-sm font-semibold text-gray-900 dark:text-white">{pipeline.name}</span>
          <StatusBadge status={pipeline.status} />
        </div>
        {pipeline.status === 'pending' && (
          <Button size="sm" variant="primary" onPress={runPipeline}>
            <IconPlay className="mr-1.5 h-3.5 w-3.5" />
            Run
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {pipeline.steps.map((step, idx) => (
          <div key={step.id} className="flex items-center gap-1.5">
            {idx > 0 && (
              <IconArrowRight className="h-3 w-3 text-gray-300 dark:text-gray-600" />
            )}
            <div
              className={`flex items-center gap-2.5 rounded-lg border px-4 py-2.5 ${
                step.status === 'running'
                  ? 'border-primary-300 bg-primary-50 dark:border-primary-700 dark:bg-primary-950/40'
                  : step.status === 'completed'
                    ? 'border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/30'
                    : step.status === 'failed'
                      ? 'border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/30'
                      : 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800/50'
              }`}
            >
              <StatusDot status={step.status} />
              <div>
                <div className="text-xs font-medium text-gray-700 dark:text-gray-300">
                  {AGENT_LABELS[step.agentType] ?? step.agentType}
                </div>
                <div className="text-[10px] text-gray-400">{step.projectPath.split('/').pop()}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
});
