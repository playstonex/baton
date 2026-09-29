import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router';
import type { AgentProcess } from '@baton/shared';
import { useAgentStore } from '../stores/connection.js';
import {
  Card,
  Button,
  Input,
  StatusAlert,
  LoadingSpinner,
  EmptyState,
  PageHeader,
  Chip,
} from '../lib/ui.js';
import {
  IconGitBranch,
  IconPlus,
  IconTrash,
  IconRefreshCw,
  IconTerminal,
  IconFile,
} from '../lib/icons.js';
import { usePolling } from '../lib/hooks.js';

interface WorktreeInfo {
  id: string;
  basePath: string;
  branch: string;
  path: string;
  status: 'active' | 'archived';
  createdAt: string;
}

const LS_BASE = 'baton.worktree.basePath';

export function WorktreesScreen() {
  const navigate = useNavigate();
  const agents = useAgentStore((s) => s.agents);

  const [worktrees, setWorktrees] = useState<WorktreeInfo[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [basePath, setBasePath] = useState(() => localStorage.getItem(LS_BASE) ?? '');
  const [branch, setBranch] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const fetchList = useCallback(async () => {
    try {
      const res = await fetch('/api/worktree/list?status=active');
      if (res.ok) {
        const data: WorktreeInfo[] = await res.json();
        setWorktrees(data);
        setActiveId((cur) => cur ?? (data.length > 0 ? data[0].id : null));
        setError(null);
      } else {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? 'Failed to list worktrees');
      }
    } catch {
      setError('Failed to reach daemon');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  usePolling(fetchList, 10000);

  async function createWorktree() {
    const base = basePath.trim();
    const br = branch.trim();
    if (!base || !br) {
      setError('Enter both a base repo path and a branch name');
      return;
    }
    setBusy('create');
    setError(null);
    try {
      const res = await fetch('/api/worktree/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ basePath: base, branch: br }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Create failed');
      } else {
        localStorage.setItem(LS_BASE, base);
        setBranch('');
        setActiveId(data.id);
        await fetchList();
      }
    } catch {
      setError('Create failed');
    } finally {
      setBusy(null);
    }
  }

  async function archiveWorktree(wt: WorktreeInfo) {
    setBusy(wt.id);
    setError(null);
    try {
      const res = await fetch('/api/worktree/archive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: wt.path }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Archive failed');
      } else {
        setActiveId((cur) => (cur === wt.id ? null : cur));
        await fetchList();
      }
    } catch {
      setError('Archive failed');
    } finally {
      setBusy(null);
    }
  }

  // Agents whose projectPath lives inside a given worktree path.
  function agentsFor(wt: WorktreeInfo): AgentProcess[] {
    const root = wt.path.replace(/\/+$/, '');
    return agents.filter((a) => a.projectPath === root || a.projectPath?.startsWith(`${root}/`));
  }

  const active = worktrees.find((w) => w.id === activeId) ?? null;

  return (
    <div className="mx-auto flex max-w-4xl flex-col">
      <PageHeader
        title="Worktrees"
        description="Run parallel agents on isolated git worktree branches"
      />

      <div className="space-y-4">
        {error && <StatusAlert type="error" message={error} />}

        {/* Create form */}
        <Card>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <label className="flex flex-1 flex-col gap-1.5 text-[13px]">
              <span className="text-fg-2">Base repo path</span>
              <Input
                size="sm"
                placeholder="/path/to/repo"
                value={basePath}
                onChange={(e) => setBasePath(e.target.value)}
              />
            </label>
            <label className="flex flex-1 flex-col gap-1.5 text-[13px]">
              <span className="text-fg-2">New branch</span>
              <Input
                size="sm"
                placeholder="feature/my-branch"
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') createWorktree();
                }}
              />
            </label>
            <Button
              variant="primary"
              size="sm"
              onClick={createWorktree}
              disabled={busy === 'create'}
            >
              <IconPlus className="h-3.5 w-3.5" />
              {busy === 'create' ? 'Creating…' : 'Create'}
            </Button>
          </div>
        </Card>

        {/* Tab strip */}
        {loading ? (
          <LoadingSpinner text="Loading worktrees…" />
        ) : worktrees.length === 0 ? (
          <EmptyState
            icon={<IconGitBranch className="h-5 w-5" />}
            title="No active worktrees"
            description="Create a worktree above to run an agent on an isolated branch."
          />
        ) : (
          <>
            <div className="flex items-center gap-1 overflow-x-auto border-b border-line-soft pb-px">
              {worktrees.map((wt) => {
                const isActive = wt.id === activeId;
                const count = agentsFor(wt).length;
                return (
                  <button
                    key={wt.id}
                    type="button"
                    onClick={() => setActiveId(wt.id)}
                    className={`flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] font-medium transition-colors duration-150 ${
                      isActive
                        ? 'border-accent text-fg'
                        : 'border-transparent text-muted hover:text-fg'
                    }`}
                  >
                    <IconGitBranch className="h-3.5 w-3.5" />
                    <span className="max-w-[14rem] truncate font-mono">{wt.branch}</span>
                    {count > 0 && <Chip color="green">{count}</Chip>}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={fetchList}
                className="ml-auto shrink-0 rounded-sm p-1.5 text-muted transition-colors hover:bg-raised hover:text-fg"
                title="Refresh"
                aria-label="Refresh"
              >
                <IconRefreshCw className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Active worktree panel */}
            {active && (
              <Card>
                <div className="flex flex-col gap-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-[13px] font-medium text-fg">
                        <IconGitBranch className="h-4 w-4 shrink-0 text-muted" />
                        <span className="truncate font-mono">{active.branch}</span>
                      </div>
                      <code className="mt-1 block truncate font-mono text-xs text-muted">
                        {active.path}
                      </code>
                      <div className="mt-1 text-xs text-meta">
                        base <code className="font-mono">{active.basePath}</code> · created{' '}
                        {new Date(active.createdAt).toLocaleString()}
                      </div>
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => archiveWorktree(active)}
                      disabled={busy === active.id}
                    >
                      <IconTrash className="h-3.5 w-3.5" />
                      {busy === active.id ? 'Archiving…' : 'Archive'}
                    </Button>
                  </div>

                  {/* Agents running in this worktree */}
                  <div className="flex flex-col gap-2">
                    <span className="text-xs font-medium text-muted">
                      Agents
                    </span>
                    {agentsFor(active).length === 0 ? (
                      <span className="text-[13px] text-muted">
                        No agent running in this worktree yet.
                      </span>
                    ) : (
                      agentsFor(active).map((a) => (
                        <div
                          key={a.id}
                          className="flex items-center justify-between gap-2 rounded-sm border border-line bg-field px-3 py-2"
                        >
                          <div className="flex min-w-0 items-center gap-2">
                            <Chip color={a.status === 'stopped' ? 'gray' : 'green'}>
                              {a.status}
                            </Chip>
                            <span className="truncate font-mono text-xs text-fg-2">{a.type}</span>
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            <Button
                              variant="tertiary"
                              size="sm"
                              onClick={() => navigate(`/terminal/${a.id}`)}
                              title="Terminal"
                              aria-label="Terminal"
                            >
                              <IconTerminal className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="tertiary"
                              size="sm"
                              onClick={() => navigate(`/files/${a.id}`)}
                              title="Files"
                              aria-label="Files"
                            >
                              <IconFile className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  );
}
