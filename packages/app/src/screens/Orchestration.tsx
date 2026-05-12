import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, Chip, Button } from '@heroui/react';
import { wsService } from '../services/websocket.js';

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

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-surface-900 dark:text-white">Orchestration</h1>
        <p className="mt-1 text-sm text-surface-500">Multi-agent pipeline execution and sub-agent tree</p>
      </div>

      {pipelines.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-sm text-surface-400">No pipelines configured.</p>
            <p className="mt-1 text-xs text-surface-400">
              Create a pipeline via the API to see it here.
            </p>
          </CardContent>
        </Card>
      ) : (
        pipelines.map((pipeline) => <PipelineCard key={pipeline.id} pipeline={pipeline} httpUrl={httpUrl} />)
      )}
    </div>
  );
}

function PipelineCard({ pipeline, httpUrl }: { pipeline: Pipeline; httpUrl: string }) {
  const runPipeline = async () => {
    await fetch(`${httpUrl}/api/pipelines/${pipeline.id}/run`, { method: 'POST' });
  };

  const statusColor: Record<string, 'accent' | 'success' | 'danger' | 'warning' | 'default'> = {
    pending: 'default',
    running: 'warning',
    completed: 'success',
    failed: 'danger',
  };

  const stepStatusIcon: Record<string, string> = {
    pending: '○',
    running: '◉',
    completed: '●',
    failed: '✗',
    skipped: '⊘',
  };

  return (
    <Card>
      <CardHeader className="flex items-center justify-between px-5 py-3">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold text-surface-900 dark:text-white">{pipeline.name}</h3>
          <Chip size="sm" variant="soft" color={statusColor[pipeline.status]}>
            {pipeline.status}
          </Chip>
        </div>
        {pipeline.status === 'pending' && (
          <Button size="sm" variant="primary" onPress={runPipeline}>
            Run
          </Button>
        )}
      </CardHeader>
      <CardContent className="px-5 pb-4">
        <div className="flex flex-wrap items-center gap-2">
          {pipeline.steps.map((step, idx) => (
            <div key={step.id} className="flex items-center gap-2">
              <div
                className={`flex items-center gap-2 rounded-lg border px-3 py-2 ${
                  step.status === 'running'
                    ? 'border-warning-300 bg-warning-50 dark:border-warning-700 dark:bg-warning-950/30'
                    : step.status === 'completed'
                      ? 'border-success-300 bg-success-50 dark:border-success-700 dark:bg-success-950/30'
                      : step.status === 'failed'
                        ? 'border-danger-300 bg-danger-50 dark:border-danger-700 dark:bg-danger-950/30'
                        : 'border-surface-200 bg-surface-50 dark:border-surface-700 dark:bg-surface-800'
                }`}
              >
                <span className="text-sm">{stepStatusIcon[step.status]}</span>
                <div>
                  <div className="text-xs font-medium text-surface-700 dark:text-surface-300">
                    {step.agentType}
                  </div>
                  <div className="text-[10px] text-surface-400">{step.projectPath.split('/').pop()}</div>
                </div>
              </div>
              {idx < pipeline.steps.length - 1 && (
                <svg className="h-4 w-4 text-surface-300 dark:text-surface-600" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M4 8h8M10 5l3 3-3 3" />
                </svg>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
