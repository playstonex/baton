// Git RPC types for remote git operations from mobile/web clients

export type GitAction =
  | 'git_status'
  | 'git_commit'
  | 'git_push'
  | 'git_pull'
  | 'git_branches'
  | 'git_checkout'
  | 'git_create_branch'
  | 'git_log'
  | 'git_stash'
  | 'git_stash_pop'
  | 'git_remote_url';

export interface GitStatusFile {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked';
  staged: boolean;
}

export interface GitStatusResult {
  branch: string;
  tracking: string | null;
  ahead: number;
  behind: number;
  dirty: boolean;
  files: GitStatusFile[];
}

export interface GitCommitRequest {
  projectPath: string;
  message?: string;
  all?: boolean; // stage all tracked files before committing
}

export interface GitCommitResult {
  hash: string;
  message: string;
  files: number;
}

export interface GitPushResult {
  success: boolean;
  output: string;
}

export interface GitPullResult {
  success: boolean;
  output: string;
  conflict: boolean;
}

export interface GitBranch {
  name: string;
  current: boolean;
  default: boolean;
}

export interface GitBranchesResult {
  branches: GitBranch[];
  current: string;
}

export interface GitCheckoutRequest {
  projectPath: string;
  branch: string;
}

export interface GitCreateBranchRequest {
  projectPath: string;
  branch: string;
  checkout?: boolean; // switch to the new branch after creating
}

export interface GitLogEntry {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  message: string;
}

export interface GitLogResult {
  entries: GitLogEntry[];
}

export interface GitRemoteUrlResult {
  url: string;
  owner: string;
  repo: string;
}
