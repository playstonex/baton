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
    <div className="mx-auto max-w-4xl space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-geist-gray-1000">Pull Requests</h1>
          <p className="mt-0.5 text-sm text-geist-gray-800">
            Browse open PRs and CI checks from a code-hosting platform.
          </p>
        </div>
      </div>

      <form onSubmit={onSubmit} className="flex items-center gap-2">
        <Input
          value={repo}
          onChange={(e) => setRepo(e.target.value)}
          placeholder="owner/name, a URL, or git@host:owner/name.git"
          className="flex-1"
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
        <label className="mb-1.5 block text-xs font-medium text-geist-gray-800">
          Local project path (for checkout)
        </label>
        <Input
          value={checkoutPath}
          onChange={(e) => setCheckoutPath(e.target.value)}
          placeholder="/absolute/path/to/local/clone — required to check out a PR"
          aria-label="Local project path"
        />
      </div>

      {notice && <StatusAlert type="success" message={notice} />}
      {error && <StatusAlert type="error" title="Forge Error" message={error} />}

      {loading && !prs && <LoadingSpinner text="Loading pull requests…" />}

      {prs && prs.length === 0 && (
        <EmptyState
          icon={<IconGitBranch className="h-6 w-6 text-geist-gray-700" />}
          title="No open pull requests"
          description="This repository has no open PRs, or the query returned none."
        />
      )}

      {prs && prs.length > 0 && (
        <div className="space-y-3">
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
        </div>
      )}

      {!prs && !loading && !error && (
        <EmptyState
          icon={<IconGitBranch className="h-6 w-6 text-geist-gray-700" />}
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
    <Card padding={false} className="overflow-hidden">
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-start gap-3 px-5 py-4 text-left transition-colors hover:bg-geist-gray-alpha-100"
      >
        <span className="mt-0.5 shrink-0 rounded bg-geist-gray-alpha-200 px-1.5 py-0.5 font-mono text-[11px] text-geist-gray-800">
          #{pr.number}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-geist-gray-1000">{pr.title}</span>
            {pr.isDraft && (
              <span className="shrink-0 rounded bg-geist-gray-alpha-200 px-1.5 py-0.5 text-[10px] font-medium uppercase text-geist-gray-800">
                Draft
              </span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-geist-gray-700">
            <span className="inline-flex items-center gap-1">
              <IconGitBranch className="h-3 w-3" />
              {pr.headRefName} → {pr.baseRefName}
            </span>
            {pr.authorLogin && <span>@{pr.authorLogin}</span>}
            <span>{updated}</span>
            {pr.labels.map((label) => (
              <span
                key={label}
                className="rounded-full bg-geist-gray-alpha-200 px-2 py-0.5 text-[10px] font-medium text-geist-gray-900"
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
          className="shrink-0 rounded-[var(--radius-sm)] p-1.5 text-geist-gray-700 transition-colors hover:bg-geist-gray-alpha-200 hover:text-geist-gray-1000"
          aria-label="Open on the forge"
        >
          <IconExternalLink className="h-3.5 w-3.5" />
        </a>
      </button>

      {expanded && (
        <div className="border-t border-geist-gray-alpha-200 bg-geist-gray-alpha-100 px-5 py-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-geist-gray-800">
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
            <div className="flex items-center gap-2 text-xs text-geist-gray-800">
              <IconSpinner className="h-3.5 w-3.5 animate-spin" />
              Loading checks…
            </div>
          )}
          {checksError && <StatusAlert type="error" message={checksError} />}
          {checks && checks.length === 0 && (
            <p className="text-xs text-geist-gray-700">No CI checks reported for this PR.</p>
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
    </Card>
  );
}

const CHECK_STYLES: Record<
  PullRequestCheckStatus,
  { bg: string; text: string; label: string }
> = {
  success: {
    bg: 'bg-geist-green-100 dark:bg-geist-green-1000',
    text: 'text-geist-green-700 dark:text-geist-green-900',
    label: 'Passed',
  },
  failure: {
    bg: 'bg-geist-red-100 dark:bg-geist-red-1000',
    text: 'text-geist-red-700 dark:text-geist-red-900',
    label: 'Failed',
  },
  pending: {
    bg: 'bg-geist-amber-100 dark:bg-geist-amber-1000',
    text: 'text-geist-amber-900 dark:text-geist-amber-600',
    label: 'Pending',
  },
  cancelled: {
    bg: 'bg-geist-gray-alpha-200',
    text: 'text-geist-gray-800',
    label: 'Cancelled',
  },
  skipped: {
    bg: 'bg-geist-gray-alpha-200',
    text: 'text-geist-gray-800',
    label: 'Skipped',
  },
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
    <div className="flex items-center gap-3 rounded-[var(--radius-sm)] border border-geist-gray-alpha-300 bg-geist-background-100 px-4 py-2.5">
      <span
        className={`flex h-5 w-5 items-center justify-center rounded ${style.bg} ${style.text}`}
      >
        <Icon className={`h-3 w-3 ${check.status === 'pending' ? 'animate-spin' : ''}`} />
      </span>
      <span className="min-w-0 flex-1 truncate text-[13px] text-geist-gray-900">{check.name}</span>
      {check.workflow && (
        <span className="shrink-0 text-[11px] text-geist-gray-700">{check.workflow}</span>
      )}
      <span className={`shrink-0 text-[11px] font-medium ${style.text}`}>{style.label}</span>
      {check.url && (
        <a
          href={check.url}
          target="_blank"
          rel="noreferrer noopener"
          className="shrink-0 text-geist-gray-700 transition-colors hover:text-geist-gray-1000"
          aria-label="Open check"
        >
          <IconExternalLink className="h-3.5 w-3.5" />
        </a>
      )}
    </div>
  );
}
