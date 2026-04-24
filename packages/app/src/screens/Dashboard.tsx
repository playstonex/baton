import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { Button, Card, CardContent, Input, Chip } from '@heroui/react';
import type { AgentProcess, AgentType } from '@baton/shared';
import { useAgentStore } from '../stores/connection.js';
import { wsService } from '../services/websocket.js';
import { SystemStats } from '../components/SystemStats.js';

const AGENT_OPTIONS: { type: AgentType; label: string; desc: string; icon: string }[] = [
  { type: 'claude-code', label: 'Claude Code', desc: 'Anthropic CLI agent', icon: '🤖' },
  { type: 'codex', label: 'Codex', desc: 'OpenAI CLI agent', icon: '⚡' },
  { type: 'opencode', label: 'OpenCode', desc: 'Open-source agent', icon: '🔓' },
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

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/agents', { signal: controller.signal })
      .then((res) => res.ok ? res.json() : Promise.reject())
      .then((list: AgentProcess[]) => { setAgents(list); setDaemonOnline(true); })
      .catch((err) => { if (err.name !== 'AbortError') setDaemonOnline(false); });

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
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary-600 via-primary-700 to-purple-700 px-8 py-10 text-white shadow-lg shadow-primary-600/20">
        <div className="pointer-events-none absolute -right-10 -top-10 h-48 w-48 rounded-full bg-white/10 blur-2xl" />
        <div className="pointer-events-none absolute -bottom-8 -left-8 h-40 w-40 rounded-full bg-purple-400/20 blur-2xl" />
        <div className="relative">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
              <p className="mt-1 text-sm text-white/70">Spawn and manage AI coding agents</p>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-4 rounded-xl bg-white/10 px-4 py-2 backdrop-blur-sm">
                <div className="text-center">
                  <div className="text-xl font-bold">{running}</div>
                  <div className="text-[10px] uppercase tracking-wider text-white/60">Running</div>
                </div>
                <div className="h-6 w-px bg-white/20" />
                <div className="text-center">
                  <div className="text-xl font-bold">{agents.length}</div>
                  <div className="text-[10px] uppercase tracking-wider text-white/60">Total</div>
                </div>
              </div>
              <Chip size="sm" variant="soft" color={daemonOnline ? 'success' : 'danger'}>
                {daemonOnline ? 'Daemon Online' : 'Daemon Offline'}
              </Chip>
            </div>
          </div>
        </div>
      </div>

      <SystemStats />

      <div>
        <div className="mb-4 flex items-center gap-3">
          <h3 className="text-base font-semibold text-surface-900 dark:text-white">Start Agent</h3>
          <div className="h-px flex-1 bg-surface-200 dark:bg-surface-700" />
        </div>

        <Card className="overflow-hidden border border-surface-200 shadow-sm transition-shadow hover:shadow-md dark:border-surface-700">
          <CardContent className="p-6">
            <div className="mb-5 grid grid-cols-3 gap-3">
              {AGENT_OPTIONS.map((opt) => (
                <button
                  key={opt.type}
                  type="button"
                  onClick={() => setAgentType(opt.type)}
                  className={`group relative rounded-xl border-2 p-4 text-left transition-all duration-200 ${
                    agentType === opt.type
                      ? 'border-primary-500 bg-primary-50 shadow-sm shadow-primary-200 dark:border-primary-400 dark:bg-primary-950/60 dark:shadow-none'
                      : 'border-surface-200 bg-white hover:border-surface-300 hover:bg-surface-50 dark:border-surface-700 dark:bg-surface-800/50 dark:hover:border-surface-600'
                  }`}
                >
                  {agentType === opt.type && (
                    <div className="absolute right-2 top-2 flex h-4 w-4 items-center justify-center rounded-full bg-primary-500 text-white">
                      <svg className="h-2.5 w-2.5" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path d="M2 6l3 3 5-5" />
                      </svg>
                    </div>
                  )}
                  <div className="text-xl">{opt.icon}</div>
                  <div className="mt-2 text-sm font-semibold text-surface-900 dark:text-white">{opt.label}</div>
                  <div className="mt-0.5 text-xs text-surface-500 dark:text-surface-400">{opt.desc}</div>
                </button>
              ))}
            </div>

            <div className="flex gap-3">
              <div className="flex-1">
                <label className="mb-1.5 block text-xs font-medium text-surface-500 dark:text-surface-400">
                  Project Path
                </label>
                <Input
                  placeholder="/path/to/your/project"
                  value={projectPath}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setProjectPath(e.target.value)}
                  onKeyDown={(e: React.KeyboardEvent) => e.key === 'Enter' && startAgent()}
                  className="font-mono text-sm"
                />
              </div>
              <div className="flex items-end">
                <Button
                  variant="primary"
                  isDisabled={loading || !projectPath.trim() || !daemonOnline}
                  onPress={startAgent}
                  className="px-6"
                >
                  {loading ? (
                    <span className="flex items-center gap-2">
                      <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Starting...
                    </span>
                  ) : (
                    `Start ${AGENT_OPTIONS.find((o) => o.type === agentType)?.label}`
                  )}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div>
        <div className="mb-4 flex items-center gap-3">
          <h3 className="text-base font-semibold text-surface-900 dark:text-white">
            Active Agents
          </h3>
          <span className="rounded-full bg-surface-100 px-2 py-0.5 text-xs font-medium text-surface-600 dark:bg-surface-800 dark:text-surface-400">
            {agents.length}
          </span>
          <div className="h-px flex-1 bg-surface-200 dark:bg-surface-700" />
        </div>

        {agents.length === 0 ? (
          <Card className="border border-dashed border-surface-300 bg-surface-50/50 dark:border-surface-600 dark:bg-surface-900/50">
            <CardContent className="flex flex-col items-center py-20 text-center">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-surface-100 dark:bg-surface-800">
                <span className="text-3xl">🚀</span>
              </div>
              <h4 className="text-sm font-semibold text-surface-700 dark:text-surface-300">No agents running</h4>
              <p className="mt-1 text-xs text-surface-400">Enter a project path above to start your first agent.</p>
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
  const isActive = agent.status === 'running' || agent.status === 'thinking';
  return (
    <Card
      className={`group border border-surface-200 shadow-sm transition-all duration-200 dark:border-surface-700 ${
        isStopped
          ? 'opacity-50'
          : 'hover:border-primary-200 hover:shadow-md dark:hover:border-primary-800'
      }`}
    >
      <CardContent className="flex items-center justify-between px-5 py-4">
        <Button variant="ghost" onPress={onOpen} className="flex flex-1 items-center gap-3.5 justify-start">
          <span className="relative flex h-3 w-3">
            {isActive && (
              <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-40 ${agent.status === 'thinking' ? 'bg-primary-400' : 'bg-success-400'}`} />
            )}
            <span
              className={`relative inline-flex h-3 w-3 rounded-full ${
                agent.status === 'running'
                  ? 'bg-success-500'
                  : agent.status === 'thinking'
                    ? 'bg-primary-500 animate-pulse-dot'
                    : agent.status === 'stopped'
                      ? 'bg-danger-500'
                      : 'bg-surface-300'
              }`}
            />
          </span>
          <div className="text-left">
            <div className="text-sm font-medium text-surface-900 dark:text-white">
              {AGENT_OPTIONS.find((o) => o.type === agent.type)?.label ?? agent.type}
            </div>
            <div className="mt-0.5 flex items-center gap-2">
              <span className="truncate font-mono text-xs text-surface-400">{agent.projectPath}</span>
            </div>
          </div>
        </Button>
        <div className="flex items-center gap-3">
          <Chip size="sm" variant="soft" color={STATUS_COLORS[agent.status] ?? 'default'}>
            {agent.status.replace('_', ' ')}
          </Chip>
          <span className="min-w-[52px] text-right text-[11px] tabular-nums text-surface-400">
            {agent.startedAt ? new Date(agent.startedAt).toLocaleTimeString() : ''}
          </span>
          {!isStopped && (
            <Button size="sm" variant="danger-soft" onPress={onStop} className="transition-colors">
              Stop
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
