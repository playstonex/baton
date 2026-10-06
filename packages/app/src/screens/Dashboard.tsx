import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { AnimatePresence, cubicBezier, motion } from 'framer-motion';
import type { AgentProcess, AgentType, SessionSummary } from '@baton/shared';
import { SystemStats } from '../components/SystemStats.js';
import { wsService } from '../services/websocket.js';
import { useAgentStore } from '../stores/connection.js';
import { PageHeader, Card, EmptyState, StatusDot, Button, Input, SectionHeader, SegmentedControl } from '../lib/ui.js';
import {
  IconAlertCircle,
  IconArchive,
  IconArrowRight,
  IconPlus,
  IconRefreshCw,
  IconSearch,
  IconTrash,
  IconX,
} from '../lib/icons.js';

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
  const [launchOpen, setLaunchOpen] = useState(false);
  const [query, setQuery] = useState('');

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

  const agentOptions = useMemo(
    () => [
      ...AGENT_OPTIONS,
      ...acpProviders.map((p) => ({
        type: 'acp' as AgentType,
        label: p.label,
        desc: 'Generic ACP provider',
        acpProvider: p.name,
      })),
    ],
    [acpProviders],
  );

  const selectedAgent =
    agentOptions.find(
      (o) => o.type === agentType && (!o.acpProvider || o.acpProvider === acpProvider),
    ) ??
    (agentType === 'acp' && agentOptions.some((o) => o.type === 'acp')
      ? agentOptions.find((o) => o.type === 'acp')!
      : AGENT_OPTIONS[0]);

  const fetchAgents = useCallback(() => {
    fetch('/api/agents')
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((list: AgentProcess[]) => {
        setAgents(list);
        setDaemonOnline(true);
      })
      .catch(() => {
        setDaemonOnline(false);
      });
  }, [setAgents]);

  useEffect(() => {
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
    fetchAgents();

    return () => {
      unsubList();
      unsubStatus();
      unsubState();
    };
  }, [fetchAgents, setAgents, updateAgentStatus]);

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
    if (!projectPath.trim() || !daemonOnline) return;
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
      setLaunchOpen(false);
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

  function retryConnection() {
    wsService.connect();
    fetchAgents();
  }

  // Needs-your-attention first, then busy, then idle (paseo's bucket order).
  const activeAgents = agents
    .filter((a) => a.status !== 'stopped')
    .sort((a, b) => (STATUS_PRIORITY[a.status] ?? 9) - (STATUS_PRIORITY[b.status] ?? 9));
  const liveIds = new Set(activeAgents.map((a) => a.id));
  const pastList = pastSessions.filter((s) => !liveIds.has(s.id) && (!s.archivedAt || showArchived));

  const filteredPast = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return pastList;
    return pastList.filter((s) => {
      const label = AGENT_OPTIONS.find((o) => o.type === s.type)?.label ?? s.type;
      return `${s.title ?? ''} ${label} ${s.projectPath}`.toLowerCase().includes(q);
    });
  }, [pastList, query]);

  // Most recently used project paths — quick-fill chips in the launch dialog.
  const recentPaths = useMemo(() => {
    const seen = new Set<string>();
    for (const s of pastSessions) {
      if (s.projectPath && !seen.has(s.projectPath)) seen.add(s.projectPath);
      if (seen.size >= 3) break;
    }
    return [...seen];
  }, [pastSessions]);

  const openLaunch = () => {
    if (daemonOnline) setLaunchOpen(true);
  };

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Dashboard"
        description="Everything running on this host, at a glance."
        actions={
          <>
            <button
              type="button"
              onClick={() => navigate('/settings')}
              className="inline-flex h-7 items-center gap-2 rounded-full border border-line px-3 text-xs font-medium text-fg-2 transition-colors duration-150 hover:border-line-strong hover:text-fg"
            >
              <StatusDot status={daemonOnline ? 'connected' : 'disconnected'} />
              {daemonOnline ? 'Connected' : 'Offline'}
            </button>
            <Button
              variant="primary"
              onClick={openLaunch}
              disabled={!daemonOnline}
              title={daemonOnline ? undefined : 'Daemon offline'}
            >
              <IconPlus className="h-3.5 w-3.5" />
              New session
            </Button>
          </>
        }
      />

      {!daemonOnline ? (
        <OfflinePanel onRetry={retryConnection} />
      ) : (
        <SystemStats />
      )}

      {daemonOnline && (
        <section className="mb-7">
          <SectionHeader title="Active" count={activeAgents.length} />
          {activeAgents.length === 0 ? (
            <EmptyState
              icon={<IconArrowRight className="h-5 w-5" />}
              title="No active sessions"
              description="Pick an agent, point it at a project, and it starts on this host — chat for rich rendering, terminal for a raw PTY."
              action={
                <Button variant="secondary" onClick={openLaunch}>
                  Start your first session
                </Button>
              }
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
        </section>
      )}

      <section>
        <SectionHeader title="Recent" count={filteredPast.length}>
          {daemonOnline ? (
            <div className="flex items-center gap-2">
              <label className="flex h-7 w-52 items-center gap-1.5 rounded-sm border border-line bg-field px-2 text-meta transition-colors duration-150 focus-within:border-accent">
                <IconSearch className="h-3.5 w-3.5 shrink-0" />
                <input
                  value={query}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}
                  placeholder="Filter sessions"
                  className="w-full bg-transparent text-[13px] text-fg outline-none placeholder:text-meta"
                />
              </label>
              <button
                type="button"
                onClick={() => setShowArchived((v) => !v)}
                className={`inline-flex h-7 items-center rounded-full border px-3 text-xs font-medium transition-colors duration-150 ${
                  showArchived
                    ? 'border-accent/40 bg-accent-soft text-accent-hover'
                    : 'border-line text-muted hover:text-fg'
                }`}
              >
                Archived
              </button>
            </div>
          ) : (
            <span className="text-xs text-meta">
              Showing the last known list — it may be stale.
            </span>
          )}
        </SectionHeader>

        {filteredPast.length === 0 ? (
          query.trim() ? (
            <EmptyState
              icon={<IconSearch className="h-5 w-5" />}
              title="No sessions match"
              description={`Nothing in the recent list matches “${query.trim()}”.`}
            />
          ) : (
            <div className="rounded-md border border-dashed border-line px-6 py-10 text-center">
              <h4 className="text-[13px] font-medium text-muted">No past sessions</h4>
              <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-muted">
                Finished sessions are kept here with their full transcripts, ready to resume.
              </p>
            </div>
          )
        ) : (
          <Card padding={false} className="divide-y divide-line-soft overflow-hidden">
            {filteredPast.map((session) => (
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
      </section>

      <LaunchDialog
        open={launchOpen}
        onClose={() => setLaunchOpen(false)}
        agentOptions={agentOptions}
        selectedAgent={selectedAgent}
        onSelect={(opt) => {
          setAgentType(opt.type);
          if (opt.acpProvider) setAcpProvider(opt.acpProvider);
        }}
        mode={mode}
        onModeChange={setMode}
        projectPath={projectPath}
        onProjectPathChange={setProjectPath}
        recentPaths={recentPaths}
        loading={loading}
        onSubmit={startAgent}
      />
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

/* ─────────────────────────────────────────────
   Offline — honest state with a recovery path,
   shown instead of telemetry + active list.
   ───────────────────────────────────────────── */
function OfflinePanel({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="mb-7 flex items-center gap-3.5 rounded-md border border-danger/25 bg-surface px-4 py-4">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-danger-soft text-danger">
        <IconAlertCircle className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold text-fg">Can't reach the daemon</div>
        <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">
          The Baton daemon isn't responding on{' '}
          <code className="rounded bg-raised px-1 py-px font-mono text-[11px] text-fg-2">
            {wsService.httpUrl}
          </code>
          . Start it on the host with{' '}
          <code className="rounded bg-raised px-1 py-px font-mono text-[11px] text-fg-2">
            baton daemon start
          </code>
          , then retry.
        </p>
      </div>
      <Button size="sm" variant="secondary" onClick={onRetry} className="shrink-0">
        <IconRefreshCw className="h-3.5 w-3.5" />
        Retry
      </Button>
    </div>
  );
}

/* ─────────────────────────────────────────────
   Launch dialog — the launcher's new home.
   Command-palette style: agent tiles, project path
   with recent quick-fills, mode. ↵ launches.
   ───────────────────────────────────────────── */
type AgentOption = (typeof AGENT_OPTIONS)[number];

function LaunchDialog({
  open,
  onClose,
  agentOptions,
  selectedAgent,
  onSelect,
  mode,
  onModeChange,
  projectPath,
  onProjectPathChange,
  recentPaths,
  loading,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  agentOptions: AgentOption[];
  selectedAgent: AgentOption;
  onSelect: (opt: AgentOption) => void;
  mode: 'chat' | 'terminal';
  onModeChange: (m: 'chat' | 'terminal') => void;
  projectPath: string;
  onProjectPathChange: (v: string) => void;
  recentPaths: string[];
  loading: boolean;
  onSubmit: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="overlay"
          className="fixed inset-0 z-50 flex items-start justify-center bg-overlay px-4 pt-[12vh]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={onClose}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="New session"
            className="w-full max-w-[560px] rounded-lg border border-line-soft bg-surface shadow-[var(--shadow-modal)]"
            initial={{ opacity: 0, y: 8, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.985 }}
            transition={{ duration: 0.18, ease: cubicBezier(0.2, 0, 0, 1) }}
            onClick={(e) => e.stopPropagation()}
          >
            <form
              onSubmit={(e) => {
                e.preventDefault();
                onSubmit();
              }}
            >
              <div className="flex items-center justify-between px-4 pt-3.5">
                <h3 className="text-sm font-semibold text-fg">New session</h3>
                <div className="flex items-center gap-2">
                  <kbd className="rounded border border-line px-1.5 py-0.5 font-mono text-[10px] text-muted">
                    esc
                  </kbd>
                  <button
                    type="button"
                    onClick={onClose}
                    aria-label="Close"
                    className="flex h-7 w-7 items-center justify-center rounded-sm text-muted transition-colors duration-150 hover:bg-raised hover:text-fg"
                  >
                    <IconX className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              <div className="px-4 pb-1 pt-3.5">
                <div className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.07em] text-meta">
                  Agent
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  {agentOptions.map((opt) => {
                    const selected =
                      opt.type === selectedAgent.type &&
                      (!opt.acpProvider || opt.acpProvider === selectedAgent.acpProvider);
                    return (
                      <button
                        key={opt.acpProvider ? `acp:${opt.acpProvider}` : opt.type}
                        type="button"
                        onClick={() => onSelect(opt)}
                        className={`rounded-sm border px-2.5 py-2 text-left text-[13px] font-medium transition-colors duration-150 ${
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
                <p className="mt-2 min-h-[18px] text-xs text-muted">{selectedAgent.desc}</p>

                <div className="mb-1.5 mt-4 text-[11px] font-medium uppercase tracking-[0.07em] text-meta">
                  Project path
                </div>
                <Input
                  autoFocus
                  value={projectPath}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    onProjectPathChange(e.target.value)
                  }
                  placeholder="/path/to/project"
                  className="font-mono text-[12.5px]"
                />
                {recentPaths.length > 0 && (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] text-meta">Recent</span>
                    {recentPaths.map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => onProjectPathChange(p)}
                        className="max-w-[220px] truncate rounded-full border border-line-soft px-2.5 py-0.5 font-mono text-[10.5px] text-muted transition-colors duration-150 hover:border-line-strong hover:text-fg"
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                )}

                <div className="mb-1.5 mt-4 text-[11px] font-medium uppercase tracking-[0.07em] text-meta">
                  Mode
                </div>
                <SegmentedControl
                  value={mode}
                  onChange={onModeChange}
                  options={[
                    { key: 'chat', label: 'Chat' },
                    { key: 'terminal', label: 'Terminal' },
                  ]}
                  className="flex w-full [&>button]:flex-1"
                />
                <p className="mt-2 text-xs text-muted">
                  <span className="font-medium text-fg-2">Chat</span> — SDK session with rich
                  rendering. Switch to{' '}
                  <span className="font-medium text-fg-2">Terminal</span> for a raw PTY in the
                  browser.
                </p>
              </div>

              <div className="mt-2.5 flex items-center justify-between border-t border-line-soft px-4 py-3.5">
                <span className="flex items-center gap-1.5 text-xs text-meta">
                  <kbd className="rounded border border-line px-1.5 py-0.5 font-mono text-[10px]">
                    ↵
                  </kbd>
                  to launch
                </span>
                <div className="flex items-center gap-2">
                  <Button type="button" variant="tertiary" onClick={onClose}>
                    Cancel
                  </Button>
                  <Button type="submit" variant="primary" disabled={loading || !projectPath.trim()}>
                    {loading ? 'Starting…' : `Launch ${selectedAgent.label}`}
                  </Button>
                </div>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ─────────────────────────────────────────────
   Active session row — status dot carries state
   (no badge for the ordinary cases); rows that need
   you get a rail + tint so they pop in a scan.
   ───────────────────────────────────────────── */
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
  const attention: 'warn' | 'danger' | null =
    agent.status === 'waiting_input' ? 'warn' : agent.status === 'error' ? 'danger' : null;

  const sinceMs = agent.stateDetail?.since ? now - agent.stateDetail.since : sinceStart(agent, now);
  const dur = sinceMs != null ? formatDuration(sinceMs) : '';

  return (
    <div
      className={`relative flex items-center transition-colors duration-150 ${
        attention === 'warn'
          ? 'bg-[color-mix(in_srgb,var(--color-warn)_5%,transparent)] hover:bg-[color-mix(in_srgb,var(--color-warn)_8%,transparent)]'
          : attention === 'danger'
            ? 'bg-[color-mix(in_srgb,var(--color-danger)_5%,transparent)] hover:bg-[color-mix(in_srgb,var(--color-danger)_8%,transparent)]'
            : 'hover:bg-raised/50'
      }`}
    >
      {attention && (
        <span
          className={`absolute bottom-2.5 left-0 top-2.5 w-0.5 rounded-r-full ${
            attention === 'warn' ? 'bg-warn' : 'bg-danger'
          }`}
          aria-hidden="true"
        />
      )}
      <button
        type="button"
        onClick={onOpen}
        className="min-w-0 flex-1 px-4 py-3 text-left"
      >
        <div className="flex items-center gap-2">
          <StatusDot status={agent.status} />
          <span className="truncate text-[13px] font-medium text-fg">
            {agent.title ?? label}
          </span>
          {attention === 'warn' && (
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-warn-soft px-2 py-0.5 text-[11px] font-medium text-warn">
              <span className="h-1 w-1 rounded-full bg-warn" />
              needs input
            </span>
          )}
          {attention === 'danger' && (
            <span className="inline-flex shrink-0 items-center rounded-full bg-danger-soft px-2 py-0.5 text-[11px] font-medium text-danger">
              error
            </span>
          )}
        </div>
        <div className="mt-0.5 truncate font-mono text-[11.5px] text-muted">
          {label !== (agent.title ?? label) ? `${label} · ` : ''}
          {agent.projectPath}
        </div>
        {activity && (
          <div className={`mt-0.5 truncate text-xs ${activity.className}`}>{activity.text}</div>
        )}
      </button>

      <div className="flex shrink-0 items-center gap-2.5 pr-4">
        {dur && (
          <span
            className="font-mono text-[11.5px] tabular-nums text-meta"
            style={attention === 'warn' ? { color: 'var(--color-warn)' } : undefined}
          >
            {dur}
          </span>
        )}
        <Button
          size="sm"
          variant="secondary"
          onClick={onStop}
          className="hover:border-danger/40 hover:bg-danger-soft hover:text-danger"
        >
          Stop
        </Button>
      </div>
    </div>
  );
}

function sinceStart(agent: AgentProcess, now: number): number | null {
  const started = Date.parse(agent.startedAt);
  if (Number.isNaN(started)) return null;
  return Math.max(0, now - started);
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
  if (minutes < 60) return `${minutes}m ${String(total % 60).padStart(2, '0')}s`;
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

/* ─────────────────────────────────────────────
   Past session row — one dense mono meta line;
   Resume / Archive / Delete reveal on hover.
   ───────────────────────────────────────────── */
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
    <div className="group flex items-center transition-colors duration-150 hover:bg-raised/50">
      <button
        type="button"
        onClick={onOpen}
        className="min-w-0 flex-1 px-4 py-2.5 text-left"
      >
        <div className="flex items-center gap-2">
          <StatusDot status={session.status} />
          <span
            className={`truncate text-[13px] font-medium ${
              session.archivedAt ? 'text-muted line-through' : 'text-fg'
            }`}
          >
            {session.title ?? `${label} session`}
          </span>
          {session.resumedFrom && (
            <span className="shrink-0 rounded border border-line-soft px-1.5 py-px text-[10px] text-muted">
              resumed
            </span>
          )}
          {session.status === 'error' && (
            <span className="inline-flex shrink-0 items-center rounded-full bg-danger-soft px-2 py-0.5 text-[11px] font-medium text-danger">
              error
            </span>
          )}
        </div>
        <div className="mt-0.5 truncate font-mono text-[11.5px] text-muted">
          {label} · {session.projectPath} · {relativeTime(session.updatedAt)}
          {session.eventCount > 0 ? ` · ${session.eventCount} event${session.eventCount === 1 ? '' : 's'}` : ''}
        </div>
      </button>

      <div className="flex shrink-0 items-center gap-1.5 pr-4 opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover:opacity-100">
        {!session.archivedAt && (
          <Button size="sm" variant="secondary" onClick={onResume}>
            Resume
          </Button>
        )}
        <Button
          size="sm"
          variant="tertiary"
          onClick={onArchive}
          title="Archive"
          aria-label="Archive session"
          className="w-7 px-0 text-muted hover:text-fg"
        >
          <IconArchive className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="sm"
          variant="tertiary"
          onClick={onDelete}
          title="Delete"
          aria-label="Delete session"
          className="w-7 px-0 text-muted hover:bg-danger-soft hover:text-danger"
        >
          <IconTrash className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
