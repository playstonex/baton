import type {
  ForgeRepoRef,
  IssueSummary,
  PullRequestCheck,
  PullRequestCheckStatus,
  PullRequestCheckoutTarget,
  PullRequestSummary,
} from '@baton/shared';
import type { ForgeService } from '../service.js';
import type { ForgeAdapterRegistration } from '../registry.js';

export interface GlabResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** Runs `glab` with the given args. Injectable so tests can stub it. */
export type GlabRunner = (args: string[]) => Promise<GlabResult>;

export const defaultGlabRunner: GlabRunner = async (args) => {
  const proc = Bun.spawn(['glab', ...args], { stdout: 'pipe', stderr: 'pipe' });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
};

const GITLAB_COM = 'gitlab.com';

function normState(s: unknown): string {
  return typeof s === 'string' ? s.toLowerCase() : '';
}

// GitLab pipeline status -> neutral check status.
function mapPipelineStatus(status: unknown): PullRequestCheckStatus {
  const s = String(status ?? '').toLowerCase();
  if (s === 'success' || s === 'passed') return 'success';
  if (s === 'failed') return 'failure';
  if (s === 'canceled' || s === 'cancelled') return 'cancelled';
  if (s === 'skipped' || s === 'manual') return 'skipped';
  return 'pending';
}

interface GlabLabel {
  name?: string;
}

/**
 * GitLab merge requests, over the `glab` CLI. GitLab calls them MRs; they map
 * onto the neutral PullRequest* shapes (the shared model treats "change
 * request" and "pull request" as the same concept).
 */
export class GitLabForgeService implements ForgeService {
  readonly kind = 'gitlab';

  constructor(private readonly run: GlabRunner = defaultGlabRunner) {}

  private async glabJson<T>(args: string[]): Promise<T> {
    const res = await this.run(args);
    if (res.exitCode !== 0) {
      throw new Error(res.stderr || `glab exited ${res.exitCode}`);
    }
    if (!res.stdout) return [] as unknown as T;
    return JSON.parse(res.stdout) as T;
  }

  private repoArgs(repo: ForgeRepoRef): string[] {
    return ['--repo', repo.slug];
  }

  async listPullRequests(
    repo: ForgeRepoRef,
    opts?: { state?: string; limit?: number },
  ): Promise<PullRequestSummary[]> {
    const rows = await this.glabJson<
      Array<{
        iid: number;
        title: string;
        web_url: string;
        state: string;
        description: string | null;
        target_branch: string;
        source_branch: string;
        labels: Array<string | GlabLabel>;
        updated_at: string;
        author?: { username?: string } | null;
        draft?: boolean;
        work_in_progress?: boolean;
      }>
    >([
      'mr',
      'list',
      ...this.repoArgs(repo),
      '--state',
      opts?.state ?? 'opened',
      '--per-page',
      String(opts?.limit ?? 30),
      '-F',
      'json',
    ]);

    return rows.map((r) => ({
      number: r.iid,
      title: r.title,
      url: r.web_url,
      state: normState(r.state),
      body: r.description ?? null,
      baseRefName: r.target_branch,
      headRefName: r.source_branch,
      labels: (r.labels ?? []).map((l) => (typeof l === 'string' ? l : (l.name ?? ''))).filter(Boolean),
      updatedAt: r.updated_at,
      authorLogin: r.author?.username ?? null,
      isDraft: r.draft ?? r.work_in_progress ?? false,
    }));
  }

  async listIssues(
    repo: ForgeRepoRef,
    opts?: { state?: string; limit?: number },
  ): Promise<IssueSummary[]> {
    const rows = await this.glabJson<
      Array<{
        iid: number;
        title: string;
        web_url: string;
        state: string;
        description: string | null;
        labels: Array<string | GlabLabel>;
        updated_at: string;
        author?: { username?: string } | null;
      }>
    >([
      'issue',
      'list',
      ...this.repoArgs(repo),
      '--state',
      opts?.state ?? 'opened',
      '--per-page',
      String(opts?.limit ?? 30),
      '-F',
      'json',
    ]);

    return rows.map((r) => ({
      number: r.iid,
      title: r.title,
      url: r.web_url,
      state: normState(r.state),
      body: r.description ?? null,
      labels: (r.labels ?? []).map((l) => (typeof l === 'string' ? l : (l.name ?? ''))).filter(Boolean),
      updatedAt: r.updated_at,
      authorLogin: r.author?.username ?? null,
    }));
  }

  async getChecks(_repo: ForgeRepoRef, _prNumber: number): Promise<PullRequestCheck[]> {
    // GitLab pipeline status per-MR is not uniformly exposed by `glab` across
    // versions (the JSON shape of `glab ci status` changed and is tied to the
    // checked-out branch rather than an MR iid). Rather than ship a command
    // that breaks on some glab versions, this returns no checks for now; the
    // neutral status mapping (mapPipelineStatus) is kept ready for when a
    // stable MR-scoped pipeline query is wired in.
    void mapPipelineStatus;
    return [];
  }

  async getCheckoutTarget(
    repo: ForgeRepoRef,
    prNumber: number,
  ): Promise<PullRequestCheckoutTarget> {
    const r = await this.glabJson<{
      iid: number;
      target_branch: string;
      source_branch: string;
      source_project_id?: number;
      target_project_id?: number;
      author?: { username?: string } | null;
      source_project?: { ssh_url_to_repo?: string } | null;
    }>(['mr', 'view', String(prNumber), ...this.repoArgs(repo), '-F', 'json']);

    const isFork =
      r.source_project_id != null &&
      r.target_project_id != null &&
      r.source_project_id !== r.target_project_id;

    return {
      number: r.iid,
      baseRefName: r.target_branch,
      headRefName: r.source_branch,
      headOwnerLogin: r.author?.username ?? null,
      headRepositorySshUrl: r.source_project?.ssh_url_to_repo ?? null,
      isCrossRepository: isFork,
    };
  }
}

/** Adapter registration for GitLab (gitlab.com; self-hosted via probe). */
export function gitlabAdapter(runner: GlabRunner = defaultGlabRunner): ForgeAdapterRegistration {
  return {
    createService: () => new GitLabForgeService(runner),
    matchesHost: (host: string) => host === GITLAB_COM,
    probeHost: async (host: string) => {
      if (host === GITLAB_COM) return true;
      // Self-managed GitLab: glab api against the instance version endpoint.
      try {
        const res = await runner(['api', '--hostname', host, 'version']);
        return res.exitCode === 0;
      } catch {
        return false;
      }
    },
  };
}
