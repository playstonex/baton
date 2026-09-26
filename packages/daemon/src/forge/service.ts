import type {
  ForgeRepoRef,
  IssueSummary,
  PullRequestCheck,
  PullRequestCheckoutTarget,
  PullRequestSummary,
} from '@baton/shared';

/**
 * A forge provider's capabilities against one host. Implementations map their
 * native API onto the neutral shared types. Every method takes a resolved
 * {@link ForgeRepoRef} so the service stays stateless per call.
 */
export interface ForgeService {
  /** Which forge this service implements, e.g. 'github'. */
  readonly kind: string;

  listPullRequests(repo: ForgeRepoRef, opts?: { state?: string; limit?: number }): Promise<PullRequestSummary[]>;

  listIssues(repo: ForgeRepoRef, opts?: { state?: string; limit?: number }): Promise<IssueSummary[]>;

  getChecks(repo: ForgeRepoRef, prNumber: number): Promise<PullRequestCheck[]>;

  getCheckoutTarget(repo: ForgeRepoRef, prNumber: number): Promise<PullRequestCheckoutTarget>;
}
