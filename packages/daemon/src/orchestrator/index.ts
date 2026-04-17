import type { AgentType, ParsedEvent } from '@flowwhips/shared';
import { AgentManager } from '../agent/manager.js';
import { createAdapter } from '../agent/index.js';
import type { BaseAgentAdapter } from '../agent/adapter.js';

export interface PipelineStep {
  id: string;
  agentType: AgentType;
  projectPath: string;
  args?: string[];
  env?: Record<string, string>;
  waitForStatus?: string; // Wait for this status before considering step done (default: 'stopped')
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
}

export class Orchestrator {
  private pipelines = new Map<string, Pipeline>();
  private agentManager: AgentManager;
  private onPipelineUpdate?: (pipeline: Pipeline) => void;

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

  async run(pipelineId: string): Promise<void> {
    const pipeline = this.pipelines.get(pipelineId);
    if (!pipeline || pipeline.status === 'running') return;

    pipeline.status = 'running';
    this.notify(pipeline);

    for (let i = 0; i < pipeline.steps.length; i++) {
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
        });
        result.sessionId = sessionId;

        // Wait for agent to stop
        await this.waitForCompletion(sessionId);

        result.status = 'completed';
        result.completedAt = new Date().toISOString();
      } catch (err) {
        result.status = 'failed';
        result.completedAt = new Date().toISOString();
        pipeline.status = 'failed';
        this.notify(pipeline);
        return;
      }
    }

    pipeline.status = 'completed';
    this.notify(pipeline);
  }

  list(): Pipeline[] {
    return Array.from(this.pipelines.values());
  }

  get(id: string): Pipeline | undefined {
    return this.pipelines.get(id);
  }

  private async runStep(
    step: PipelineStep,
    onEvent: (event: ParsedEvent) => void,
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

    // Subscribe to parsed events
    const unsub = this.agentManager.onEvent(sessionId, (event) => {
      onEvent(event);
    });

    // Store unsub for cleanup
    this._stepUnsubs.set(sessionId, unsub);

    return sessionId;
  }

  private _stepUnsubs = new Map<string, () => void>();

  private waitForCompletion(sessionId: string): Promise<void> {
    return new Promise((resolve) => {
      const check = () => {
        const agent = this.agentManager.get(sessionId);
        if (!agent || agent.status === 'stopped' || agent.status === 'error') {
          const unsub = this._stepUnsubs.get(sessionId);
          unsub?.();
          this._stepUnsubs.delete(sessionId);
          resolve();
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
