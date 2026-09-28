import type { PullRequestCheckoutTarget } from '@baton/shared';

export interface GitRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** Runs a git command in a cwd. Injectable so tests can stub it. */
export type GitRunner = (cwd: string, args: string[]) => Promise<GitRunResult>;

/** Default runner: spawns `git` via Bun. */
export const defaultGitRunner: GitRunner = async (cwd, args) => {
  const proc = Bun.spawn(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
};

export interface CheckoutResult {
  success: boolean;
  localBranch: string;
  output: string;
}

/**
 * Check out a pull request locally, fork-aware.
 *
 * GitHub exposes every PR head — including one from a fork — under the base
 * repo's `refs/pull/<n>/head`. Fetching that ref sidesteps having to add the
 * fork as a remote, so the same command works for same-repo and cross-repo
 * PRs. The head is fetched into a local `pr/<n>` branch which is then checked
 * out. For a same-repo PR we prefer the real head branch name so the checkout
 * tracks it; for a fork we keep the synthetic `pr/<n>` name (the contributor's
 * branch does not exist in origin).
 */
export async function checkoutPullRequest(
  projectPath: string,
  target: PullRequestCheckoutTarget,
  run: GitRunner = defaultGitRunner,
): Promise<CheckoutResult> {
  const localBranch = target.isCrossRepository
    ? `pr/${target.number}`
    : target.headRefName || `pr/${target.number}`;

  // Fetch the PR head ref from origin into the local branch (force-update so a
  // re-checkout picks up new pushes to the PR).
  const fetch = await run(projectPath, [
    'fetch',
    'origin',
    `+refs/pull/${target.number}/head:${localBranch}`,
  ]);
  if (fetch.exitCode !== 0) {
    throw new Error(fetch.stderr || `Failed to fetch PR #${target.number}`);
  }

  const checkout = await run(projectPath, ['checkout', localBranch]);
  if (checkout.exitCode !== 0) {
    throw new Error(checkout.stderr || `Failed to checkout ${localBranch}`);
  }

  return {
    success: true,
    localBranch,
    output: [fetch.stdout, checkout.stdout].filter(Boolean).join('\n'),
  };
}
