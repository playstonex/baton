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

/** Result of running the `gh` CLI. */
export interface GhResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** Runs `gh` with the given args. Injectable so tests can stub it. */
export type GhRunner = (args: string[]) => Promise<GhResult>;

/** Default runner: spawns the `gh` binary via Bun. */
export const defaultGhRunner: GhRunner = async (args) => {
  const proc = Bun.spawn(['gh', ...args], { stdout: 'pipe', stderr: 'pipe' });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
};

const GITHUB_COM = 'github.com';

// gh returns state as UPPER_CASE for GraphQL-backed fields; normalize to lower.
function normState(s: unknown): string {
  return typeof s === 'string' ? s.toLowerCase() : '';
}

// Map gh's check conclusion/state onto the neutral status enum.
function mapCheckStatus(state: unknown, bucket: unknown): PullRequestCheckStatus {
  const s = String(state ?? '').toLowerCase();
  const b = String(bucket ?? '').toLowerCase();
  if (s === 'success' || b === 'pass') return 'success';
  if (s === 'failure' || b === 'fail') return 'failure';
  if (s === 'cancelled' || s === 'canceled') return 'cancelled';
  if (s === 'skipped' || s === 'neutral') return 'skipped';
  return 'pending';
}

interface GhLabel {
  name?: string;
}

export class GitHubForgeService implements ForgeService {
  readonly kind = 'github';

  constructor(private readonly run: GhRunner = defaultGhRunner) {}

  private async ghJson<T>(args: string[]): Promise<T> {
    const res = await this.run(args);
    if (res.exitCode !== 0) {
      throw new Error(res.stderr || `gh exited ${res.exitCode}`);
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
    const fields = 'number,title,url,state,body,baseRefName,headRefName,labels,updatedAt,author,isDraft';
    const rows = await this.ghJson<
      Array<{
        number: number;
        title: string;
        url: string;
        state: string;
        body: string | null;
        baseRefName: string;
        headRefName: string;
        labels: GhLabel[];
        updatedAt: string;
        author?: { login?: string } | null;
        isDraft?: boolean;
      }>
    >([
      'pr',
      'list',
      ...this.repoArgs(repo),
      '--state',
      opts?.state ?? 'open',
      '--limit',
      String(opts?.limit ?? 30),
      '--json',
      fields,
    ]);

    return rows.map((r) => ({
      number: r.number,
      title: r.title,
      url: r.url,
      state: normState(r.state),
      body: r.body ?? null,
      baseRefName: r.baseRefName,
      headRefName: r.headRefName,
      labels: (r.labels ?? []).map((l) => l.name ?? '').filter(Boolean),
      updatedAt: r.updatedAt,
      authorLogin: r.author?.login ?? null,
      isDraft: r.isDraft ?? false,
    }));
  }

  async listIssues(
    repo: ForgeRepoRef,
    opts?: { state?: string; limit?: number },
  ): Promise<IssueSummary[]> {
    const rows = await this.ghJson<
      Array<{
        number: number;
        title: string;
        url: string;
        state: string;
        body: string | null;
        labels: GhLabel[];
        updatedAt: string;
        author?: { login?: string } | null;
      }>
    >([
      'issue',
      'list',
      ...this.repoArgs(repo),
      '--state',
      opts?.state ?? 'open',
      '--limit',
      String(opts?.limit ?? 30),
      '--json',
      'number,title,url,state,body,labels,updatedAt,author',
    ]);

    return rows.map((r) => ({
      number: r.number,
      title: r.title,
      url: r.url,
      state: normState(r.state),
      body: r.body ?? null,
      labels: (r.labels ?? []).map((l) => l.name ?? '').filter(Boolean),
      updatedAt: r.updatedAt,
      authorLogin: r.author?.login ?? null,
    }));
  }

  async getChecks(repo: ForgeRepoRef, prNumber: number): Promise<PullRequestCheck[]> {
    // `gh pr checks` exits non-zero when checks are failing/pending, so we do
    // not treat a non-zero exit as an error here — we parse whatever JSON came.
    const res = await this.run([
      'pr',
      'checks',
      String(prNumber),
      ...this.repoArgs(repo),
      '--json',
      'name,state,bucket,link,workflow,completedAt,startedAt',
    ]);
    if (!res.stdout) {
      if (res.exitCode !== 0 && res.stderr) throw new Error(res.stderr);
      return [];
    }
    const rows = JSON.parse(res.stdout) as Array<{
      name: string;
      state?: string;
      bucket?: string;
      link?: string | null;
      workflow?: string;
    }>;
    return rows.map((r) => ({
      name: r.name,
      status: mapCheckStatus(r.state, r.bucket),
      url: r.link ?? null,
      workflow: r.workflow,
    }));
  }

  async getCheckoutTarget(
    repo: ForgeRepoRef,
    prNumber: number,
  ): Promise<PullRequestCheckoutTarget> {
    const r = await this.ghJson<{
      number: number;
      baseRefName: string;
      headRefName: string;
      isCrossRepository: boolean;
      headRepositoryOwner?: { login?: string } | null;
      headRepository?: { sshUrl?: string; name?: string } | null;
    }>([
      'pr',
      'view',
      String(prNumber),
      ...this.repoArgs(repo),
      '--json',
      'number,baseRefName,headRefName,isCrossRepository,headRepositoryOwner,headRepository',
    ]);

    return {
      number: r.number,
      baseRefName: r.baseRefName,
      headRefName: r.headRefName,
      headOwnerLogin: r.headRepositoryOwner?.login ?? null,
      headRepositorySshUrl: r.headRepository?.sshUrl ?? null,
      isCrossRepository: r.isCrossRepository ?? false,
    };
  }
}

/** Adapter registration for the GitHub forge (github.com; GHE via probe). */
export function githubAdapter(runner: GhRunner = defaultGhRunner): ForgeAdapterRegistration {
  return {
    createService: () => new GitHubForgeService(runner),
    matchesHost: (host: string) => host === GITHUB_COM || host === `www.${GITHUB_COM}`,
    // GHE detection: `gh api` against the host's /meta succeeds for a GitHub
    // Enterprise host. Any error means "not a GitHub host" -> false (never throw).
    probeHost: async (host: string) => {
      if (host === GITHUB_COM) return true;
      try {
        const res = await runner(['api', '--hostname', host, 'meta', '--silent']);
        return res.exitCode === 0;
      } catch {
        return false;
      }
    },
  };
}
