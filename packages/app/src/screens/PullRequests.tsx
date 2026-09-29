import { useState, useCallback } from 'react';
import type { PullRequestSummary, PullRequestCheck, PullRequestCheckStatus } from '@baton/shared';
import {
  Card,
  Button,
  Input,
  StatusAlert,
  LoadingSpinner,
  EmptyState,
} from '../lib/ui.js';
import {
  IconGitBranch,
  IconExternalLink,
  IconCheck,
  IconAlertCircle,
  IconSpinner,
  IconRefreshCw,
} from '../lib/icons.js';

const REPO_STORAGE_KEY = 'baton-forge-repo';
const CHECKOUT_PATH_KEY = 'baton-forge-checkout-path';

export function PullRequestsScreen() {
  const [repo, setRepo] = useState(() => localStorage.getItem(REPO_STORAGE_KEY) ?? '');
  const [checkoutPath, setCheckoutPath] = useState(
    () => localStorage.getItem(CHECKOUT_PATH_KEY) ?? '',
  );
  const [prs, setPrs] = useState<PullRequestSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [checkingOut, setCheckingOut] = useState<number | null>(null);

  const load = useCallback(async (repoValue: string) => {
    const trimmed = repoValue.trim();
    if (!trimmed) return;
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/forge/prs?repo=${encodeURIComponent(trimmed)}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Failed to load pull requests');
        setPrs(null);
      } else {
        setPrs(data as PullRequestSummary[]);
        localStorage.setItem(REPO_STORAGE_KEY, trimmed);
      }
    } catch {
      setError('Failed to reach the daemon');
      setPrs(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const checkout = useCallback(
    async (prNumber: number) => {
      const path = checkoutPath.trim();
      if (!path) {
        setError('Set a local project path before checking out a PR.');
        return;
      }
      setCheckingOut(prNumber);
      setError(null);
      setNotice(null);
      try {
        const res = await fetch(`/api/forge/pr/${prNumber}/checkout`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ repo: repo.trim(), projectPath: path }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? `Checkout of PR #${prNumber} failed`);
        } else {
          localStorage.setItem(CHECKOUT_PATH_KEY, path);
          setNotice(`Checked out PR #${prNumber} onto local branch ${data.localBranch}.`);
        }
      } catch {
        setError('Failed to reach the daemon');
      } finally {
        setCheckingOut(null);
      }
    },
    [checkoutPath, repo],
  );

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setExpanded(null);
    void load(repo);
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-[-0.02em] text-fg">Pull requests</h1>
        <p className="mt-1 text-[13px] text-muted">
          Browse open PRs and CI checks from a code-hosting platform.
        </p>
      </div>

      <form onSubmit={onSubmit} className="flex items-center gap-2">
        <Input
          value={repo}
          onChange={(e) => setRepo(e.target.value)}
          placeholder="owner/name, a URL, or git@host:owner/name.git"
          className="flex-1 font-mono"
          aria-label="Repository"
        />
        <Button variant="primary" type="submit" disabled={loading || !repo.trim()}>
          {loading ? (
            <>
              <IconSpinner className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              Loading…
            </>
          ) : (
            <>
              <IconRefreshCw className="mr-1.5 h-3.5 w-3.5" />
              Load
            </>
          )}
        </Button>
      </form>

      <div>
        <label className="mb-2 block text-xs font-medium text-muted">
          Local project path (for checkout)
        </label>
        <Input
          value={checkoutPath}
          onChange={(e) => setCheckoutPath(e.target.value)}
          placeholder="/absolute/path/to/local/clone — required to check out a PR"
          className="font-mono"
          aria-label="Local project path"
        />
      </div>

      {notice && <StatusAlert type="success" message={notice} />}
      {error && <StatusAlert type="error" title="Forge error" message={error} />}

      {loading && !prs && <LoadingSpinner text="Loading pull requests…" />}

      {prs && prs.length === 0 && (
        <EmptyState
          icon={<IconGitBranch className="h-5 w-5" />}
          title="No open pull requests"
          description="This repository has no open PRs, or the query returned none."
        />
      )}

      {prs && prs.length > 0 && (
        <Card padding={false} className="divide-y divide-line-soft overflow-hidden">
          {prs.map((pr) => (
            <PullRequestRow
              key={pr.number}
              pr={pr}
              repo={repo.trim()}
              expanded={expanded === pr.number}
              onToggle={() => setExpanded((cur) => (cur === pr.number ? null : pr.number))}
              onCheckout={() => checkout(pr.number)}
              checkingOut={checkingOut === pr.number}
              canCheckout={checkoutPath.trim().length > 0}
            />
          ))}
        </Card>
      )}

      {!prs && !loading && !error && (
        <EmptyState
          icon={<IconGitBranch className="h-5 w-5" />}
          title="Enter a repository"
          description="e.g. kirodotdev/KiroCrew — then press Load."
        />
      )}
    </div>
  );
}

function PullRequestRow({
  pr,
  repo,
  expanded,
  onToggle,
  onCheckout,
  checkingOut,
  canCheckout,
}: {
  pr: PullRequestSummary;
  repo: string;
  expanded: boolean;
  onToggle: () => void;
  onCheckout: () => void;
  checkingOut: boolean;
  canCheckout: boolean;
}) {
  const [checks, setChecks] = useState<PullRequestCheck[] | null>(null);
  const [checksLoading, setChecksLoading] = useState(false);
  const [checksError, setChecksError] = useState<string | null>(null);

  const toggle = useCallback(async () => {
    onToggle();
    if (!expanded && checks === null && !checksLoading) {
      setChecksLoading(true);
      setChecksError(null);
      try {
        const res = await fetch(
          `/api/forge/pr/${pr.number}/checks?repo=${encodeURIComponent(repo)}`,
        );
        const data = await res.json();
        if (!res.ok) setChecksError(data.error ?? 'Failed to load checks');
        else setChecks(data as PullRequestCheck[]);
      } catch {
        setChecksError('Failed to reach the daemon');
      } finally {
        setChecksLoading(false);
      }
    }
  }, [expanded, checks, checksLoading, onToggle, pr.number, repo]);

  const updated = new Date(pr.updatedAt).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div>
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-start gap-3 px-5 py-3.5 text-left transition-colors duration-150 hover:bg-raised/50"
      >
        <span className="mt-0.5 shrink-0 rounded-sm bg-raised px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-muted">
          #{pr.number}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[13px] font-medium text-fg">{pr.title}</span>
            {pr.isDraft && (
              <span className="shrink-0 rounded-sm bg-raised px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted">
                Draft
              </span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-meta">
            <span className="inline-flex items-center gap-1">
              <IconGitBranch className="h-3 w-3" />
              {pr.headRefName} → {pr.baseRefName}
            </span>
            {pr.authorLogin && <span>@{pr.authorLogin}</span>}
            <span className="tabular-nums">{updated}</span>
            {pr.labels.map((label) => (
              <span
                key={label}
                className="rounded-full bg-raised px-2 py-0.5 font-sans text-[10px] font-medium text-muted"
              >
                {label}
              </span>
            ))}
          </div>
        </div>
        <a
          href={pr.url}
          target="_blank"
          rel="noreferrer noopener"
          onClick={(e) => e.stopPropagation()}
          className="shrink-0 rounded-sm p-1.5 text-muted transition-colors duration-150 hover:bg-raised hover:text-fg"
          aria-label="Open on the forge"
        >
          <IconExternalLink className="h-3.5 w-3.5" />
        </a>
      </button>

      {expanded && (
        <div className="border-t border-line-soft bg-canvas px-5 py-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-xs font-semibold text-muted">
              Checks
            </span>
            <Button
              size="sm"
              variant="secondary"
              disabled={checkingOut || !canCheckout}
              title={canCheckout ? 'Fetch this PR into the local project path' : 'Set a local project path first'}
              onClick={onCheckout}
            >
              {checkingOut ? (
                <>
                  <IconSpinner className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  Checking out…
                </>
              ) : (
                <>
                  <IconGitBranch className="mr-1.5 h-3.5 w-3.5" />
                  Checkout
                </>
              )}
            </Button>
          </div>
          {checksLoading && (
            <div className="flex items-center gap-2 text-xs text-muted">
              <IconSpinner className="h-3.5 w-3.5 animate-spin" />
              Loading checks…
            </div>
          )}
          {checksError && <StatusAlert type="error" message={checksError} />}
          {checks && checks.length === 0 && (
            <p className="text-xs text-muted">No CI checks reported for this PR.</p>
          )}
          {checks && checks.length > 0 && (
            <div className="space-y-1.5">
              {checks.map((check, i) => (
                <CheckRow key={`${check.name}-${i}`} check={check} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const CHECK_STYLES: Record<
  PullRequestCheckStatus,
  { bg: string; text: string; label: string }
> = {
  success: { bg: 'bg-success-soft', text: 'text-success', label: 'Passed' },
  failure: { bg: 'bg-danger-soft', text: 'text-danger', label: 'Failed' },
  pending: { bg: 'bg-warn-soft', text: 'text-warn', label: 'Pending' },
  cancelled: { bg: 'bg-raised', text: 'text-muted', label: 'Cancelled' },
  skipped: { bg: 'bg-raised', text: 'text-muted', label: 'Skipped' },
};

function CheckRow({ check }: { check: PullRequestCheck }) {
  const style = CHECK_STYLES[check.status] ?? CHECK_STYLES.pending;
  const Icon =
    check.status === 'success'
      ? IconCheck
      : check.status === 'failure'
        ? IconAlertCircle
        : IconSpinner;

  return (
    <div className="flex items-center gap-3 rounded-sm border border-line-soft bg-surface px-3 py-2">
      <span className={`flex h-5 w-5 items-center justify-center rounded-sm ${style.bg} ${style.text}`}>
        <Icon className={`h-3 w-3 ${check.status === 'pending' ? 'animate-spin' : ''}`} />
      </span>
      <span className="min-w-0 flex-1 truncate text-[13px] text-fg-2">{check.name}</span>
      {check.workflow && (
        <span className="shrink-0 text-[11px] text-meta">{check.workflow}</span>
      )}
      <span className={`shrink-0 text-[11px] font-medium ${style.text}`}>{style.label}</span>
      {check.url && (
        <a
          href={check.url}
          target="_blank"
          rel="noreferrer noopener"
          className="shrink-0 text-muted transition-colors duration-150 hover:text-fg"
          aria-label="Open check"
        >
          <IconExternalLink className="h-3.5 w-3.5" />
        </a>
      )}
    </div>
  );
}
