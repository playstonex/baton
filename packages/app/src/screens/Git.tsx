import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router';
import { Button } from '@heroui/react';
import type {
  GitStatusResult,
  GitStatusFile,
  GitLogResult,
  GitLogEntry,
  GitBranchesResult,
} from '@baton/shared';
import { useAgentStore } from '../stores/connection.js';
import { Card, StatusBadge, StatusAlert, LoadingSpinner, Breadcrumbs } from '../lib/ui.js';
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
        <p className="text-sm text-gray-400">Agent not found</p>
        <Button variant="outline" size="sm" className="mt-3" onPress={() => navigate('/')}>
          Back to Dashboard
        </Button>
      </div>
    );
  }

  if (loading) {
    return <LoadingSpinner text="Loading git data..." />;
  }

  return (
    <div className="mx-auto max-w-4xl space-y-10">
      <div className="flex items-center justify-between">
        <Breadcrumbs
          items={[
            { label: 'Dashboard', onClick: () => navigate('/') },
            { label: sessionId?.slice(0, 8) ?? '' },
            { label: 'Git' },
          ]}
        />
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onPress={() => navigate(`/terminal/${sessionId}`)}>
            <IconTerminal className="mr-1.5 h-3.5 w-3.5" />
            Terminal
          </Button>
          <Button variant="outline" size="sm" onPress={() => navigate(`/files/${sessionId}`)}>
            <IconFile className="mr-1.5 h-3.5 w-3.5" />
            Files
          </Button>
        </div>
      </div>

      {error && (
        <StatusAlert type="error" title="Git Error" message={error} />
      )}

      {status && (
        <Card>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <IconGitBranch className="h-5 w-5 text-gray-400" />
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-gray-900 dark:text-white">
                    {status.branch}
                  </span>
                  {status.tracking && (
                    <span className="text-xs text-gray-400">
                      tracking {status.tracking}
                    </span>
                  )}
                </div>
                {status.tracking && (status.ahead > 0 || status.behind > 0) && (
                  <div className="mt-1 flex items-center gap-2 text-xs">
                    {status.ahead > 0 && (
                      <span className="text-green-600 dark:text-green-400">
                        +{status.ahead} ahead
                      </span>
                    )}
                    {status.behind > 0 && (
                      <span className="text-amber-600 dark:text-amber-400">
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
        </Card>
      )}

      {status && status.files.length > 0 && (
        <div>
          <div className="mb-4 flex items-center gap-3">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Changed Files</h3>
            <span className="inline-flex items-center justify-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium tabular-nums text-gray-600 dark:bg-gray-800 dark:text-gray-400">
              {status.files.length}
            </span>
            <div className="h-px flex-1 bg-gray-200 dark:bg-gray-800" />
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
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Recent Commits</h3>
            <span className="inline-flex items-center justify-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium tabular-nums text-gray-600 dark:bg-gray-800 dark:text-gray-400">
              {log.entries.length}
            </span>
            <div className="h-px flex-1 bg-gray-200 dark:bg-gray-800" />
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
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Branches</h3>
            <span className="inline-flex items-center justify-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium tabular-nums text-gray-600 dark:bg-gray-800 dark:text-gray-400">
              {branches.branches.length}
            </span>
            <div className="h-px flex-1 bg-gray-200 dark:bg-gray-800" />
          </div>
          <div className="flex flex-wrap gap-2.5">
            {branches.branches.map((branch) => (
              <span
                key={branch.name}
                className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium ${
                  branch.current
                    ? 'bg-primary-50 text-primary-700 dark:bg-primary-950/40 dark:text-primary-400'
                    : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                }`}
              >
                {branch.current && (
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary-400" />
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
  added: { bg: 'bg-green-100 dark:bg-green-950', text: 'text-green-700 dark:text-green-400', label: 'A' },
  modified: { bg: 'bg-primary-100 dark:bg-primary-950', text: 'text-primary-700 dark:text-primary-400', label: 'M' },
  deleted: { bg: 'bg-red-100 dark:bg-red-950', text: 'text-red-700 dark:text-red-400', label: 'D' },
  renamed: { bg: 'bg-amber-100 dark:bg-amber-950', text: 'text-amber-700 dark:text-amber-400', label: 'R' },
  untracked: { bg: 'bg-gray-100 dark:bg-gray-800', text: 'text-gray-500 dark:text-gray-400', label: '?' },
};

function FileStatusRow({ file }: { file: GitStatusFile }) {
  const style = STATUS_STYLES[file.status] ?? STATUS_STYLES.modified;

  return (
    <div className="flex items-center gap-3 rounded-lg border border-gray-100 bg-white px-5 py-3.5 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800/50 dark:hover:bg-gray-800">
      <span className={`flex h-5 w-5 items-center justify-center rounded text-[11px] font-bold ${style.bg} ${style.text}`}>
        {file.staged ? '*' : style.label}
      </span>
      <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-gray-700 dark:text-gray-300">
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
    <div className={`flex items-center gap-3.5 px-6 py-3.5 transition-colors hover:bg-gray-50/50 dark:hover:bg-gray-800/30 ${isLast ? '' : 'border-b border-gray-100 dark:border-gray-700/50'}`}>
      <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[11px] text-gray-500 dark:bg-gray-800">
        {entry.shortHash}
      </span>
      <span className="min-w-0 flex-1 truncate text-xs text-gray-700 dark:text-gray-300">
        {entry.message}
      </span>
      <span className="shrink-0 text-[11px] text-gray-400">{entry.author}</span>
      <span className="shrink-0 text-[11px] text-gray-400">{dateStr}</span>
    </div>
  );
}
