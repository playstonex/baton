import { useState, useEffect, useCallback } from 'react';
import type { AgentType } from '@flowwhips/shared';

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

const AGENT_TYPES: AgentType[] = ['claude-code', 'codex', 'opencode'];

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
      // ignore
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
        // Auto-run
        runPipeline(pipeline.id);
      }
    } finally {
      setCreating(false);
    }
  }

  async function runPipeline(id: string) {
    await fetch(`/api/pipelines/${id}/run`, { method: 'POST' });
    // Poll for updates
    const interval = setInterval(async () => {
      await fetchPipelines();
      const p = pipelines.find((p) => p.id === id);
      if (p && p.status !== 'running') clearInterval(interval);
    }, 1000);
  }

  return (
    <div>
      <h2 style={{ marginBottom: 20 }}>Pipelines</h2>

      {/* Create Pipeline */}
      <div
        style={{
          marginBottom: 24,
          padding: 20,
          background: '#fff',
          border: '1px solid #e5e7eb',
          borderRadius: 10,
        }}
      >
        <h3 style={{ marginTop: 0, marginBottom: 12, fontSize: 15 }}>New Pipeline</h3>

        <input
          type="text"
          placeholder="Pipeline name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          style={{
            width: '100%',
            padding: '8px 12px',
            border: '1px solid #d1d5db',
            borderRadius: 6,
            fontSize: 14,
            marginBottom: 12,
            boxSizing: 'border-box',
          }}
        />

        {/* Steps */}
        {newSteps.map((step, i) => (
          <div key={step.id} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#6b7280', width: 20 }}>{i + 1}.</span>
            <select
              value={step.agentType}
              onChange={(e) => updateStep(i, { agentType: e.target.value as AgentType })}
              style={{ padding: '6px 8px', border: '1px solid #d1d5db', borderRadius: 4, fontSize: 13 }}
            >
              {AGENT_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            <input
              type="text"
              placeholder="/path/to/project"
              value={step.projectPath}
              onChange={(e) => updateStep(i, { projectPath: e.target.value })}
              style={{
                flex: 1,
                padding: '6px 10px',
                border: '1px solid #d1d5db',
                borderRadius: 4,
                fontSize: 13,
                fontFamily: 'monospace',
              }}
            />
            {newSteps.length > 1 && (
              <button
                onClick={() => removeStep(i)}
                style={{ padding: '4px 8px', fontSize: 12, border: '1px solid #fca5a5', borderRadius: 4, background: '#fff', color: '#dc2626', cursor: 'pointer' }}
              >
                X
              </button>
            )}
          </div>
        ))}

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={addStep}
            style={{ padding: '6px 14px', border: '1px solid #d1d5db', borderRadius: 6, background: '#f9fafb', cursor: 'pointer', fontSize: 13 }}
          >
            + Add Step
          </button>
          <button
            onClick={createPipeline}
            disabled={creating || !newName.trim()}
            style={{
              padding: '6px 14px',
              border: 'none',
              borderRadius: 6,
              background: creating ? '#93c5fd' : '#2563eb',
              color: '#fff',
              cursor: creating ? 'wait' : 'pointer',
              fontSize: 13,
              fontWeight: 500,
              marginLeft: 'auto',
            }}
          >
            {creating ? 'Creating...' : 'Create & Run'}
          </button>
        </div>
      </div>

      {/* Pipeline List */}
      {pipelines.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#9ca3af', border: '1px dashed #d1d5db', borderRadius: 10 }}>
          No pipelines yet. Create one above to run agents sequentially.
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {pipelines.map((p) => (
            <PipelineCard key={p.id} pipeline={p} onRun={() => runPipeline(p.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

function PipelineCard({ pipeline, onRun }: { pipeline: Pipeline; onRun: () => void }) {
  const statusColors: Record<string, string> = {
    pending: '#6b7280',
    running: '#3b82f6',
    completed: '#22c55e',
    failed: '#ef4444',
  };

  return (
    <div
      style={{
        padding: 16,
        background: '#fff',
        border: '1px solid #e5e7eb',
        borderRadius: 8,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>{pipeline.name}</span>
          <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, background: '#f3f4f6', color: statusColors[pipeline.status] }}>
            {pipeline.status}
          </span>
        </div>
        {pipeline.status === 'pending' && (
          <button
            onClick={onRun}
            style={{ padding: '4px 12px', border: 'none', borderRadius: 4, background: '#2563eb', color: '#fff', cursor: 'pointer', fontSize: 12 }}
          >
            Run
          </button>
        )}
      </div>

      {/* Steps visualization */}
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        {pipeline.steps.map((step, i) => {
          const result = pipeline.results[i];
          const stepColors: Record<string, string> = {
            pending: '#f3f4f6',
            running: '#dbeafe',
            completed: '#dcfce7',
            failed: '#fef2f2',
            skipped: '#f9fafb',
          };
          return (
            <div key={step.id} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              {i > 0 && <span style={{ color: '#d1d5db', fontSize: 12 }}>→</span>}
              <div
                style={{
                  padding: '4px 10px',
                  borderRadius: 4,
                  background: stepColors[result?.status ?? 'pending'],
                  fontSize: 12,
                  whiteSpace: 'nowrap',
                }}
              >
                <span style={{ fontWeight: 500 }}>{step.agentType}</span>
                <span style={{ color: '#9ca3af', marginLeft: 4 }}>{step.projectPath.split('/').pop()}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
