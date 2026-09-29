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
        <p className="text-[13px] text-muted">Agent not found</p>
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

      {error && <StatusAlert type="error" title="Git error" message={error} />}

      {status && (
        <Card className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-sm bg-accent-soft text-accent-hover">
                <IconGitBranch className="h-4 w-4" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[13px] font-semibold text-fg">{status.branch}</span>
                  {status.tracking && (
                    <span className="font-mono text-xs text-meta">tracking {status.tracking}</span>
                  )}
                </div>
                {status.tracking && (status.ahead > 0 || status.behind > 0) && (
                  <div className="mt-0.5 flex items-center gap-2 font-mono text-xs">
                    {status.ahead > 0 && <span className="text-success">+{status.ahead} ahead</span>}
                    {status.behind > 0 && <span className="text-warn">−{status.behind} behind</span>}
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
            <h3 className="text-[13px] font-semibold text-fg">Changed files</h3>
            <span className="inline-flex items-center justify-center rounded-full bg-raised px-2 py-0.5 text-xs font-medium tabular-nums text-muted">
              {status.files.length}
            </span>
            <div className="h-px flex-1 bg-line-soft" />
          </div>
          <Card padding={false} className="divide-y divide-line-soft overflow-hidden">
            {status.files.map((file, i) => (
              <FileStatusRow key={i} file={file} />
            ))}
          </Card>
        </div>
      )}

      {log && log.entries.length > 0 && (
        <div>
          <div className="mb-4 flex items-center gap-3">
            <h3 className="text-[13px] font-semibold text-fg">Recent commits</h3>
            <span className="inline-flex items-center justify-center rounded-full bg-raised px-2 py-0.5 text-xs font-medium tabular-nums text-muted">
              {log.entries.length}
            </span>
            <div className="h-px flex-1 bg-line-soft" />
          </div>
          <Card padding={false} className="divide-y divide-line-soft overflow-hidden">
            {log.entries.map((entry) => (
              <CommitRow key={entry.hash} entry={entry} />
            ))}
          </Card>
        </div>
      )}

      {branches && branches.branches.length > 0 && (
        <div>
          <div className="mb-4 flex items-center gap-3">
            <h3 className="text-[13px] font-semibold text-fg">Branches</h3>
            <span className="inline-flex items-center justify-center rounded-full bg-raised px-2 py-0.5 text-xs font-medium tabular-nums text-muted">
              {branches.branches.length}
            </span>
            <div className="h-px flex-1 bg-line-soft" />
          </div>
          <div className="flex flex-wrap gap-2">
            {branches.branches.map((branch) => (
              <span
                key={branch.name}
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-xs font-medium ${
                  branch.current
                    ? 'bg-accent text-accent-on'
                    : 'border border-line bg-transparent text-fg-2'
                }`}
              >
                {branch.current && (
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent-on" />
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
  added: { bg: 'bg-success-soft', text: 'text-success', label: 'A' },
  modified: { bg: 'bg-accent-soft', text: 'text-accent-hover', label: 'M' },
  deleted: { bg: 'bg-danger-soft', text: 'text-danger', label: 'D' },
  renamed: { bg: 'bg-warn-soft', text: 'text-warn', label: 'R' },
  untracked: { bg: 'bg-raised', text: 'text-muted', label: '?' },
};

function FileStatusRow({ file }: { file: GitStatusFile }) {
  const style = STATUS_STYLES[file.status] ?? STATUS_STYLES.modified;

  return (
    <div className="flex items-center gap-3 px-5 py-2.5 transition-colors duration-150 hover:bg-raised/50">
      <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-sm font-mono text-[11px] font-semibold ${style.bg} ${style.text}`}>
        {file.staged ? '*' : style.label}
      </span>
      <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-fg-2">
        {file.path}
      </span>
      <StatusBadge status={file.status} dot={false} />
    </div>
  );
}

function CommitRow({ entry }: { entry: GitLogEntry }) {
  const dateStr = new Date(entry.date).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div className="flex items-center gap-3.5 px-5 py-2.5 transition-colors duration-150 hover:bg-raised/50">
      <span className="shrink-0 rounded-sm bg-raised px-1.5 py-0.5 font-mono text-[11px] text-muted">
        {entry.shortHash}
      </span>
      <span className="min-w-0 flex-1 truncate text-xs text-fg-2">{entry.message}</span>
      <span className="shrink-0 text-[11px] text-meta">{entry.author}</span>
      <span className="shrink-0 text-[11px] tabular-nums text-meta">{dateStr}</span>
    </div>
  );
}
