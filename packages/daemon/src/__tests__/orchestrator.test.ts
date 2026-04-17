import { describe, it, expect } from 'vitest';
import { Orchestrator } from '../orchestrator/index.js';
import type { PipelineStep } from '../orchestrator/index.js';

describe('Orchestrator', () => {
  function createOrchestrator() {
    // We mock AgentManager enough for pipeline creation
    const mockManager = {
      start: async () => crypto.randomUUID(),
      get: () => ({ status: 'stopped' }),
      onEvent: () => () => {},
    } as any;
    return new Orchestrator(mockManager);
  }

  it('creates a pipeline with steps', () => {
    const orch = createOrchestrator();
    const steps: PipelineStep[] = [
      { id: 's1', agentType: 'claude-code', projectPath: '/tmp/a' },
      { id: 's2', agentType: 'codex', projectPath: '/tmp/b' },
    ];
    const pipeline = orch.create('test-pipeline', steps);

    expect(pipeline.name).toBe('test-pipeline');
    expect(pipeline.steps).toHaveLength(2);
    expect(pipeline.status).toBe('pending');
    expect(pipeline.results).toHaveLength(2);
    expect(pipeline.results[0].status).toBe('pending');
  });

  it('lists created pipelines', () => {
    const orch = createOrchestrator();
    orch.create('p1', [{ id: 's1', agentType: 'claude-code', projectPath: '/tmp/a' }]);
    orch.create('p2', [{ id: 's2', agentType: 'codex', projectPath: '/tmp/b' }]);
    expect(orch.list()).toHaveLength(2);
  });

  it('gets pipeline by id', () => {
    const orch = createOrchestrator();
    const p = orch.create('p1', [{ id: 's1', agentType: 'claude-code', projectPath: '/tmp/a' }]);
    expect(orch.get(p.id)).toBe(p);
    expect(orch.get('nonexistent')).toBeUndefined();
  });
});
