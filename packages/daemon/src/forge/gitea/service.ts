import type {
  ForgeRepoRef,
  IssueSummary,
  PullRequestCheck,
  PullRequestCheckoutTarget,
  PullRequestSummary,
} from '@baton/shared';
import type { ForgeService } from '../service.js';
import type { ForgeAdapterRegistration } from '../registry.js';

export interface TeaResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** Runs `tea` (the Gitea CLI) with the given args. Injectable for tests. */
export type TeaRunner = (args: string[]) => Promise<TeaResult>;

export const defaultTeaRunner: TeaRunner = async (args) => {
  const proc = Bun.spawn(['tea', ...args], { stdout: 'pipe', stderr: 'pipe' });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
};

function normState(s: unknown): string {
  return typeof s === 'string' ? s.toLowerCase() : '';
}

interface TeaLabel {
  name?: string;
}

interface TeaPr {
  index?: number;
  number?: number;
  title?: string;
  html_url?: string;
  url?: string;
  state?: string;
  body?: string | null;
  base?: { ref?: string } | null;
  head?: { ref?: string; repo?: { ssh_url?: string; full_name?: string } | null } | null;
  labels?: Array<string | TeaLabel> | null;
  updated_at?: string;
  user?: { login?: string } | null;
  poster?: { login?: string } | null;
}

/**
 * Gitea pull requests / issues over the `tea` CLI. Gitea has no dedicated
 * hostname, so it is resolved only by an async probe (self-hosted instances).
 */
export class GiteaForgeService implements ForgeService {
  readonly kind = 'gitea';

  constructor(private readonly run: TeaRunner = defaultTeaRunner) {}

  private async teaJson<T>(args: string[]): Promise<T> {
    const res = await this.run(args);
    if (res.exitCode !== 0) {
      throw new Error(res.stderr || `tea exited ${res.exitCode}`);
    }
    if (!res.stdout) return [] as unknown as T;
    return JSON.parse(res.stdout) as T;
  }

  private repoArgs(repo: ForgeRepoRef): string[] {
    return ['--repo', repo.slug];
  }

  private num(r: TeaPr): number {
    return r.index ?? r.number ?? 0;
  }

  private author(r: TeaPr): string | null {
    return r.user?.login ?? r.poster?.login ?? null;
  }

  private labels(r: TeaPr): string[] {
    return (r.labels ?? [])
      .map((l) => (typeof l === 'string' ? l : (l.name ?? '')))
      .filter(Boolean);
  }

  async listPullRequests(
    repo: ForgeRepoRef,
    opts?: { state?: string; limit?: number },
  ): Promise<PullRequestSummary[]> {
    const rows = await this.teaJson<TeaPr[]>([
      'pulls',
      'list',
      ...this.repoArgs(repo),
      '--state',
      opts?.state ?? 'open',
      '--limit',
      String(opts?.limit ?? 30),
      '--output',
      'json',
    ]);

    return rows.map((r) => ({
      number: this.num(r),
      title: r.title ?? '',
      url: r.html_url ?? r.url ?? '',
      state: normState(r.state),
      body: r.body ?? null,
      baseRefName: r.base?.ref ?? '',
      headRefName: r.head?.ref ?? '',
      labels: this.labels(r),
      updatedAt: r.updated_at ?? '',
      authorLogin: this.author(r),
      isDraft: false,
    }));
  }

  async listIssues(
    repo: ForgeRepoRef,
    opts?: { state?: string; limit?: number },
  ): Promise<IssueSummary[]> {
    const rows = await this.teaJson<TeaPr[]>([
      'issues',
      'list',
      ...this.repoArgs(repo),
      '--state',
      opts?.state ?? 'open',
      '--limit',
      String(opts?.limit ?? 30),
      '--output',
      'json',
    ]);

    return rows.map((r) => ({
      number: this.num(r),
      title: r.title ?? '',
      url: r.html_url ?? r.url ?? '',
      state: normState(r.state),
      body: r.body ?? null,
      labels: this.labels(r),
      updatedAt: r.updated_at ?? '',
      authorLogin: this.author(r),
    }));
  }

  async getChecks(_repo: ForgeRepoRef, _prNumber: number): Promise<PullRequestCheck[]> {
    // Gitea commit-status / Actions results are not exposed by `tea` in a
    // stable JSON shape across versions; return none for now.
    return [];
  }

  async getCheckoutTarget(
    repo: ForgeRepoRef,
    prNumber: number,
  ): Promise<PullRequestCheckoutTarget> {
    const r = await this.teaJson<TeaPr>([
      'pulls',
      ...this.repoArgs(repo),
      String(prNumber),
      '--output',
      'json',
    ]);

    const headRepo = r.head?.repo?.full_name ?? '';
    const isFork = headRepo !== '' && headRepo.toLowerCase() !== repo.slug.toLowerCase();

    return {
      number: this.num(r) || prNumber,
      baseRefName: r.base?.ref ?? '',
      headRefName: r.head?.ref ?? '',
      headOwnerLogin: this.author(r),
      headRepositorySshUrl: r.head?.repo?.ssh_url ?? null,
      isCrossRepository: isFork,
    };
  }
}

/** Adapter registration for Gitea — resolved only by async probe. */
export function giteaAdapter(runner: TeaRunner = defaultTeaRunner): ForgeAdapterRegistration {
  return {
    createService: () => new GiteaForgeService(runner),
    // No fixed hostname. Probe the instance's Gitea version API.
    probeHost: async (host: string) => {
      try {
        const res = await runner(['api', '--host', `https://${host}`, 'version']);
        return res.exitCode === 0;
      } catch {
        return false;
      }
    },
  };
}
