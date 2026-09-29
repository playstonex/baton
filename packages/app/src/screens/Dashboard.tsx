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
  /** For type 'acp': which ~/.baton/acp.json entry to spawn. */
  acpProvider?: string;
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
  /** Which ~/.baton/acp.json provider when agentType === 'acp'. */
  const [acpProvider, setAcpProvider] = useState<string>('');
  const [acpProviders, setAcpProviders] = useState<
    { name: string; label: string; available: boolean }[]
  >([]);
  const [mode, setMode] = useState<'chat' | 'terminal'>('chat');
  const [loading, setLoading] = useState(false);
  const [daemonOnline, setDaemonOnline] = useState(false);

  // Generic ACP providers become selectable agent options when configured.
  useEffect(() => {
    fetch('/api/acp/providers')
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((list: { name: string; label: string; available: boolean }[]) =>
        setAcpProviders(list.filter((p) => p.available)),
      )
      .catch(() => {
        // offline or no acp.json — static options only
      });
  }, []);

  const agentOptions = [
    ...AGENT_OPTIONS,
    ...acpProviders.map((p) => ({
      type: 'acp' as AgentType,
      label: p.label,
      desc: 'Generic ACP provider',
      acpProvider: p.name,
    })),
  ];

  const selectedAgent =
    agentOptions.find(
      (o) => o.type === agentType && (!o.acpProvider || o.acpProvider === acpProvider),
    ) ??
    (agentType === 'acp' && agentOptions.some((o) => o.type === 'acp')
      ? agentOptions.find((o) => o.type === 'acp')!
      : AGENT_OPTIONS[0]);

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
          ...(agentType === 'acp' && selectedAgent.acpProvider
            ? { acpProvider: selectedAgent.acpProvider }
            : {}),
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

  return (
    <div className="max-w-4xl space-y-8">
      <PageHeader
        title="Baton"
        description="Agent orchestration dashboard"
        actions={
          <StatusBadge status={daemonOnline ? 'connected' : 'disconnected'} />
        }
      />

      <Card className="p-6">
        <div className="mb-6 grid gap-6 md:grid-cols-2">
          <div>
            <label className="mb-2 block text-xs font-medium text-muted">Agent</label>
            <div className="grid grid-cols-2 gap-2">
              {agentOptions.map((opt) => {
                const selected =
                  opt.type === agentType &&
                  (!opt.acpProvider || opt.acpProvider === selectedAgent.acpProvider);
                return (
                  <button
                    key={opt.acpProvider ? `acp:${opt.acpProvider}` : opt.type}
                    type="button"
                    onClick={() => {
                      setAgentType(opt.type);
                      if (opt.acpProvider) setAcpProvider(opt.acpProvider);
                    }}
                    className={`rounded-sm border px-3 py-2.5 text-left text-[13px] font-medium transition-colors duration-150 ${
                      selected
                        ? 'border-accent bg-accent-soft text-fg'
                        : 'border-line bg-field text-fg-2 hover:border-line-strong hover:text-fg'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
            <p className="mt-3 text-xs leading-relaxed text-muted">{selectedAgent.desc}</p>
          </div>

          <div className="flex flex-col">
            <label className="mb-2 block text-xs font-medium text-muted">Project Path</label>
            <Input
              placeholder="/path/to/project"
              value={projectPath}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setProjectPath(e.target.value)}
              onKeyDown={(e: React.KeyboardEvent) => e.key === 'Enter' && startAgent()}
              className="font-mono"
            />

            <div className="mt-4 flex items-center gap-2">
              <SegmentedMode mode={mode} onChange={setMode} />
            </div>

            <Button
              variant="primary"
              size="lg"
              disabled={loading || !projectPath.trim() || !daemonOnline}
              onClick={startAgent}
              className="mt-auto w-full pt-0"
            >
              {loading ? 'Starting…' : `Launch ${selectedAgent.label}`}
            </Button>
          </div>
        </div>
      </Card>

      <SystemStats />

      <div>
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="text-[13px] font-semibold text-fg">Active sessions</h2>
          <span className="text-xs tabular-nums text-meta">{agents.length} total</span>
        </div>

        {agents.length === 0 ? (
          <EmptyState
            icon={<IconServer className="h-5 w-5" />}
            title="No active sessions"
            description="Launch an agent to get started."
          />
        ) : (
          <Card padding={false} className="divide-y divide-line-soft overflow-hidden">
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
          </Card>
        )}
      </div>
    </div>
  );
}

function SegmentedMode({
  mode,
  onChange,
}: {
  mode: 'chat' | 'terminal';
  onChange: (m: 'chat' | 'terminal') => void;
}) {
  const options: Array<{ key: 'chat' | 'terminal'; label: string }> = [
    { key: 'chat', label: 'Chat' },
    { key: 'terminal', label: 'Terminal' },
  ];
  return (
    <div className="inline-flex w-full rounded-sm border border-line-soft bg-raised p-0.5">
      {options.map((opt) => (
        <button
          key={opt.key}
          type="button"
          onClick={() => onChange(opt.key)}
          className={`flex-1 rounded-[calc(var(--radius-sm)-2px)] px-3 py-1.5 text-xs font-medium transition-colors duration-150 ${
            mode === opt.key
              ? 'bg-surface text-fg shadow-[var(--shadow-raised)] dark:bg-active'
              : 'text-muted hover:text-fg'
          }`}
        >
          {opt.label}
        </button>
      ))}
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
    <div className="flex items-center justify-between transition-colors duration-150 hover:bg-raised/50">
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 px-5 py-3.5 text-left">
        <StatusDot status={agent.status} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-medium text-fg">{label}</span>
            <StatusBadge status={agent.status} />
          </div>
          <div className="mt-0.5 truncate font-mono text-xs text-muted">
            {agent.projectPath}
          </div>
        </div>
      </button>

      {!isStopped && (
        <div className="pr-5">
          <Button size="sm" variant="error" onClick={onStop}>
            Stop
          </Button>
        </div>
      )}
    </div>
  );
}
