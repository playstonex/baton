import { describe, it, expect } from 'vitest';
import { ForgeRegistry } from '../forge/registry.js';
import type { ForgeService } from '../forge/service.js';
import { parseRepoRef, createDefaultForgeRegistry } from '../forge/index.js';
import { GitHubForgeService, githubAdapter, type GhRunner, type GhResult } from '../forge/github/service.js';
import { GitLabForgeService, gitlabAdapter, type GlabRunner, type GlabResult } from '../forge/gitlab/service.js';
import { GiteaForgeService, type TeaRunner, type TeaResult } from '../forge/gitea/service.js';
import { checkoutPullRequest, type GitRunner, type GitRunResult } from '../forge/checkout.js';
import type { ForgeRepoRef, PullRequestCheckoutTarget } from '@baton/shared';

const stubService = (kind: string): ForgeService =>
  ({
    kind,
    listPullRequests: async () => [],
    listIssues: async () => [],
    getChecks: async () => [],
    getCheckoutTarget: async () => ({
      number: 0,
      baseRefName: '',
      headRefName: '',
      headOwnerLogin: null,
      headRepositorySshUrl: null,
      isCrossRepository: false,
    }),
  }) as ForgeService;

describe('ForgeRegistry.matchHost', () => {
  it('returns the single matching forge', () => {
    const r = new ForgeRegistry();
    r.register('github', { createService: () => stubService('github'), matchesHost: (h) => h === 'github.com' });
    r.register('gitlab', { createService: () => stubService('gitlab'), matchesHost: (h) => h === 'gitlab.com' });
    expect(r.matchHost('github.com')).toBe('github');
    expect(r.matchHost('gitlab.com')).toBe('gitlab');
  });

  it('returns null when no adapter matches', () => {
    const r = new ForgeRegistry();
    r.register('github', { createService: () => stubService('github'), matchesHost: (h) => h === 'github.com' });
    expect(r.matchHost('example.com')).toBeNull();
  });

  it('returns null when the match is ambiguous (two adapters claim the host)', () => {
    const r = new ForgeRegistry();
    r.register('a', { createService: () => stubService('a'), matchesHost: () => true });
    r.register('b', { createService: () => stubService('b'), matchesHost: () => true });
    expect(r.matchHost('anything')).toBeNull();
  });
});

describe('ForgeRegistry.probeHost', () => {
  it('survives a probe that throws — allSettled, not all', async () => {
    const r = new ForgeRegistry();
    r.register('good', {
      createService: () => stubService('good'),
      probeHost: async () => true,
    });
    r.register('throws', {
      createService: () => stubService('throws'),
      probeHost: async () => {
        throw new Error('not this forge');
      },
    });
    // The throwing probe must not break resolution of the good one.
    expect(await r.probeHost('ghe.internal')).toBe('good');
  });

  it('returns null when two probes both claim the host', async () => {
    const r = new ForgeRegistry();
    r.register('a', { createService: () => stubService('a'), probeHost: async () => true });
    r.register('b', { createService: () => stubService('b'), probeHost: async () => true });
    expect(await r.probeHost('ghe.internal')).toBeNull();
  });

  it('returns null when no probe claims the host', async () => {
    const r = new ForgeRegistry();
    r.register('a', { createService: () => stubService('a'), probeHost: async () => false });
    expect(await r.probeHost('ghe.internal')).toBeNull();
  });
});

describe('ForgeRegistry.resolveHost', () => {
  it('prefers a synchronous match over probing', async () => {
    const r = new ForgeRegistry();
    let probed = false;
    r.register('github', {
      createService: () => stubService('github'),
      matchesHost: (h) => h === 'github.com',
      probeHost: async () => {
        probed = true;
        return true;
      },
    });
    expect(await r.resolveHost('github.com')).toBe('github');
    expect(probed).toBe(false);
  });

  it('falls back to probing when no sync match', async () => {
    const r = new ForgeRegistry();
    r.register('github', {
      createService: () => stubService('github'),
      matchesHost: (h) => h === 'github.com',
      probeHost: async (h) => h === 'ghe.internal',
    });
    expect(await r.resolveHost('ghe.internal')).toBe('github');
  });
});

describe('ForgeRegistry.register / unregister / create', () => {
  it('create returns null for an unknown forge', () => {
    const r = new ForgeRegistry();
    expect(r.create('nope')).toBeNull();
  });

  it('unregister removes the adapter', () => {
    const r = new ForgeRegistry();
    const off = r.register('github', { createService: () => stubService('github') });
    expect(r.create('github')?.kind).toBe('github');
    off();
    expect(r.create('github')).toBeNull();
  });

  it('lists registered forges', () => {
    const r = createDefaultForgeRegistry();
    expect(r.list()).toEqual(expect.arrayContaining(['github', 'gitlab', 'gitea']));
  });
});

describe('parseRepoRef', () => {
  it('parses a bare owner/name slug', () => {
    expect(parseRepoRef('kirodotdev/KiroCrew')).toEqual({
      slug: 'kirodotdev/KiroCrew',
      owner: 'kirodotdev',
      name: 'KiroCrew',
      host: 'github.com',
    });
  });

  it('parses a full https URL', () => {
    expect(parseRepoRef('https://github.com/owner/repo.git')).toEqual({
      slug: 'owner/repo',
      owner: 'owner',
      name: 'repo',
      host: 'github.com',
    });
  });

  it('parses an scp-like SSH remote', () => {
    expect(parseRepoRef('git@github.com:owner/repo.git')).toEqual({
      slug: 'owner/repo',
      owner: 'owner',
      name: 'repo',
      host: 'github.com',
    });
  });

  it('honours a custom default host for bare slugs', () => {
    expect(parseRepoRef('owner/repo', 'ghe.internal')?.host).toBe('ghe.internal');
  });

  it('returns null for garbage', () => {
    expect(parseRepoRef('')).toBeNull();
    expect(parseRepoRef('not a repo')).toBeNull();
  });
});

// A GhRunner stub that returns canned JSON per gh subcommand.
function makeRunner(map: Record<string, GhResult>): GhRunner {
  return async (args: string[]) => {
    const key = args.slice(0, 2).join(' ');
    return map[key] ?? { stdout: '', stderr: 'no stub', exitCode: 1 };
  };
}

const repo: ForgeRepoRef = { slug: 'owner/repo', owner: 'owner', name: 'repo', host: 'github.com' };

describe('GitHubForgeService', () => {
  it('maps gh pr list JSON onto neutral PullRequestSummary (state lower-cased, labels flattened)', async () => {
    const runner = makeRunner({
      'pr list': {
        stdout: JSON.stringify([
          {
            number: 12,
            title: 'Add rate limiting',
            url: 'https://github.com/owner/repo/pull/12',
            state: 'OPEN',
            body: 'body',
            baseRefName: 'main',
            headRefName: 'feat/rl',
            labels: [{ name: 'enhancement' }, { name: 'p1' }],
            updatedAt: '2026-09-26T00:00:00Z',
            author: { login: 'alice' },
            isDraft: false,
          },
        ]),
        stderr: '',
        exitCode: 0,
      },
    });
    const svc = new GitHubForgeService(runner);
    const prs = await svc.listPullRequests(repo);
    expect(prs).toHaveLength(1);
    expect(prs[0]).toMatchObject({
      number: 12,
      state: 'open',
      baseRefName: 'main',
      headRefName: 'feat/rl',
      labels: ['enhancement', 'p1'],
      authorLogin: 'alice',
    });
  });

  it('maps gh pr checks buckets onto the neutral status enum, ignoring non-zero exit', async () => {
    const runner = makeRunner({
      'pr checks': {
        stdout: JSON.stringify([
          { name: 'build', state: 'SUCCESS', bucket: 'pass', link: 'https://x/1', workflow: 'CI' },
          { name: 'test', state: 'FAILURE', bucket: 'fail', link: null },
          { name: 'lint', state: '', bucket: 'pending' },
        ]),
        stderr: '',
        exitCode: 8, // gh exits non-zero when a check is failing
      },
    });
    const svc = new GitHubForgeService(runner);
    const checks = await svc.getChecks(repo, 12);
    expect(checks.map((c) => c.status)).toEqual(['success', 'failure', 'pending']);
    expect(checks[0]).toMatchObject({ name: 'build', url: 'https://x/1', workflow: 'CI' });
  });

  it('maps a fork PR view onto a cross-repository checkout target', async () => {
    const runner = makeRunner({
      'pr view': {
        stdout: JSON.stringify({
          number: 7,
          baseRefName: 'main',
          headRefName: 'patch-1',
          isCrossRepository: true,
          headRepositoryOwner: { login: 'contributor' },
          headRepository: { sshUrl: 'git@github.com:contributor/repo.git', name: 'repo' },
        }),
        stderr: '',
        exitCode: 0,
      },
    });
    const svc = new GitHubForgeService(runner);
    const target = await svc.getCheckoutTarget(repo, 7);
    expect(target).toEqual({
      number: 7,
      baseRefName: 'main',
      headRefName: 'patch-1',
      headOwnerLogin: 'contributor',
      headRepositorySshUrl: 'git@github.com:contributor/repo.git',
      isCrossRepository: true,
    });
  });

  it('throws with gh stderr when a list command fails', async () => {
    const runner = makeRunner({
      'pr list': { stdout: '', stderr: 'gh: not authenticated', exitCode: 1 },
    });
    const svc = new GitHubForgeService(runner);
    await expect(svc.listPullRequests(repo)).rejects.toThrow('not authenticated');
  });
});

describe('githubAdapter', () => {
  it('matches github.com synchronously and probes github.com true', async () => {
    const adapter = githubAdapter(async () => ({ stdout: '', stderr: '', exitCode: 0 }));
    expect(adapter.matchesHost?.('github.com')).toBe(true);
    expect(adapter.matchesHost?.('gitlab.com')).toBe(false);
    expect(await adapter.probeHost?.('github.com')).toBe(true);
  });

  it('probeHost returns false (never throws) when gh api fails for a non-GitHub host', async () => {
    const adapter = githubAdapter(async () => {
      throw new Error('spawn gh ENOENT');
    });
    expect(await adapter.probeHost?.('example.com')).toBe(false);
  });
});

// ── checkout helper ──
function makeGitRunner(map: Record<string, GitRunResult>): { run: GitRunner; calls: string[][] } {
  const calls: string[][] = [];
  const run: GitRunner = async (_cwd, args) => {
    calls.push(args);
    const key = args[0];
    return map[key] ?? { stdout: '', stderr: 'no stub', exitCode: 1 };
  };
  return { run, calls };
}

const sameRepoTarget: PullRequestCheckoutTarget = {
  number: 12,
  baseRefName: 'main',
  headRefName: 'feat/rl',
  headOwnerLogin: 'alice',
  headRepositorySshUrl: null,
  isCrossRepository: false,
};

const forkTarget: PullRequestCheckoutTarget = {
  number: 7,
  baseRefName: 'main',
  headRefName: 'patch-1',
  headOwnerLogin: 'contributor',
  headRepositorySshUrl: 'git@github.com:contributor/repo.git',
  isCrossRepository: true,
};

describe('checkoutPullRequest', () => {
  it('checks a same-repo PR out onto its real head branch name', async () => {
    const { run, calls } = makeGitRunner({
      fetch: { stdout: 'fetched', stderr: '', exitCode: 0 },
      checkout: { stdout: 'Switched', stderr: '', exitCode: 0 },
    });
    const res = await checkoutPullRequest('/tmp/x', sameRepoTarget, run);
    expect(res.success).toBe(true);
    expect(res.localBranch).toBe('feat/rl');
    expect(calls[0]).toEqual(['fetch', 'origin', '+refs/pull/12/head:feat/rl']);
    expect(calls[1]).toEqual(['checkout', 'feat/rl']);
  });

  it('checks a fork PR out onto a synthetic pr/<n> branch', async () => {
    const { run, calls } = makeGitRunner({
      fetch: { stdout: '', stderr: '', exitCode: 0 },
      checkout: { stdout: '', stderr: '', exitCode: 0 },
    });
    const res = await checkoutPullRequest('/tmp/x', forkTarget, run);
    expect(res.localBranch).toBe('pr/7');
    expect(calls[0]).toEqual(['fetch', 'origin', '+refs/pull/7/head:pr/7']);
  });

  it('throws with git stderr when the fetch fails', async () => {
    const { run } = makeGitRunner({
      fetch: { stdout: '', stderr: 'couldn\'t find remote ref', exitCode: 1 },
    });
    await expect(checkoutPullRequest('/tmp/x', sameRepoTarget, run)).rejects.toThrow('remote ref');
  });
});

// ── GitLab (glab) ──
function makeGlabRunner(map: Record<string, GlabResult>): GlabRunner {
  return async (args) => map[args.slice(0, 2).join(' ')] ?? { stdout: '', stderr: 'no stub', exitCode: 1 };
}

describe('GitLabForgeService', () => {
  it('maps glab mr list JSON onto neutral PullRequestSummary (iid->number, source->head)', async () => {
    const runner = makeGlabRunner({
      'mr list': {
        stdout: JSON.stringify([
          {
            iid: 5,
            title: 'Fix pipeline',
            web_url: 'https://gitlab.com/o/r/-/merge_requests/5',
            state: 'opened',
            description: 'd',
            target_branch: 'main',
            source_branch: 'fix',
            labels: ['bug', { name: 'ci' }],
            updated_at: '2026-09-26T00:00:00Z',
            author: { username: 'bob' },
            draft: true,
          },
        ]),
        stderr: '',
        exitCode: 0,
      },
    });
    const svc = new GitLabForgeService(runner);
    const prs = await svc.listPullRequests(repo);
    expect(prs[0]).toMatchObject({
      number: 5,
      state: 'opened',
      baseRefName: 'main',
      headRefName: 'fix',
      labels: ['bug', 'ci'],
      authorLogin: 'bob',
      isDraft: true,
    });
  });

  it('detects a fork MR via differing source/target project ids', async () => {
    const runner = makeGlabRunner({
      'mr view': {
        stdout: JSON.stringify({
          iid: 9,
          target_branch: 'main',
          source_branch: 'feature',
          source_project_id: 22,
          target_project_id: 11,
          author: { username: 'carol' },
          source_project: { ssh_url_to_repo: 'git@gitlab.com:carol/r.git' },
        }),
        stderr: '',
        exitCode: 0,
      },
    });
    const svc = new GitLabForgeService(runner);
    const t = await svc.getCheckoutTarget(repo, 9);
    expect(t.isCrossRepository).toBe(true);
    expect(t.headRepositorySshUrl).toBe('git@gitlab.com:carol/r.git');
  });
});

describe('gitlabAdapter', () => {
  it('matches gitlab.com and probes it true', async () => {
    const adapter = gitlabAdapter(async () => ({ stdout: '', stderr: '', exitCode: 0 }));
    expect(adapter.matchesHost?.('gitlab.com')).toBe(true);
    expect(adapter.matchesHost?.('github.com')).toBe(false);
    expect(await adapter.probeHost?.('gitlab.com')).toBe(true);
  });
});

// ── Gitea (tea) ──
function makeTeaRunner(map: Record<string, TeaResult>): TeaRunner {
  return async (args) => map[args.slice(0, 2).join(' ')] ?? { stdout: '', stderr: 'no stub', exitCode: 1 };
}

describe('GiteaForgeService', () => {
  it('maps tea pulls list JSON onto neutral PullRequestSummary (index->number)', async () => {
    const runner = makeTeaRunner({
      'pulls list': {
        stdout: JSON.stringify([
          {
            index: 3,
            title: 'Add feature',
            html_url: 'https://gitea.example.com/o/r/pulls/3',
            state: 'open',
            body: 'b',
            base: { ref: 'main' },
            head: { ref: 'feat', repo: { full_name: 'o/r' } },
            labels: [{ name: 'enhancement' }],
            updated_at: '2026-09-26T00:00:00Z',
            user: { login: 'dave' },
          },
        ]),
        stderr: '',
        exitCode: 0,
      },
    });
    const svc = new GiteaForgeService(runner);
    const prs = await svc.listPullRequests(repo);
    expect(prs[0]).toMatchObject({
      number: 3,
      state: 'open',
      baseRefName: 'main',
      headRefName: 'feat',
      labels: ['enhancement'],
      authorLogin: 'dave',
    });
  });

  it('flags a fork when the head repo full_name differs from the base slug', async () => {
    const runner = makeTeaRunner({
      'pulls --repo': {
        stdout: JSON.stringify({
          index: 4,
          base: { ref: 'main' },
          head: { ref: 'patch', repo: { full_name: 'fork/r', ssh_url: 'git@gitea:fork/r.git' } },
          user: { login: 'erin' },
        }),
        stderr: '',
        exitCode: 0,
      },
    });
    const svc = new GiteaForgeService(runner);
    const t = await svc.getCheckoutTarget(repo, 4);
    expect(t.isCrossRepository).toBe(true);
    expect(t.headRepositorySshUrl).toBe('git@gitea:fork/r.git');
  });
});

// ── default registry resolves each forge by host ──
describe('createDefaultForgeRegistry host resolution', () => {
  it('resolves github.com to github and gitlab.com to gitlab synchronously', async () => {
    const r = createDefaultForgeRegistry();
    expect(await r.resolveHost('github.com')).toBe('github');
    expect(await r.resolveHost('gitlab.com')).toBe('gitlab');
  });
});
