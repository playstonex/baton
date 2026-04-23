import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router';
import type { AgentProcess, AgentType } from '@flowwhips/shared';
import { useAgentStore } from '../stores/connection.js';
import { wsService } from '../services/websocket.js';
import { SystemStats } from '../components/SystemStats.js';

const AGENT_OPTIONS: { type: AgentType; label: string; desc: string }[] = [
  { type: 'claude-code', label: 'Claude Code', desc: 'Anthropic CLI agent' },
  { type: 'codex', label: 'Codex', desc: 'OpenAI CLI agent' },
  { type: 'opencode', label: 'OpenCode', desc: 'Open-source agent' },
];

export function DashboardScreen() {
  const navigate = useNavigate();
  const agents = useAgentStore((s) => s.agents);
  const { setAgents, updateAgentStatus, addAgent, removeAgent } = useAgentStore();
  const [projectPath, setProjectPath] = useState('');
  const [agentType, setAgentType] = useState<AgentType>('claude-code');
  const [loading, setLoading] = useState(false);
  const [daemonOnline, setDaemonOnline] = useState(false);

  const fetchAgents = useCallback(async () => {
    try {
      const res = await fetch('/api/agents');
      if (res.ok) {
        const list: AgentProcess[] = await res.json();
        setAgents(list);
        setDaemonOnline(true);
      }
    } catch {
      setDaemonOnline(false);
    }
  }, [setAgents]);

  useEffect(() => {
    fetchAgents();

    const unsubList = wsService.on('agent_list', (msg) => {
      if (msg.type === 'agent_list') {
        setAgents(
          msg.agents.map((a) => ({
            id: a.id,
            type: a.type as AgentProcess['type'],
            projectPath: a.projectPath,
            status: a.status as AgentProcess['status'],
            startedAt: '',
          })),
        );
      }
    });

    const unsubStatus = wsService.on('status_update', (msg) => {
      if (msg.type === 'status_update' && 'status' in msg) {
        updateAgentStatus(msg.sessionId, msg.status as AgentProcess['status']);
      }
    });

    const unsubState = wsService.on('_state', () => {
      setDaemonOnline(wsService.connected);
    });

    wsService.connect();

    return () => {
      unsubList();
      unsubStatus();
      unsubState();
    };
  }, [fetchAgents, setAgents, updateAgentStatus]);

  async function startAgent() {
    if (!projectPath.trim()) return;
    setLoading(true);
    try {
      const res = await fetch('/api/agents/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentType, projectPath: projectPath.trim() }),
      });
      if (res.ok) {
        const data = await res.json();
        addAgent({
          id: data.sessionId,
          type: agentType,
          projectPath: projectPath.trim(),
          status: 'running',
          startedAt: new Date().toISOString(),
        });
        navigate(`/terminal/${data.sessionId}`);
      } else {
        const err = await res.json();
        alert(`Failed to start agent: ${err.error ?? 'Unknown error'}`);
      }
    } catch (err) {
      alert(`Failed to connect to Daemon: ${err}`);
    } finally {
      setLoading(false);
    }
  }

  async function stopAgent(id: string) {
    try {
      await fetch(`/api/agents/${id}/stop`, { method: 'POST' });
      removeAgent(id);
    } catch {
      // ignore
    }
  }

  const running = agents.filter((a) => a.status !== 'stopped').length;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h2 style={{ margin: 0 }}>Dashboard</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: '#6b7280' }}>
            {running} running / {agents.length} total
          </span>
          <span
            style={{
              fontSize: 12,
              padding: '4px 10px',
              borderRadius: 4,
              background: daemonOnline ? '#dcfce7' : '#fef2f2',
              color: daemonOnline ? '#166534' : '#991b1b',
            }}
          >
            {daemonOnline ? 'Daemon Online' : 'Daemon Offline'}
          </span>
        </div>
      </div>

      <SystemStats />

      {/* Start Agent Card */}
      <div
        style={{
          marginBottom: 24,
          padding: 20,
          background: '#fff',
          border: '1px solid #e5e7eb',
          borderRadius: 10,
          boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
        }}
      >
        <h3 style={{ marginTop: 0, marginBottom: 12, fontSize: 15 }}>Start Agent</h3>

        {/* Agent type selector */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          {AGENT_OPTIONS.map((opt) => (
            <button
              key={opt.type}
              onClick={() => setAgentType(opt.type)}
              style={{
                flex: 1,
                padding: '8px 12px',
                background: agentType === opt.type ? '#eff6ff' : '#f9fafb',
                border: `1px solid ${agentType === opt.type ? '#2563eb' : '#e5e7eb'}`,
                borderRadius: 6,
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 600, color: agentType === opt.type ? '#2563eb' : '#374151' }}>
                {opt.label}
              </div>
              <div style={{ fontSize: 11, color: '#9ca3af' }}>{opt.desc}</div>
            </button>
          ))}
        </div>

        {/* Project path + start */}
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type="text"
            placeholder="/path/to/your/project"
            value={projectPath}
            onChange={(e) => setProjectPath(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && startAgent()}
            style={{
              flex: 1,
              padding: '10px 14px',
              border: '1px solid #d1d5db',
              borderRadius: 6,
              fontSize: 14,
              fontFamily: 'monospace',
              outline: 'none',
            }}
          />
          <button
            onClick={startAgent}
            disabled={loading || !projectPath.trim() || !daemonOnline}
            style={{
              padding: '10px 20px',
              background: loading || !daemonOnline ? '#93c5fd' : '#2563eb',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              fontSize: 14,
              fontWeight: 500,
              cursor: loading ? 'wait' : 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {loading ? 'Starting...' : `Start ${AGENT_OPTIONS.find((o) => o.type === agentType)?.label}`}
          </button>
        </div>
      </div>

      {/* Agent List */}
      <h3 style={{ fontSize: 15, marginBottom: 12 }}>
        Active Agents{' '}
        <span style={{ color: '#6b7280', fontWeight: 400 }}>({agents.length})</span>
      </h3>

      {agents.length === 0 ? (
        <div
          style={{
            padding: 40,
            textAlign: 'center',
            color: '#9ca3af',
            border: '1px dashed #d1d5db',
            borderRadius: 10,
          }}
        >
          No agents running. Enter a project path above to start.
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {agents.map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              onOpen={() => navigate(`/terminal/${agent.id}`)}
              onStop={() => stopAgent(agent.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AgentCard({ agent, onOpen, onStop }: { agent: AgentProcess; onOpen: () => void; onStop: () => void }) {
  const isStopped = agent.status === 'stopped';
  return (
    <div
      style={{
        padding: 14,
        background: '#fff',
        border: '1px solid #e5e7eb',
        borderRadius: 8,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        opacity: isStopped ? 0.6 : 1,
      }}
    >
      <div
        onClick={onOpen}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          cursor: 'pointer',
          flex: 1,
        }}
      >
        <StatusDot status={agent.status} />
        <div>
          <div style={{ fontWeight: 500, fontSize: 14 }}>
            {AGENT_OPTIONS.find((o) => o.type === agent.type)?.label ?? agent.type}
          </div>
          <div style={{ fontSize: 12, color: '#6b7280', fontFamily: 'monospace' }}>{agent.projectPath}</div>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, background: '#f3f4f6', color: '#6b7280' }}>
          {agent.status}
        </span>
        <span style={{ fontSize: 12, color: '#9ca3af' }}>
          {agent.startedAt ? new Date(agent.startedAt).toLocaleTimeString() : ''}
        </span>
        {!isStopped && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onStop();
            }}
            style={{
              padding: '4px 8px',
              fontSize: 11,
              border: '1px solid #fca5a5',
              borderRadius: 4,
              background: '#fff',
              color: '#dc2626',
              cursor: 'pointer',
            }}
          >
            Stop
          </button>
        )}
      </div>
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    running: '#22c55e',
    thinking: '#3b82f6',
    executing: '#8b5cf6',
    waiting_input: '#f59e0b',
    idle: '#6b7280',
    stopped: '#ef4444',
    starting: '#94a3b8',
    error: '#ef4444',
  };
  return (
    <span
      style={{
        display: 'inline-block',
        width: 10,
        height: 10,
        borderRadius: '50%',
        background: colors[status] ?? '#94a3b8',
      }}
    />
  );
}
