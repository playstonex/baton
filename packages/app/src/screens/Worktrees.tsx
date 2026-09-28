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
    <div className="mx-auto flex max-w-4xl flex-col gap-4 p-4">
      <PageHeader
        title="Worktrees"
        description="Run parallel agents on isolated git worktree branches"
      />

      {error && <StatusAlert type="error" message={error} />}

      {/* Create form */}
      <Card>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="flex flex-1 flex-col gap-1 text-sm">
            <span className="text-geist-gray-900">Base repo path</span>
            <Input
              size="sm"
              placeholder="/path/to/repo"
              value={basePath}
              onChange={(e) => setBasePath(e.target.value)}
            />
          </label>
          <label className="flex flex-1 flex-col gap-1 text-sm">
            <span className="text-geist-gray-900">New branch</span>
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
            <IconPlus className="h-4 w-4" />
            {busy === 'create' ? 'Creating…' : 'Create'}
          </Button>
        </div>
      </Card>

      {/* Tab strip */}
      {loading ? (
        <LoadingSpinner text="Loading worktrees…" />
      ) : worktrees.length === 0 ? (
        <EmptyState
          icon={<IconGitBranch className="h-8 w-8" />}
          title="No active worktrees"
          description="Create a worktree above to run an agent on an isolated branch."
        />
      ) : (
        <>
          <div className="flex items-center gap-2 overflow-x-auto border-b border-geist-gray-alpha-400 pb-px">
            {worktrees.map((wt) => {
              const isActive = wt.id === activeId;
              const count = agentsFor(wt).length;
              return (
                <button
                  key={wt.id}
                  type="button"
                  onClick={() => setActiveId(wt.id)}
                  className={`flex shrink-0 items-center gap-1.5 rounded-t-[var(--radius-sm)] border-b-2 px-3 py-2 text-sm transition-colors ${
                    isActive
                      ? 'border-geist-blue-700 text-geist-gray-1000'
                      : 'border-transparent text-geist-gray-700 hover:text-geist-gray-1000'
                  }`}
                >
                  <IconGitBranch className="h-3.5 w-3.5" />
                  <span className="max-w-[14rem] truncate">{wt.branch}</span>
                  {count > 0 && <Chip color="green">{count}</Chip>}
                </button>
              );
            })}
            <button
              type="button"
              onClick={fetchList}
              className="ml-auto shrink-0 rounded p-1.5 text-geist-gray-700 hover:text-geist-gray-1000"
              title="Refresh"
              aria-label="Refresh"
            >
              <IconRefreshCw className="h-4 w-4" />
            </button>
          </div>

          {/* Active worktree panel */}
          {active && (
            <Card>
              <div className="flex flex-col gap-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm font-medium text-geist-gray-1000">
                      <IconGitBranch className="h-4 w-4 shrink-0" />
                      <span className="truncate">{active.branch}</span>
                    </div>
                    <code className="mt-1 block truncate text-xs text-geist-gray-700">
                      {active.path}
                    </code>
                    <div className="mt-1 text-xs text-geist-gray-700">
                      base <code>{active.basePath}</code> · created{' '}
                      {new Date(active.createdAt).toLocaleString()}
                    </div>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => archiveWorktree(active)}
                    disabled={busy === active.id}
                  >
                    <IconTrash className="h-4 w-4" />
                    {busy === active.id ? 'Archiving…' : 'Archive'}
                  </Button>
                </div>

                {/* Agents running in this worktree */}
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium uppercase tracking-wide text-geist-gray-700">
                    Agents
                  </span>
                  {agentsFor(active).length === 0 ? (
                    <span className="text-sm text-geist-gray-700">
                      No agent running in this worktree yet.
                    </span>
                  ) : (
                    agentsFor(active).map((a) => (
                      <div
                        key={a.id}
                        className="flex items-center justify-between gap-2 rounded-[var(--radius-sm)] border border-geist-gray-alpha-400 px-3 py-2"
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <Chip color={a.status === 'stopped' ? 'gray' : 'green'}>
                            {a.status}
                          </Chip>
                          <span className="truncate text-sm text-geist-gray-1000">{a.type}</span>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <Button
                            variant="tertiary"
                            size="sm"
                            onClick={() => navigate(`/terminal/${a.id}`)}
                            title="Terminal"
                            aria-label="Terminal"
                          >
                            <IconTerminal className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="tertiary"
                            size="sm"
                            onClick={() => navigate(`/files/${a.id}`)}
                            title="Files"
                            aria-label="Files"
                          >
                            <IconFile className="h-4 w-4" />
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
  );
}
