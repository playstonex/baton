import type { AgentType, ParsedEvent } from '@baton/shared';
import { AgentManager } from '../agent/manager.js';
import { createAdapter } from '../agent/index.js';
import type { BaseAgentAdapter } from '../agent/adapter.js';

export interface PipelineStep {
  id: string;
  agentType: AgentType;
  projectPath: string;
  args?: string[];
  env?: Record<string, string>;
  timeoutMs?: number;
  waitForStatus?: string;
}

export interface Pipeline {
  id: string;
  name: string;
  steps: PipelineStep[];
  status: 'pending' | 'running' | 'completed' | 'failed';
  currentStepIndex: number;
  results: PipelineStepResult[];
}

export interface PipelineStepResult {
  stepId: string;
  sessionId?: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  events: ParsedEvent[];
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

const STEP_TIMEOUT_DEFAULT = 10 * 60 * 1000;

export class Orchestrator {
  private pipelines = new Map<string, Pipeline>();
  private agentManager: AgentManager;
  private onPipelineUpdate?: (pipeline: Pipeline) => void;
  private abortControllers = new Map<string, AbortController>();

  constructor(agentManager: AgentManager) {
    this.agentManager = agentManager;
  }

  setUpdateCallback(cb: (pipeline: Pipeline) => void): void {
    this.onPipelineUpdate = cb;
  }

  create(name: string, steps: PipelineStep[]): Pipeline {
    const pipeline: Pipeline = {
      id: crypto.randomUUID(),
      name,
      steps,
      status: 'pending',
      currentStepIndex: -1,
      results: steps.map((s) => ({ stepId: s.id, status: 'pending' as const, events: [] })),
    };
    this.pipelines.set(pipeline.id, pipeline);
    return pipeline;
  }

  async run(pipelineId: string, signal?: AbortSignal): Promise<void> {
    const pipeline = this.pipelines.get(pipelineId);
    if (!pipeline || pipeline.status === 'running') return;

    const abortController = new AbortController();
    this.abortControllers.set(pipelineId, abortController);

    pipeline.status = 'running';
    this.notify(pipeline);

    for (let i = 0; i < pipeline.steps.length; i++) {
      if (signal?.aborted || abortController.signal.aborted) {
        pipeline.status = 'failed';
        pipeline.results[i].status = 'skipped';
        this.notify(pipeline);
        break;
      }

      pipeline.currentStepIndex = i;
      const step = pipeline.steps[i];
      const result = pipeline.results[i];
      result.status = 'running';
      result.startedAt = new Date().toISOString();
      this.notify(pipeline);

      try {
        const sessionId = await this.runStep(step, (event) => {
          result.events.push(event);
          this.notify(pipeline);
        }, abortController.signal);

        result.sessionId = sessionId;

        await this.waitForCompletion(sessionId, step.timeoutMs ?? STEP_TIMEOUT_DEFAULT, abortController.signal);

        result.status = 'completed';
        result.completedAt = new Date().toISOString();
      } catch (err) {
        result.status = 'failed';
        result.completedAt = new Date().toISOString();
        result.error = err instanceof Error ? err.message : String(err);

        if (result.sessionId) {
          await this.agentManager.stop(result.sessionId).catch(() => {});
        }

        pipeline.status = 'failed';
        this.notify(pipeline);
        return;
      }
    }

    if (!abortController.signal.aborted) {
      pipeline.status = 'completed';
      this.notify(pipeline);
    }

    this.abortControllers.delete(pipelineId);
  }

  list(): Pipeline[] {
    return Array.from(this.pipelines.values());
  }

  get(id: string): Pipeline | undefined {
    return this.pipelines.get(id);
  }

  cancel(pipelineId: string): void {
    const controller = this.abortControllers.get(pipelineId);
    if (controller) {
      controller.abort();
    }
  }

  private async runStep(
    step: PipelineStep,
    onEvent: (event: ParsedEvent) => void,
    signal: AbortSignal,
  ): Promise<string> {
    const adapter: BaseAgentAdapter = createAdapter(step.agentType);
    const sessionId = await this.agentManager.start(
      {
        type: step.agentType,
        projectPath: step.projectPath,
        args: step.args,
        env: step.env,
      },
      adapter,
    );

    const unsub = this.agentManager.onEvent(sessionId, (event) => {
      onEvent(event);
    });

    this._stepUnsubs.set(sessionId, unsub);

    signal.addEventListener('abort', () => {
      this.agentManager.stop(sessionId).catch(() => {});
    });

    return sessionId;
  }

  private _stepUnsubs = new Map<string, () => void>();

  private waitForCompletion(sessionId: string, timeoutMs: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Step timed out'));
      }, timeoutMs);

      const check = () => {
        const agent = this.agentManager.get(sessionId);
        if (!agent || agent.status === 'stopped' || agent.status === 'error') {
          clearTimeout(timeout);
          const unsub = this._stepUnsubs.get(sessionId);
          unsub?.();
          this._stepUnsubs.delete(sessionId);
          resolve();
          return;
        }
        if (signal.aborted) {
          clearTimeout(timeout);
          reject(new Error('Pipeline cancelled'));
          return;
        }
        setTimeout(check, 500);
      };
      check();
    });
  }

  private notify(pipeline: Pipeline): void {
    this.onPipelineUpdate?.(pipeline);
  }
}
