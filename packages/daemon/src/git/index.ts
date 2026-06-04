import type {
  GitStatusResult,
  GitStatusFile,
  GitCommitResult,
  GitPushResult,
  GitPullResult,
  GitBranchesResult,
  GitBranch,
  GitLogResult,
  GitLogEntry,
  GitRemoteUrlResult,
  GitCommitRequest,
  GitCheckoutRequest,
  GitCreateBranchRequest,
  GitDiffResult,
  GitFileDiff,
  GitDiffHunk,
  GitDiffLine,
} from '@baton/shared';

interface GitOutput {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export class GitService {
  private async executeGit(cwd: string, args: string[]): Promise<GitOutput> {
    const proc = Bun.spawn(['git', ...args], {
      cwd,
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
  }

  async status(projectPath: string): Promise<GitStatusResult> {
    const out = await this.executeGit(projectPath, ['status', '--porcelain=v2', '--branch']);

    let branch = '';
    let tracking: string | null = null;
    let ahead = 0;
    let behind = 0;
    const files: GitStatusFile[] = [];

    for (const line of out.stdout.split('\n')) {
      if (!line) continue;

      if (line.startsWith('# branch.head')) {
        branch = line.split(' ').slice(1).join(' ');
      } else if (line.startsWith('# branch.upstream')) {
        tracking = line.split(' ').slice(1).join(' ');
      } else if (line.startsWith('# branch.ab')) {
        const parts = line.split(' ');
        for (const part of parts) {
          if (part.startsWith('+')) ahead = parseInt(part.slice(1), 10);
          if (part.startsWith('-')) behind = parseInt(part.slice(1), 10);
        }
      } else if (line.startsWith('1 ') || line.startsWith('2 ') || line.startsWith('u ')) {
        // Changed files — porcelain v2 format
        const parts = line.split(' ');
        const xy = parts[1] ?? '';
        const filePath = parts.slice(-1)[0] ?? '';
        let status: GitStatusFile['status'] = 'modified';
        let staged = false;

        if (xy[0] !== '.' && xy[0] !== '?') {
          staged = true;
        }

        if (xy.includes('A') || xy[0] === 'A') status = 'added';
        else if (xy.includes('D') || xy[0] === 'D') status = 'deleted';
        else if (xy.includes('R') || xy[0] === 'R') status = 'renamed';

        files.push({ path: filePath, status, staged });
      } else if (line.startsWith('? ')) {
        files.push({
          path: line.slice(2),
          status: 'untracked',
          staged: false,
        });
      }
    }

    return {
      branch: branch || 'HEAD',
      tracking,
      ahead,
      behind,
      dirty: files.length > 0,
      files,
    };
  }

  async commit(req: GitCommitRequest): Promise<GitCommitResult> {
    if (req.all) {
      await this.executeGit(req.projectPath, ['add', '-A']);
    }

    const message = req.message || `chore: update (${new Date().toISOString().slice(0, 16)})`;
    const out = await this.executeGit(req.projectPath, ['commit', '-m', message]);

    if (out.exitCode !== 0) {
      throw new Error(out.stderr || 'Commit failed');
    }

    // Extract hash and file count from output
    const hashMatch = out.stdout.match(/\[[\w-]+([a-f0-9]{7,})/);
    const fileMatch = out.stdout.match(/(\d+) files? changed/);

    return {
      hash: hashMatch?.[1] ?? '',
      message,
      files: fileMatch ? parseInt(fileMatch[1], 10) : 0,
    };
  }

  async push(projectPath: string): Promise<GitPushResult> {
    const out = await this.executeGit(projectPath, ['push']);
    return {
      success: out.exitCode === 0,
      output: out.stdout || out.stderr,
    };
  }

  async pull(projectPath: string): Promise<GitPullResult> {
    const out = await this.executeGit(projectPath, ['pull', '--no-edit']);
    const isConflict = out.stderr.includes('CONFLICT') || out.exitCode !== 0;
    return {
      success: out.exitCode === 0,
      output: out.stdout || out.stderr,
      conflict: isConflict,
    };
  }

  async branches(projectPath: string): Promise<GitBranchesResult> {
    const out = await this.executeGit(projectPath, ['branch', '-a', '--no-color']);
    if (out.exitCode !== 0) {
      throw new Error(out.stderr || 'Failed to list branches');
    }

    // Get default branch from remote
    let defaultBranch = 'main';
    try {
      const remoteOut = await this.executeGit(projectPath, ['symbolic-ref', 'refs/remotes/origin/HEAD']);
      if (remoteOut.exitCode === 0) {
        defaultBranch = remoteOut.stdout.split('/').pop() ?? 'main';
      }
    } catch {
      // fallback to 'main'
    }

    const branches: GitBranch[] = [];
    let current = '';

    for (const line of out.stdout.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      const isCurrent = line.startsWith('*');
      // Remove remotes/origin/ prefix and leading markers
      let name = trimmed.replace(/^\* /, '').replace(/^remotes\/origin\//, '');

      // Skip HEAD reference
      if (name === 'HEAD' || trimmed.startsWith('remotes/origin/HEAD')) continue;
      // Skip duplicate remote branches that match local
      if (trimmed.startsWith('remotes/') && branches.some((b) => b.name === name)) continue;

      if (isCurrent) current = name;

      branches.push({
        name,
        current: isCurrent,
        default: name === defaultBranch,
      });
    }

    return { branches, current };
  }

  async checkout(req: GitCheckoutRequest): Promise<{ success: boolean }> {
    const out = await this.executeGit(req.projectPath, ['checkout', req.branch]);
    if (out.exitCode !== 0) {
      throw new Error(out.stderr || `Failed to checkout ${req.branch}`);
    }
    return { success: true };
  }

  async createBranch(req: GitCreateBranchRequest): Promise<{ success: boolean }> {
    const args = req.checkout !== false ? ['checkout', '-b', req.branch] : ['branch', req.branch];
    const out = await this.executeGit(req.projectPath, args);
    if (out.exitCode !== 0) {
      throw new Error(out.stderr || `Failed to create branch ${req.branch}`);
    }
    return { success: true };
  }

  async log(projectPath: string, count = 25): Promise<GitLogResult> {
    const SEP = '\x1f';
    const out = await this.executeGit(projectPath, [
      'log',
      `--max-count=${count}`,
      `--pretty=format:%H${SEP}%h${SEP}%P${SEP}%an${SEP}%aI${SEP}%s`,
    ]);

    if (out.exitCode !== 0) {
      return { entries: [] };
    }

    const entries: GitLogEntry[] = out.stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [hash, shortHash, parents, author, date, ...messageParts] = line.split(SEP);
        return {
          hash: hash ?? '',
          shortHash: shortHash ?? '',
          parents: parents ? parents.split(' ').filter(Boolean) : [],
          author: author ?? '',
          date: date ?? '',
          message: messageParts.join(SEP),
        };
      });

    return { entries };
  }

  async stash(projectPath: string): Promise<{ success: boolean }> {
    const out = await this.executeGit(projectPath, ['stash', 'push', '-m', `stash-${Date.now()}`]);
    return { success: out.exitCode === 0 || out.stdout.includes('No local changes to save') };
  }

  async stashPop(projectPath: string): Promise<{ success: boolean }> {
    const out = await this.executeGit(projectPath, ['stash', 'pop']);
    return { success: out.exitCode === 0 };
  }

  async remoteUrl(projectPath: string): Promise<GitRemoteUrlResult> {
    const out = await this.executeGit(projectPath, ['remote', 'get-url', 'origin']);
    if (out.exitCode !== 0) {
      throw new Error(out.stderr || 'No remote origin configured');
    }

    const url = out.stdout.trim();
    // Parse owner/repo from https://github.com/owner/repo.git or git@github.com:owner/repo.git
    const match = url.match(/[:/]([^/]+)\/([^/.]+)/);
    return {
      url,
      owner: match?.[1] ?? '',
      repo: match?.[2] ?? '',
    };
  }

  async diff(projectPath: string, file?: string, staged?: boolean): Promise<GitDiffResult> {
    const args = ['diff', '--unified=3', '--no-color'];
    if (staged) args.push('--cached');
    if (file) args.push('--', file);
    const out = await this.executeGit(projectPath, args);
    if (out.exitCode !== 0 || !out.stdout) return { files: [] };
    return { files: parseUnifiedDiff(out.stdout) };
  }

  async commitDiff(projectPath: string, hash: string): Promise<GitDiffResult> {
    const out = await this.executeGit(projectPath, [
      'show',
      '--format=',
      '--unified=3',
      '--no-color',
      hash,
    ]);
    if (out.exitCode !== 0 || !out.stdout) return { files: [] };
    return { files: parseUnifiedDiff(out.stdout) };
  }

  async handleAction(
    action: string,
    projectPath: string,
    payload?: Record<string, unknown>,
  ): Promise<unknown> {
    switch (action) {
      case 'git_status':
        return this.status(projectPath);
      case 'git_commit':
        return this.commit(payload as unknown as GitCommitRequest);
      case 'git_push':
        return this.push(projectPath);
      case 'git_pull':
        return this.pull(projectPath);
      case 'git_branches':
        return this.branches(projectPath);
      case 'git_checkout':
        return this.checkout(payload as unknown as GitCheckoutRequest);
      case 'git_create_branch':
        return this.createBranch(payload as unknown as GitCreateBranchRequest);
      case 'git_log':
        return this.log(projectPath, (payload?.count as number) ?? 25);
      case 'git_stash':
        return this.stash(projectPath);
      case 'git_stash_pop':
        return this.stashPop(projectPath);
      case 'git_remote_url':
        return this.remoteUrl(projectPath);
      case 'git_diff':
        return this.diff(projectPath, payload?.file as string | undefined, payload?.staged as boolean | undefined);
      case 'git_commit_diff':
        return this.commitDiff(projectPath, payload?.hash as string);
      default:
        throw new Error(`Unknown git action: ${action}`);
    }
  }
}

function parseUnifiedDiff(text: string): GitFileDiff[] {
  const files: GitFileDiff[] = [];
  const lines = text.split('\n');
  let i = 0;

  while (i < lines.length) {
    if (!lines[i].startsWith('diff --git')) {
      i++;
      continue;
    }

    const header = lines[i];
    const pathMatch = header.match(/^diff --git a\/(.+) b\/(.+)$/);
    const newPath = pathMatch?.[2] ?? '';
    let oldPath: string | null = null;

    i++;

    let status: GitFileDiff['status'] = 'modified';
    let additions = 0;
    let deletions = 0;

    while (i < lines.length) {
      const line = lines[i];
      if (line.startsWith('@@')) break;
      if (line.startsWith('diff --git')) break;

      if (line.startsWith('new file mode')) status = 'added';
      else if (line.startsWith('deleted file mode')) status = 'deleted';
      else if (line.startsWith('rename from')) {
        status = 'renamed';
        oldPath = line.slice('rename from '.length);
      } else if (line.startsWith('rename to')) {
        oldPath = oldPath ?? newPath;
      }
      i++;
    }

    const hunks: GitDiffHunk[] = [];

    while (i < lines.length && lines[i].startsWith('@@')) {
      const hunkHeader = lines[i];
      const hunkMatch = hunkHeader.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
      let oldLine = parseInt(hunkMatch?.[1] ?? '0', 10);
      let newLine = parseInt(hunkMatch?.[3] ?? '0', 10);
      i++;

      const hunkLines: GitDiffLine[] = [];
      while (i < lines.length) {
        const line = lines[i];
        if (line.startsWith('diff --git') || line.startsWith('@@')) break;
        if (line.startsWith('\\ No newline')) {
          i++;
          continue;
        }

        if (line.startsWith('+')) {
          additions++;
          hunkLines.push({
            type: 'add',
            oldLine: null,
            newLine: newLine++,
            content: line.slice(1),
          });
        } else if (line.startsWith('-')) {
          deletions++;
          hunkLines.push({
            type: 'remove',
            oldLine: oldLine++,
            newLine: null,
            content: line.slice(1),
          });
        } else if (line.startsWith(' ')) {
          hunkLines.push({
            type: 'context',
            oldLine: oldLine++,
            newLine: newLine++,
            content: line.slice(1),
          });
        }
        i++;
      }

      hunks.push({ header: hunkHeader, lines: hunkLines });
    }

    files.push({
      path: newPath,
      oldPath,
      status,
      additions,
      deletions,
      hunks,
    });
  }

  return files;
}
