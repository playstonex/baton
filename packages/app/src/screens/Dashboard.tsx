import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import type { AgentProcess, AgentType, SessionSummary } from '@baton/shared';
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
    type: 'kiro',
    label: 'Kiro',
    desc: 'Amazon Kiro agent for spec-driven development.',
  },
  {
    type: 'antigravity',
    label: 'Antigravity',
    desc: "Google's terminal agent from the Antigravity IDE (agy).",
  },
  {
    type: 'pi',
    label: 'Pi',
    desc: 'Minimalist, extensible coding agent (pi).',
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
  const [pastSessions, setPastSessions] = useState<SessionSummary[]>([]);
  const [showArchived, setShowArchived] = useState(false);

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
    let cancelled = false;
    const fetchAgents = () => {
      fetch('/api/agents')
        .then((res) => (res.ok ? res.json() : Promise.reject()))
        .then((list: AgentProcess[]) => {
          if (!cancelled) {
            setAgents(list);
            setDaemonOnline(true);
          }
        })
        .catch(() => {
          if (!cancelled) setDaemonOnline(false);
        });
    };

    fetchAgents();

    const unsubList = wsService.on('agent_list', (msg) => {
      if (msg.type === 'agent_list') {
        setAgents(
          msg.agents.map((agent) => ({
            id: agent.id,
            type: agent.type as AgentProcess['type'],
            projectPath: agent.projectPath,
            status: agent.status as AgentProcess['status'],
            startedAt: agent.startedAt ?? '',
            mode: agent.mode,
            title: agent.title,
            lastActivityAt: agent.lastActivityAt,
            stoppedAt: agent.stoppedAt,
            stateDetail: agent.detail,
          })),
        );
      }
    });

    const unsubStatus = wsService.on('status_update', (msg) => {
      if (msg.type === 'status_update' && 'status' in msg) {
        updateAgentStatus(msg.sessionId, msg.status as AgentProcess['status'], msg.detail);
      }
    });

    const unsubState = wsService.on('_state', () => {
      setDaemonOnline(wsService.connected);
      // Reconnect reconcile (lunel's pattern): after a socket drop the store
      // may have missed transitions — pull the authoritative list instead of
      // waiting for the next push.
      if (wsService.connected) fetchAgents();
    });

    wsService.connect();

    return () => {
      cancelled = true;
      unsubList();
      unsubStatus();
      unsubState();
    };
  }, [setAgents, updateAgentStatus]);

  // Past sessions come from the daemon's persistent store — they survive
  // daemon restarts, unlike the in-memory live list.
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/sessions?limit=50${showArchived ? '&includeArchived=1' : ''}`, {
      signal: controller.signal,
    })
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data: { sessions: SessionSummary[] }) => setPastSessions(data.sessions))
      .catch(() => {
        // daemon offline — keep whatever we had
      });
    return () => controller.abort();
  }, [showArchived, daemonOnline, agents]);

  async function archiveSession(id: string) {
    setPastSessions((prev) => prev.filter((s) => s.id !== id));
    await fetch(`/api/agents/${id}/archive`, { method: 'POST' }).catch(() => {});
  }

  async function deleteSession(id: string) {
    setPastSessions((prev) => prev.filter((s) => s.id !== id));
    removeAgent(id);
    await fetch(`/api/agents/${id}`, { method: 'DELETE' }).catch(() => {});
  }

  async function resumeSession(session: SessionSummary) {
    try {
      const res = await fetch(`/api/agents/${session.id}/resume`, { method: 'POST' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Resume failed' }));
        console.error(`Failed to resume: ${err.error ?? 'Unknown'}`);
        return;
      }
      const data = await res.json();
      navigate(session.mode === 'sdk' ? `/chat/${data.sessionId}` : `/terminal/${data.sessionId}`);
    } catch (err) {
      console.error(`Failed to resume: ${err}`);
    }
  }

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
      // Keep the row — the daemon broadcasts a fresh agent_list marking it
      // stopped, and it moves to the history section below.
    } catch {
      // ignore
    }
  }

  // Needs-your-attention first, then busy, then idle (paseo's bucket order).
  const activeAgents = agents
    .filter((a) => a.status !== 'stopped')
    .sort((a, b) => (STATUS_PRIORITY[a.status] ?? 9) - (STATUS_PRIORITY[b.status] ?? 9));
  const liveIds = new Set(activeAgents.map((a) => a.id));
  const pastList = pastSessions.filter((s) => !liveIds.has(s.id) && (!s.archivedAt || showArchived));

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
          <span className="text-xs tabular-nums text-meta">{activeAgents.length} total</span>
        </div>

        {activeAgents.length === 0 ? (
          <EmptyState
            icon={<IconServer className="h-5 w-5" />}
            title="No active sessions"
            description="Launch an agent to get started."
          />
        ) : (
          <Card padding={false} className="divide-y divide-line-soft overflow-hidden">
            {activeAgents.map((agent) => (
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

      <div>
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="text-[13px] font-semibold text-fg">Recent sessions</h2>
          <button
            type="button"
            onClick={() => setShowArchived((v) => !v)}
            className="text-xs text-muted transition-colors duration-150 hover:text-fg"
          >
            {showArchived ? 'Hide archived' : 'Show archived'}
          </button>
        </div>

        {pastList.length === 0 ? (
          <EmptyState
            icon={<IconServer className="h-5 w-5" />}
            title="No past sessions"
            description="Finished sessions are kept here with their transcripts."
          />
        ) : (
          <Card padding={false} className="divide-y divide-line-soft overflow-hidden">
            {pastList.map((session) => (
              <PastSessionRow
                key={session.id}
                session={session}
                onOpen={() =>
                  navigate(session.mode === 'sdk' ? `/chat/${session.id}` : `/terminal/${session.id}`)
                }
                onResume={() => resumeSession(session)}
                onArchive={() => archiveSession(session.id)}
                onDelete={() => deleteSession(session.id)}
              />
            ))}
          </Card>
        )}
      </div>
    </div>
  );
}

/** Needs-your-attention first, then busy, then idle (paseo's bucket order). */
const STATUS_PRIORITY: Record<string, number> = {
  waiting_input: 0,
  error: 1,
  executing: 2,
  thinking: 3,
  running: 4,
  starting: 5,
  idle: 6,
  stopped: 7,
};

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
  const label = AGENT_OPTIONS.find((option) => option.type === agent.type)?.label ?? agent.type;
  const now = useNow();
  const activity = activityLine(agent, now);

  return (
    <div className="flex items-center justify-between transition-colors duration-150 hover:bg-raised/50">
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 px-5 py-3.5 text-left">
        <StatusDot status={agent.status} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-[13px] font-medium text-fg">
              {agent.title ?? label}
            </span>
            <StatusBadge status={agent.status} />
          </div>
          <div className="mt-0.5 truncate font-mono text-xs text-muted">
            {label !== (agent.title ?? label) ? `${label} · ` : ''}
            {agent.projectPath}
          </div>
          {activity && (
            <div className={`mt-0.5 truncate text-xs ${activity.className}`}>{activity.text}</div>
          )}
        </div>
      </button>

        <div className="pr-5">
          <Button size="sm" variant="error" onClick={onStop}>
            Stop
          </Button>
        </div>
      </div>
  );
}

/** Ticks once a second so status durations stay live on the dashboard. */
function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes}m ${total % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

/**
 * Display-level staleness marker (open-claude-code's TOOL_DISPLAY_EXPIRY
 * idea): a "busy" session whose last output is over a minute old is probably
 * wedged — say so instead of ticking an ever-growing timer like nothing's wrong.
 */
function quietSuffix(agent: AgentProcess, now: number): string {
  if (!agent.lastActivityAt) return '';
  const last = Date.parse(agent.lastActivityAt);
  if (Number.isNaN(last)) return '';
  const quietMs = now - last;
  if (quietMs < 60_000) return '';
  return ` · no activity ${formatDuration(quietMs)}`;
}

/** One-line answer to "what is this session doing right now?" */
function activityLine(
  agent: AgentProcess,
  now: number,
): { text: string; className: string } | null {
  const detail = agent.stateDetail;
  switch (agent.status) {
    case 'executing': {
      if (!detail) return null;
      const tool =
        detail.toolTitle ?? (detail.tool && detail.tool !== 'unknown' ? detail.tool : 'tool');
      return {
        text: `Running ${tool} · ${formatDuration(now - detail.since)}${quietSuffix(agent, now)}`,
        className: 'text-accent-hover',
      };
    }
    case 'thinking':
      return detail
        ? {
            text: `Thinking · ${formatDuration(now - detail.since)}${quietSuffix(agent, now)}`,
            className: 'text-accent-hover',
          }
        : null;
    case 'running': {
      if (!detail) return null;
      const calls = detail.toolCount
        ? ` · ${detail.toolCount} tool call${detail.toolCount === 1 ? '' : 's'}`
        : '';
      return {
        text: `Working${calls} · ${formatDuration(now - detail.since)}${quietSuffix(agent, now)}`,
        className: 'text-success',
      };
    }
    case 'waiting_input': {
      const prompt = detail?.prompt?.replace(/\s+/g, ' ').trim();
      return prompt
        ? { text: `Waiting for you: ${prompt}`, className: 'text-warn' }
        : null;
    }
    case 'idle': {
      if (!detail) return null;
      const last = agent.lastActivityAt ? relativeTime(agent.lastActivityAt) : '';
      return { text: `Idle${last ? ` · last activity ${last}` : ''}`, className: 'text-warn' };
    }
    case 'error':
      return detail?.error ? { text: detail.error, className: 'text-danger' } : null;
    case 'starting':
      return { text: 'Starting…', className: 'text-muted' };
    default:
      return null;
  }
}

function relativeTime(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const diff = Date.now() - then;
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(then).toLocaleDateString();
}

function PastSessionRow({
  session,
  onOpen,
  onResume,
  onArchive,
  onDelete,
}: {
  session: SessionSummary;
  onOpen: () => void;
  onResume: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const label =
    AGENT_OPTIONS.find((option) => option.type === session.type)?.label ?? session.type;

  return (
    <div className="flex items-center justify-between transition-colors duration-150 hover:bg-raised/50">
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 px-5 py-3 text-left">
        <StatusDot status={session.status} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`truncate text-[13px] font-medium ${session.archivedAt ? 'text-muted line-through' : 'text-fg'}`}>
              {session.title ?? `${label} session`}
            </span>
            {session.resumedFrom && (
              <span className="shrink-0 rounded-sm border border-line-soft px-1.5 py-0.5 text-[10px] text-muted">
                resumed
              </span>
            )}
            <span className="shrink-0 text-[11px] text-meta">
              {relativeTime(session.updatedAt)}
              {session.eventCount > 0 ? ` · ${session.eventCount} events` : ''}
            </span>
          </div>
          <div className="mt-0.5 truncate font-mono text-xs text-muted">
            {label} · {session.projectPath}
          </div>
        </div>
      </button>

      <div className="flex shrink-0 items-center gap-2 pr-5">
        {!session.archivedAt && (
          <Button size="sm" variant="secondary" onClick={onResume}>
            Resume
          </Button>
        )}
        <Button size="sm" variant="tertiary" onClick={onArchive}>
          Archive
        </Button>
        <Button size="sm" variant="error" onClick={onDelete}>
          Delete
        </Button>
      </div>
    </div>
  );
}
