import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router';
import type {
  GitStatusResult,
  GitStatusFile,
  GitLogResult,
  GitLogEntry,
  GitBranchesResult,
} from '@baton/shared';
import { useAgentStore } from '../stores/connection.js';
import { Card, StatusBadge, StatusAlert, LoadingSpinner, Breadcrumbs, Button } from '../lib/ui.js';
import { IconTerminal, IconFile, IconGitBranch } from '../lib/icons.js';
import { usePolling } from '../lib/hooks.js';

export function GitScreen() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const agents = useAgentStore((s) => s.agents);
  const agent = sessionId ? agents.find((a) => a.id === sessionId) : null;
  const projectPath = agent?.projectPath ?? '';

  const [status, setStatus] = useState<GitStatusResult | null>(null);
  const [log, setLog] = useState<GitLogResult | null>(null);
  const [branches, setBranches] = useState<GitBranchesResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    if (!projectPath) return;
    try {
      const [statusRes, logRes, branchesRes] = await Promise.all([
        fetch(`/api/git/status?path=${encodeURIComponent(projectPath)}`),
        fetch(`/api/git/log?path=${encodeURIComponent(projectPath)}&count=25`),
        fetch(`/api/git/branches?path=${encodeURIComponent(projectPath)}`),
      ]);
      if (statusRes.ok) setStatus(await statusRes.json());
      if (logRes.ok) setLog(await logRes.json());
      if (branchesRes.ok) setBranches(await branchesRes.json());
      setError(null);
    } catch {
      setError('Failed to fetch git data');
    } finally {
      setLoading(false);
    }
  }, [projectPath]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  usePolling(fetchAll, 10000);

  async function gitAction(action: string, endpoint: string, body?: Record<string, unknown>) {
    if (!projectPath) return;
    setActionLoading(action);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body ?? { projectPath }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `${action} failed`);
      } else if (data.output) {
        setError(null);
      }
      await fetchAll();
    } catch {
      setError(`${action} failed`);
    } finally {
      setActionLoading(null);
    }
  }

  if (!agent) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <p className="text-sm text-geist-gray-700">Agent not found</p>
        <Button variant="secondary" size="sm" className="mt-3" onClick={() => navigate('/')}>
          Back to Dashboard
        </Button>
      </div>
    );
  }

  if (loading) {
    return <LoadingSpinner text="Loading git data…" />;
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div className="flex items-center justify-between">
        <Breadcrumbs
          items={[
            { label: 'Dashboard', onClick: () => navigate('/') },
            { label: sessionId?.slice(0, 8) ?? '' },
            { label: 'Git' },
          ]}
        />
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => navigate(`/terminal/${sessionId}`)}>
            <IconTerminal className="mr-1.5 h-3.5 w-3.5" />
            Terminal
          </Button>
          <Button variant="secondary" size="sm" onClick={() => navigate(`/files/${sessionId}`)}>
            <IconFile className="mr-1.5 h-3.5 w-3.5" />
            Files
          </Button>
        </div>
      </div>

      {error && <StatusAlert type="error" title="Git Error" message={error} />}

      {status && (
        <Card>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <IconGitBranch className="h-5 w-5 text-geist-gray-700" />
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-geist-gray-1000">{status.branch}</span>
                  {status.tracking && (
                    <span className="text-xs text-geist-gray-700">tracking {status.tracking}</span>
                  )}
                </div>
                {status.tracking && (status.ahead > 0 || status.behind > 0) && (
                  <div className="mt-1 flex items-center gap-2 text-xs">
                    {status.ahead > 0 && (
                      <span className="text-geist-green-700 dark:text-geist-green-900">
                        +{status.ahead} ahead
                      </span>
                    )}
                    {status.behind > 0 && (
                      <span className="text-geist-amber-900 dark:text-geist-amber-600">
                        −{status.behind} behind
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="secondary"
                disabled={actionLoading !== null}
                onClick={() => gitAction('pull', '/api/git/pull')}
              >
                {actionLoading === 'pull' ? 'Pulling…' : 'Pull'}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={actionLoading !== null}
                onClick={() => gitAction('push', '/api/git/push')}
              >
                {actionLoading === 'push' ? 'Pushing…' : 'Push'}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={actionLoading !== null}
                onClick={() => gitAction('stash', '/api/git/stash')}
              >
                {actionLoading === 'stash' ? 'Stashing…' : 'Stash'}
              </Button>
            </div>
          </div>
        </Card>
      )}

      {status && status.files.length > 0 && (
        <div>
          <div className="mb-4 flex items-center gap-3">
            <h3 className="text-sm font-semibold text-geist-gray-1000">Changed Files</h3>
            <span className="inline-flex items-center justify-center rounded-full bg-geist-gray-alpha-200 px-2 py-0.5 text-xs font-medium tabular-nums text-geist-gray-900">
              {status.files.length}
            </span>
            <div className="h-px flex-1 bg-geist-gray-alpha-200" />
          </div>
          <div className="space-y-1.5">
            {status.files.map((file, i) => (
              <FileStatusRow key={i} file={file} />
            ))}
          </div>
        </div>
      )}

      {log && log.entries.length > 0 && (
        <div>
          <div className="mb-4 flex items-center gap-3">
            <h3 className="text-sm font-semibold text-geist-gray-1000">Recent Commits</h3>
            <span className="inline-flex items-center justify-center rounded-full bg-geist-gray-alpha-200 px-2 py-0.5 text-xs font-medium tabular-nums text-geist-gray-900">
              {log.entries.length}
            </span>
            <div className="h-px flex-1 bg-geist-gray-alpha-200" />
          </div>
          <Card className="p-0" padding={false}>
            {log.entries.map((entry, i) => (
              <CommitRow key={entry.hash} entry={entry} isLast={i === log.entries.length - 1} />
            ))}
          </Card>
        </div>
      )}

      {branches && branches.branches.length > 0 && (
        <div>
          <div className="mb-4 flex items-center gap-3">
            <h3 className="text-sm font-semibold text-geist-gray-1000">Branches</h3>
            <span className="inline-flex items-center justify-center rounded-full bg-geist-gray-alpha-200 px-2 py-0.5 text-xs font-medium tabular-nums text-geist-gray-900">
              {branches.branches.length}
            </span>
            <div className="h-px flex-1 bg-geist-gray-alpha-200" />
          </div>
          <div className="flex flex-wrap gap-2.5">
            {branches.branches.map((branch) => (
              <span
                key={branch.name}
                className={`inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] px-2.5 py-1 text-xs font-medium ${
                  branch.current
                    ? 'bg-geist-gray-1000 text-geist-background-100'
                    : 'bg-geist-gray-alpha-200 text-geist-gray-900'
                }`}
              >
                {branch.current && (
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-geist-background-100" />
                )}
                {branch.name}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const STATUS_STYLES: Record<GitStatusFile['status'], { bg: string; text: string; label: string }> = {
  added: {
    bg: 'bg-geist-green-100 dark:bg-geist-green-1000',
    text: 'text-geist-green-700 dark:text-geist-green-900',
    label: 'A',
  },
  modified: {
    bg: 'bg-geist-blue-100 dark:bg-geist-blue-1000',
    text: 'text-geist-blue-700 dark:text-geist-blue-900',
    label: 'M',
  },
  deleted: {
    bg: 'bg-geist-red-100 dark:bg-geist-red-1000',
    text: 'text-geist-red-700 dark:text-geist-red-900',
    label: 'D',
  },
  renamed: {
    bg: 'bg-geist-amber-100 dark:bg-geist-amber-1000',
    text: 'text-geist-amber-900 dark:text-geist-amber-600',
    label: 'R',
  },
  untracked: {
    bg: 'bg-geist-gray-alpha-200',
    text: 'text-geist-gray-800',
    label: '?',
  },
};

function FileStatusRow({ file }: { file: GitStatusFile }) {
  const style = STATUS_STYLES[file.status] ?? STATUS_STYLES.modified;

  return (
    <div className="flex items-center gap-3 rounded-[var(--radius-sm)] border border-geist-gray-alpha-300 bg-geist-background-100 px-5 py-3.5 transition-colors hover:bg-geist-gray-alpha-100">
      <span
        className={`flex h-5 w-5 items-center justify-center rounded text-[11px] font-bold ${style.bg} ${style.text}`}
      >
        {file.staged ? '*' : style.label}
      </span>
      <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-geist-gray-900">
        {file.path}
      </span>
      <StatusBadge status={file.status} dot={false} />
    </div>
  );
}

function CommitRow({ entry, isLast }: { entry: GitLogEntry; isLast: boolean }) {
  const dateStr = new Date(entry.date).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div
      className={`flex items-center gap-3.5 px-6 py-3.5 transition-colors hover:bg-geist-gray-alpha-100 ${
        isLast ? '' : 'border-b border-geist-gray-alpha-200'
      }`}
    >
      <span className="shrink-0 rounded bg-geist-gray-alpha-200 px-1.5 py-0.5 font-mono text-[11px] text-geist-gray-800">
        {entry.shortHash}
      </span>
      <span className="min-w-0 flex-1 truncate text-xs text-geist-gray-900">{entry.message}</span>
      <span className="shrink-0 text-[11px] text-geist-gray-700">{entry.author}</span>
      <span className="shrink-0 text-[11px] text-geist-gray-700">{dateStr}</span>
    </div>
  );
}
