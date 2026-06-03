import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router';
import { Button, Card, CardContent, Chip } from '@heroui/react';
import type {
  GitStatusResult,
  GitStatusFile,
  GitLogResult,
  GitLogEntry,
  GitBranchesResult,
} from '@baton/shared';
import { useAgentStore } from '../stores/connection.js';

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
    const timer = setInterval(fetchAll, 10000);
    return () => clearInterval(timer);
  }, [fetchAll]);

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
        <p className="text-sm text-surface-400">Agent not found</p>
        <Button variant="outline" size="sm" className="mt-3" onPress={() => navigate('/')}>
          Back to Dashboard
        </Button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center py-20">
        <div className="mb-3">
          <svg className="h-5 w-5 animate-spin text-surface-300" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        </div>
        <span className="text-sm text-surface-400">Loading git data...</span>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onPress={() => navigate(-1)} className="-ml-2 text-surface-500">
          <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 12L6 8l4-4" />
          </svg>
        </Button>
        <div className="flex items-center gap-1.5 text-xs text-surface-400">
          <button type="button" onClick={() => navigate('/')} className="transition-colors hover:text-primary-500">Dashboard</button>
          <svg className="h-3 w-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 4l4 4-4 4" /></svg>
          <span className="font-mono text-surface-600 dark:text-surface-300">{sessionId?.slice(0, 8)}</span>
          <svg className="h-3 w-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 4l4 4-4 4" /></svg>
          <span className="text-surface-600 dark:text-surface-300">Git</span>
        </div>
        <div className="flex-1" />
        <Button variant="outline" size="sm" onPress={() => navigate(`/terminal/${sessionId}`)}>
          Terminal
        </Button>
        <Button variant="outline" size="sm" onPress={() => navigate(`/files/${sessionId}`)}>
          Files
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-700 dark:border-danger-800 dark:bg-danger-950/30 dark:text-danger-400">
          {error}
        </div>
      )}

      {status && (
        <Card className="border border-surface-200 shadow-sm dark:border-surface-700">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <svg className="h-4 w-4 text-surface-500" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="5" cy="3" r="1.5" />
                      <circle cx="5" cy="13" r="1.5" />
                      <circle cx="12" cy="8" r="1.5" />
                      <path d="M5 4.5v7M6.5 11.5L10.5 9.5M6.5 5.5L10.5 7.5" />
                    </svg>
                    <span className="text-sm font-semibold text-surface-900 dark:text-white">
                      {status.branch}
                    </span>
                    {status.tracking && (
                      <span className="text-xs text-surface-400">
                        tracking {status.tracking}
                      </span>
                    )}
                  </div>
                  {status.tracking && (status.ahead > 0 || status.behind > 0) && (
                    <div className="mt-1 flex items-center gap-2 text-xs">
                      {status.ahead > 0 && (
                        <span className="text-success-600 dark:text-success-400">
                          +{status.ahead} ahead
                        </span>
                      )}
                      {status.behind > 0 && (
                        <span className="text-warning-600 dark:text-warning-400">
                          -{status.behind} behind
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  isDisabled={actionLoading !== null}
                  onPress={() => gitAction('pull', '/api/git/pull')}
                >
                  {actionLoading === 'pull' ? 'Pulling...' : 'Pull'}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  isDisabled={actionLoading !== null}
                  onPress={() => gitAction('push', '/api/git/push')}
                >
                  {actionLoading === 'push' ? 'Pushing...' : 'Push'}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  isDisabled={actionLoading !== null}
                  onPress={() => gitAction('stash', '/api/git/stash')}
                >
                  {actionLoading === 'stash' ? 'Stashing...' : 'Stash'}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {status && status.files.length > 0 && (
        <div>
          <div className="mb-3 flex items-center gap-3">
            <h3 className="text-sm font-semibold text-surface-900 dark:text-white">Changed Files</h3>
            <span className="rounded-full bg-primary-50 px-2 py-0.5 text-xs font-medium tabular-nums text-primary-600 dark:bg-primary-950 dark:text-primary-400">
              {status.files.length}
            </span>
            <div className="h-px flex-1 bg-surface-200 dark:bg-surface-700" />
          </div>
          <div className="space-y-1">
            {status.files.map((file, i) => (
              <FileStatusRow key={i} file={file} />
            ))}
          </div>
        </div>
      )}

      {log && log.entries.length > 0 && (
        <div>
          <div className="mb-3 flex items-center gap-3">
            <h3 className="text-sm font-semibold text-surface-900 dark:text-white">Recent Commits</h3>
            <span className="rounded-full bg-surface-100 px-2 py-0.5 text-xs font-medium tabular-nums text-surface-600 dark:bg-surface-800 dark:text-surface-400">
              {log.entries.length}
            </span>
            <div className="h-px flex-1 bg-surface-200 dark:bg-surface-700" />
          </div>
          <Card className="border border-surface-200 shadow-sm dark:border-surface-700">
            <CardContent className="p-0">
              {log.entries.map((entry, i) => (
                <CommitRow key={entry.hash} entry={entry} isLast={i === log.entries.length - 1} />
              ))}
            </CardContent>
          </Card>
        </div>
      )}

      {branches && branches.branches.length > 0 && (
        <div>
          <div className="mb-3 flex items-center gap-3">
            <h3 className="text-sm font-semibold text-surface-900 dark:text-white">Branches</h3>
            <span className="rounded-full bg-surface-100 px-2 py-0.5 text-xs font-medium tabular-nums text-surface-600 dark:bg-surface-800 dark:text-surface-400">
              {branches.branches.length}
            </span>
            <div className="h-px flex-1 bg-surface-200 dark:bg-surface-700" />
          </div>
          <div className="flex flex-wrap gap-2">
            {branches.branches.map((branch) => (
              <Chip
                key={branch.name}
                size="sm"
                variant={branch.current ? 'primary' : 'tertiary'}
                color={branch.current ? 'accent' : branch.default ? 'success' : 'default'}
              >
                {branch.current && (
                  <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-primary-400" />
                )}
                {branch.name}
              </Chip>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const STATUS_STYLES: Record<GitStatusFile['status'], { bg: string; text: string; label: string }> = {
  added: { bg: 'bg-success-100 dark:bg-success-950', text: 'text-success-700 dark:text-success-400', label: 'A' },
  modified: { bg: 'bg-primary-100 dark:bg-primary-950', text: 'text-primary-700 dark:text-primary-400', label: 'M' },
  deleted: { bg: 'bg-danger-100 dark:bg-danger-950', text: 'text-danger-700 dark:text-danger-400', label: 'D' },
  renamed: { bg: 'bg-warning-100 dark:bg-warning-950', text: 'text-warning-700 dark:text-warning-400', label: 'R' },
  untracked: { bg: 'bg-surface-100 dark:bg-surface-800', text: 'text-surface-500 dark:text-surface-400', label: '?' },
};

function FileStatusRow({ file }: { file: GitStatusFile }) {
  const style = STATUS_STYLES[file.status] ?? STATUS_STYLES.modified;

  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-surface-100 bg-white px-3.5 py-2.5 transition-colors hover:bg-surface-50 dark:border-surface-700 dark:bg-surface-800/50 dark:hover:bg-surface-800">
      <span className={`flex h-5 w-5 items-center justify-center rounded text-[11px] font-bold ${style.bg} ${style.text}`}>
        {file.staged ? '*' : style.label}
      </span>
      <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-surface-700 dark:text-surface-300">
        {file.path}
      </span>
      <Chip size="sm" variant="soft" color={
        file.status === 'added' ? 'success' :
        file.status === 'deleted' ? 'danger' :
        file.status === 'untracked' ? 'default' : 'accent'
      }>
        {file.status}
      </Chip>
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
    <div className={`flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-surface-50/50 dark:hover:bg-surface-800/30 ${isLast ? '' : 'border-b border-surface-100 dark:border-surface-700/50'}`}>
      <span className="shrink-0 rounded bg-surface-100 px-1.5 py-0.5 font-mono text-[11px] text-surface-500 dark:bg-surface-800">
        {entry.shortHash}
      </span>
      <span className="min-w-0 flex-1 truncate text-xs text-surface-700 dark:text-surface-300">
        {entry.message}
      </span>
      <span className="shrink-0 text-[11px] text-surface-400">{entry.author}</span>
      <span className="shrink-0 text-[11px] text-surface-400">{dateStr}</span>
    </div>
  );
}
