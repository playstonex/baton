import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Button, Input } from '@heroui/react';
import type { AgentProcess, AgentType } from '@baton/shared';
import { SystemStats } from '../components/SystemStats.js';
import { wsService } from '../services/websocket.js';
import { useAgentStore } from '../stores/connection.js';
import { PageHeader, Card, EmptyState, StatusBadge, StatusDot } from '../lib/ui.js';
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
        body: JSON.stringify({ agentType, projectPath: projectPath.trim() }),
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
      });
      navigate(`/terminal/${data.sessionId}`);
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
    <div className="space-y-10 max-w-5xl">
      <PageHeader title="Baton" description="Agent orchestration dashboard" />

      <Card>
        <div className="mb-5 flex items-center gap-2">
          <StatusBadge status={daemonOnline ? 'connected' : 'disconnected'} />
        </div>

        <div className="mb-6 grid gap-6 md:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-600 dark:text-gray-400">
              Agent
            </label>
            <div className="flex gap-4">
              {AGENT_OPTIONS.map((opt) => (
                <button
                  key={opt.type}
                  type="button"
                  onClick={() => setAgentType(opt.type)}
                  className={`flex-1 rounded-lg border px-5 py-3.5 text-left text-sm transition-colors ${
                    agentType === opt.type
                      ? 'border-primary-500 bg-primary-50 text-primary-700 dark:bg-primary-950 dark:text-primary-300'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300 dark:border-gray-700 dark:text-gray-300 dark:hover:border-gray-600'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-600 dark:text-gray-400">
              Project Path
            </label>
            <Input
              placeholder="/path/to/project"
              value={projectPath}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setProjectPath(e.target.value)
              }
              onKeyDown={(e: React.KeyboardEvent) => e.key === 'Enter' && startAgent()}
              className="font-mono text-sm [&>div]:bg-gray-50 [&>div]:dark:bg-gray-950 [&>div]:border-gray-200 [&>div]:dark:border-gray-700"
            />
          </div>
        </div>

        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {selectedAgent.desc}
          </p>
          <Button
            variant="primary"
            isDisabled={loading || !projectPath.trim() || !daemonOnline}
            onPress={startAgent}
            className="min-w-[140px]"
          >
            {loading ? 'Starting...' : `Launch ${selectedAgent.label}`}
          </Button>
        </div>
      </Card>

      <SystemStats />

      <div>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Active Sessions
          </h2>
          <span className="text-sm text-gray-500 dark:text-gray-400">
            {agents.length} total
          </span>
        </div>

        {agents.length === 0 ? (
          <EmptyState
            icon={<IconServer className="h-6 w-6 text-gray-400" />}
            title="No active sessions"
            description="Launch an agent to get started."
          />
        ) : (
          <div className="space-y-2">
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
    <Card className="flex items-center justify-between px-6 py-5">
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
      >
        <StatusDot status={agent.status} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-gray-900 dark:text-white">
              {label}
            </span>
            <StatusBadge status={agent.status} />
          </div>
          <div className="mt-1 truncate font-mono text-xs text-gray-500 dark:text-gray-400">
            {agent.projectPath}
          </div>
        </div>
      </button>

      {!isStopped && (
        <Button size="sm" variant="danger" onPress={onStop}>
          Stop
        </Button>
      )}
    </Card>
  );
}
