import { apiFetch } from './api';
import type {
  GitStatusResult,
  GitCommitRequest,
  GitCommitResult,
  GitPushResult,
  GitPullResult,
  GitBranchesResult,
  GitCheckoutRequest,
  GitCreateBranchRequest,
  GitLogResult,
  GitRemoteUrlResult,
  GitDiffResult,
} from '@baton/shared';

export const gitService = {
  status(projectPath: string): Promise<GitStatusResult> {
    return apiFetch<GitStatusResult>(`/api/git/status?path=${encodeURIComponent(projectPath)}`);
  },

  commit(req: GitCommitRequest): Promise<GitCommitResult> {
    return apiFetch<GitCommitResult>('/api/git/commit', {
      method: 'POST',
      body: JSON.stringify(req),
    });
  },

  push(projectPath: string): Promise<GitPushResult> {
    return apiFetch<GitPushResult>('/api/git/push', {
      method: 'POST',
      body: JSON.stringify({ projectPath }),
    });
  },

  pull(projectPath: string): Promise<GitPullResult> {
    return apiFetch<GitPullResult>('/api/git/pull', {
      method: 'POST',
      body: JSON.stringify({ projectPath }),
    });
  },

  branches(projectPath: string): Promise<GitBranchesResult> {
    return apiFetch<GitBranchesResult>(`/api/git/branches?path=${encodeURIComponent(projectPath)}`);
  },

  checkout(req: GitCheckoutRequest): Promise<{ success: boolean }> {
    return apiFetch<{ success: boolean }>('/api/git/checkout', {
      method: 'POST',
      body: JSON.stringify(req),
    });
  },

  createBranch(req: GitCreateBranchRequest): Promise<{ success: boolean }> {
    return apiFetch<{ success: boolean }>('/api/git/create-branch', {
      method: 'POST',
      body: JSON.stringify(req),
    });
  },

  log(projectPath: string, count = 25): Promise<GitLogResult> {
    return apiFetch<GitLogResult>(`/api/git/log?path=${encodeURIComponent(projectPath)}&count=${count}`);
  },

  stash(projectPath: string): Promise<{ success: boolean }> {
    return apiFetch<{ success: boolean }>('/api/git/stash', {
      method: 'POST',
      body: JSON.stringify({ projectPath }),
    });
  },

  stashPop(projectPath: string): Promise<{ success: boolean }> {
    return apiFetch<{ success: boolean }>('/api/git/stash-pop', {
      method: 'POST',
      body: JSON.stringify({ projectPath }),
    });
  },

  remoteUrl(projectPath: string): Promise<GitRemoteUrlResult> {
    return apiFetch<GitRemoteUrlResult>(`/api/git/remote-url?path=${encodeURIComponent(projectPath)}`);
  },

  diff(projectPath: string, file?: string, staged?: boolean): Promise<GitDiffResult> {
    let url = `/api/git/diff?path=${encodeURIComponent(projectPath)}`;
    if (file) url += `&file=${encodeURIComponent(file)}`;
    if (staged) url += `&staged=true`;
    return apiFetch<GitDiffResult>(url);
  },

  commitDiff(projectPath: string, hash: string): Promise<GitDiffResult> {
    return apiFetch<GitDiffResult>(
      `/api/git/commit-diff?path=${encodeURIComponent(projectPath)}&hash=${encodeURIComponent(hash)}`,
    );
  },
};
