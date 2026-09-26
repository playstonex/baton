// Neutral forge (code-hosting platform) data model shared across daemon/app/mobile.
// Provider-agnostic by design — GitHub / GitLab / Gitea map their native shapes
// onto these types so the app never sees a provider-specific structure.

/** A forge provider identifier, e.g. 'github' | 'gitlab' | 'gitea'. */
export type ForgeKind = 'github' | 'gitlab' | 'gitea';

/** Neutral search item kind. GitHub's legacy 'pull_request' alias maps to 'change_request'. */
export type ForgeSearchKind = 'issue' | 'change_request';

export interface PullRequestSummary {
  number: number;
  title: string;
  url: string;
  /** Provider-native state lower-cased, e.g. 'open' | 'closed' | 'merged'. */
  state: string;
  body: string | null;
  baseRefName: string;
  headRefName: string;
  labels: string[];
  /** ISO-8601 timestamp. */
  updatedAt: string;
  /** Author login when available. */
  authorLogin?: string | null;
  /** true when the head branch lives in a fork of the base repo. */
  isDraft?: boolean;
}

export interface IssueSummary {
  number: number;
  title: string;
  url: string;
  state: string;
  body: string | null;
  labels: string[];
  updatedAt: string;
  authorLogin?: string | null;
}

export type PullRequestCheckStatus =
  | 'pending'
  | 'success'
  | 'failure'
  | 'cancelled'
  | 'skipped';

export interface PullRequestCheck {
  name: string;
  status: PullRequestCheckStatus;
  url: string | null;
  workflow?: string;
  duration?: string;
  checkRunId?: number;
  workflowRunId?: number;
}

/**
 * Everything needed to check out a PR locally, fork-aware.
 * When `isCrossRepository` is true the head branch lives in `headOwnerLogin`'s
 * fork and must be fetched from `headRepositorySshUrl` rather than origin.
 */
export interface PullRequestCheckoutTarget {
  number: number;
  baseRefName: string;
  headRefName: string;
  headOwnerLogin: string | null;
  headRepositorySshUrl: string | null;
  isCrossRepository: boolean;
}

/** A repo the forge operates on, in owner/name form. */
export interface ForgeRepoRef {
  /** e.g. 'owner/name'. */
  slug: string;
  owner: string;
  name: string;
  /** The forge host, e.g. 'github.com' or a GHE host. */
  host: string;
}
