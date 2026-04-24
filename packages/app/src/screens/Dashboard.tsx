import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router';
import { Button, Card, CardContent, Input, Chip } from '@heroui/react';
import type { AgentProcess, AgentType } from '@baton/shared';
import { useAgentStore } from '../stores/connection.js';
import { wsService } from '../services/websocket.js';
import { SystemStats } from '../components/SystemStats.js';

const AGENT_OPTIONS: { type: AgentType; label: string; desc: string }[] = [
  { type: 'claude-code', label: 'Claude Code', desc: 'Anthropic CLI agent' },
  { type: 'codex', label: 'Codex', desc: 'OpenAI CLI agent' },
  { type: 'opencode', label: 'OpenCode', desc: 'Open-source agent' },
];

const STATUS_COLORS: Record<string, 'success' | 'accent' | 'default' | 'warning' | 'danger'> = {
  running: 'success',
  thinking: 'accent',
  executing: 'default',
  waiting_input: 'warning',
  idle: 'default',
  stopped: 'danger',
  starting: 'default',
  error: 'danger',
};

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
    <div className="mx-auto max-w-4xl space-y-8">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-surface-900 dark:text-white">Dashboard</h2>
        <div className="flex items-center gap-3">
          <span className="text-xs text-surface-500">
            {running} running / {agents.length} total
          </span>
          <Chip size="sm" variant="soft" color={daemonOnline ? 'success' : 'danger'}>
            {daemonOnline ? 'Daemon Online' : 'Daemon Offline'}
          </Chip>
        </div>
      </div>

      <SystemStats />

      <Card>
        <CardContent className="p-5">
          <h3 className="mb-3 text-sm font-semibold text-surface-900 dark:text-white">Start Agent</h3>

          <div className="mb-3 flex gap-2">
            {AGENT_OPTIONS.map((opt) => (
              <Button
                key={opt.type}
                variant={agentType === opt.type ? 'primary' : 'secondary'}
                className="flex-1 justify-start text-left"
                onPress={() => setAgentType(opt.type)}
              >
                <div>
                  <div className="text-[13px] font-semibold">{opt.label}</div>
                  <div className="text-[11px] opacity-60">{opt.desc}</div>
                </div>
              </Button>
            ))}
          </div>

          <div className="flex gap-2">
            <div className="flex-1">
              <Input
                placeholder="/path/to/your/project"
                value={projectPath}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setProjectPath(e.target.value)}
                onKeyDown={(e: React.KeyboardEvent) => e.key === 'Enter' && startAgent()}
                className="font-mono text-sm"
              />
            </div>
            <Button
              variant="primary"
              isDisabled={loading || !projectPath.trim() || !daemonOnline}
              onPress={startAgent}
              className="px-6"
            >
              {loading ? 'Starting...' : `Start ${AGENT_OPTIONS.find((o) => o.type === agentType)?.label}`}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div>
        <h3 className="mb-3 text-sm font-semibold text-surface-900 dark:text-white">
          Active Agents
          <span className="ml-1.5 font-normal text-surface-400">({agents.length})</span>
        </h3>

        {agents.length === 0 ? (
          <Card>
            <CardContent className="py-16 text-center text-sm text-surface-400">
              No agents running. Enter a project path above to start.
            </CardContent>
          </Card>
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

function AgentCard({ agent, onOpen, onStop }: { agent: AgentProcess; onOpen: () => void; onStop: () => void }) {
  const isStopped = agent.status === 'stopped';
  return (
    <Card className={isStopped ? 'opacity-50' : ''}>
      <CardContent className="flex items-center justify-between px-4 py-3">
        <Button variant="ghost" onPress={onOpen} className="flex flex-1 items-center gap-3 justify-start">
          <span className={`inline-block h-2.5 w-2.5 rounded-full ${agent.status === 'running' ? 'bg-success-500' : agent.status === 'thinking' ? 'bg-primary-500 animate-pulse-dot' : agent.status === 'stopped' ? 'bg-danger-500' : 'bg-surface-300'}`} />
          <div className="text-left">
            <div className="text-sm font-medium text-surface-900 dark:text-white">
              {AGENT_OPTIONS.find((o) => o.type === agent.type)?.label ?? agent.type}
            </div>
            <div className="font-mono text-xs text-surface-400">{agent.projectPath}</div>
          </div>
        </Button>
        <div className="flex items-center gap-2.5">
          <Chip size="sm" variant="soft" color={STATUS_COLORS[agent.status] ?? 'default'}>
            {agent.status}
          </Chip>
          <span className="text-[11px] text-surface-400">
            {agent.startedAt ? new Date(agent.startedAt).toLocaleTimeString() : ''}
          </span>
          {!isStopped && (
            <Button size="sm" variant="danger" onPress={onStop}>
              Stop
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
