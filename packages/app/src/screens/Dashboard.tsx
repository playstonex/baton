import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import type { AgentProcess, AgentType } from '@baton/shared';
import { SystemStats } from '../components/SystemStats.js';
import { wsService } from '../services/websocket.js';
import { useAgentStore } from '../stores/connection.js';
import { PageHeader, Card, EmptyState, StatusBadge, StatusDot, Button, Input } from '../lib/ui.js';
import { IconServer } from '../lib/icons.js';

const AGENT_OPTIONS: {
  type: AgentType;
  label: string;
  desc: string;
}[] = [
  {
    type: 'claude-code',
    label: 'Claude Code',
    desc: 'Deep reasoning for large code changes and reviews.',
  },
  {
    type: 'codex',
    label: 'Codex',
    desc: 'Fast execution loops for shipping product work quickly.',
  },
  {
    type: 'opencode',
    label: 'OpenCode',
    desc: 'Flexible open-source runtime for portable workflows.',
  },
  {
    type: 'kiro-cli',
    label: 'Kiro CLI',
    desc: 'Amazon Kiro agent for spec-driven development.',
  },
];

export function DashboardScreen() {
  const navigate = useNavigate();
  const agents = useAgentStore((s) => s.agents);
  const { addAgent, removeAgent, setAgents, updateAgentStatus } = useAgentStore();
  const [projectPath, setProjectPath] = useState('');
  const [agentType, setAgentType] = useState<AgentType>('claude-code');
  const [mode, setMode] = useState<'chat' | 'terminal'>('chat');
  const [loading, setLoading] = useState(false);
  const [daemonOnline, setDaemonOnline] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/agents', { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((list: AgentProcess[]) => {
        setAgents(list);
        setDaemonOnline(true);
      })
      .catch((err) => {
        if (err.name !== 'AbortError') setDaemonOnline(false);
      });

    const unsubList = wsService.on('agent_list', (msg) => {
      if (msg.type === 'agent_list') {
        setAgents(
          msg.agents.map((agent) => ({
            id: agent.id,
            type: agent.type as AgentProcess['type'],
            projectPath: agent.projectPath,
            status: agent.status as AgentProcess['status'],
            startedAt: '',
            mode: agent.mode,
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
      controller.abort();
      unsubList();
      unsubStatus();
      unsubState();
    };
  }, [setAgents, updateAgentStatus]);

  async function startAgent() {
    if (!projectPath.trim()) return;
    setLoading(true);
    try {
      const res = await fetch('/api/agents/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentType,
          projectPath: projectPath.trim(),
          mode: mode === 'chat' ? 'sdk' : 'pty',
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        console.error(`Failed to start agent: ${err.error ?? 'Unknown error'}`);
        return;
      }

      const data = await res.json();
      addAgent({
        id: data.sessionId,
        type: agentType,
        projectPath: projectPath.trim(),
        status: 'running',
        startedAt: new Date().toISOString(),
        mode: mode === 'chat' ? 'sdk' : 'pty',
      });
      navigate(`/${mode}/${data.sessionId}`);
    } catch (err) {
      console.error(`Failed to connect to Daemon: ${err}`);
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

  const selectedAgent =
    AGENT_OPTIONS.find((option) => option.type === agentType) ?? AGENT_OPTIONS[0];

  return (
    <div className="max-w-5xl space-y-8">
      <PageHeader title="Baton" description="Agent orchestration dashboard" />

      <Card>
        <div className="mb-4 flex items-center gap-2">
          <StatusBadge status={daemonOnline ? 'connected' : 'disconnected'} />
        </div>

        <div className="mb-6 grid gap-6 md:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-geist-gray-800">Agent</label>
            <div className="grid grid-cols-2 gap-2">
              {AGENT_OPTIONS.map((opt) => (
                <button
                  key={opt.type}
                  type="button"
                  onClick={() => setAgentType(opt.type)}
                  className={`rounded-[var(--radius-sm)] border px-4 py-3 text-left text-sm font-medium transition-colors ${
                    agentType === opt.type
                      ? 'border-geist-gray-1000 bg-geist-gray-alpha-100 text-geist-gray-1000'
                      : 'border-geist-gray-alpha-400 text-geist-gray-800 hover:border-geist-gray-alpha-600'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-geist-gray-800">
              Project Path
            </label>
            <Input
              placeholder="/path/to/project"
              value={projectPath}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setProjectPath(e.target.value)}
              onKeyDown={(e: React.KeyboardEvent) => e.key === 'Enter' && startAgent()}
              className="font-mono"
            />
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <p className="text-sm text-geist-gray-800">{selectedAgent.desc}</p>
            <div className="flex shrink-0 overflow-hidden rounded-[var(--radius-sm)] border border-geist-gray-alpha-400">
              <button
                type="button"
                onClick={() => setMode('chat')}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  mode === 'chat'
                    ? 'bg-geist-gray-1000 text-geist-background-100'
                    : 'text-geist-gray-800 hover:bg-geist-gray-alpha-100'
                }`}
              >
                Chat
              </button>
              <button
                type="button"
                onClick={() => setMode('terminal')}
                className={`border-l border-geist-gray-alpha-400 px-3 py-1.5 text-xs font-medium transition-colors ${
                  mode === 'terminal'
                    ? 'bg-geist-gray-1000 text-geist-background-100'
                    : 'text-geist-gray-800 hover:bg-geist-gray-alpha-100'
                }`}
              >
                Terminal
              </button>
            </div>
          </div>
          <Button
            variant="primary"
            disabled={loading || !projectPath.trim() || !daemonOnline}
            onClick={startAgent}
            className="min-w-[140px]"
          >
            {loading ? 'Starting…' : `Launch ${selectedAgent.label}`}
          </Button>
        </div>
      </Card>

      <SystemStats />

      <div>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-geist-gray-1000">Active Sessions</h2>
          <span className="text-sm text-geist-gray-800">{agents.length} total</span>
        </div>

        {agents.length === 0 ? (
          <EmptyState
            icon={<IconServer className="h-6 w-6 text-geist-gray-700" />}
            title="No active sessions"
            description="Launch an agent to get started."
          />
        ) : (
          <div className="space-y-2">
            {agents.map((agent) => (
              <AgentCard
                key={agent.id}
                agent={agent}
                onOpen={() =>
                  navigate(
                    agent.mode === 'sdk'
                      ? `/chat/${agent.id}`
                      : `/terminal/${agent.id}`,
                  )
                }
                onStop={() => stopAgent(agent.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AgentCard({
  agent,
  onOpen,
  onStop,
}: {
  agent: AgentProcess;
  onOpen: () => void;
  onStop: () => void;
}) {
  const isStopped = agent.status === 'stopped';
  const label = AGENT_OPTIONS.find((option) => option.type === agent.type)?.label ?? agent.type;

  return (
    <Card className="flex items-center justify-between px-5 py-4" padding={false}>
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-3 py-4 pl-5 text-left"
      >
        <StatusDot status={agent.status} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-geist-gray-1000">{label}</span>
            <StatusBadge status={agent.status} />
          </div>
          <div className="mt-0.5 truncate font-mono text-xs text-geist-gray-800">
            {agent.projectPath}
          </div>
        </div>
      </button>

      {!isStopped && (
        <div className="px-5">
          <Button size="sm" variant="error" onClick={onStop}>
            Stop
          </Button>
        </div>
      )}
    </Card>
  );
}
