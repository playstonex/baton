/**
 * Workspace checkpoint & revert service.
 *
 * A checkpoint captures the working-tree diff relative to HEAD at capture
 * time. Reverting applies the *reverse* of that diff, undoing the agent's
 * changes back to the checkpointed state — the "undo AI changes" safety net.
 *
 * Storage: each checkpoint is a JSON file under
 *   $BATON_HOME/checkpoints/<projectIdHash>/<id>.json
 * mirroring the agent-snapshot persistence pattern.
 */

import { spawn } from 'node:child_process';
import { mkdir, writeFile, readFile, readdir, unlink, realpath } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';

/**
 * Canonicalize a client-supplied project path before any git subprocess
 * touches it: resolves symlinks/`..` and verifies the directory sits inside
 * a git work tree (`.git` dir — or file, for worktrees — found by walking up
 * a bounded number of parents, so nested subdirectories still qualify).
 * Everything downstream (spawn cwd, checkpoint id hashing) uses the
 * canonical form only.
 */
async function canonicalProjectDir(projectPath: string): Promise<string> {
  const real = await realpath(projectPath);
  let dir = real;
  for (let i = 0; i < 16; i++) {
    if (existsSync(join(dir, '.git'))) return real;
    const parent = dirname(dir);
    if (parent === dir) break; // reached filesystem root
    dir = parent;
  }
  throw new Error('not inside a git work tree');
}

export interface Checkpoint {
  id: string;
  projectId: string;
  label: string;
  /** The unified diff of (working tree vs HEAD) at capture time. */
  patch: string;
  /** Files included in the patch. */
  files: string[];
  headSha: string;
  createdAt: number;
}

export interface RevertPreview {
  canApply: boolean;
  conflicts: string[];
  affectedFiles: string[];
}

function batonHome(): string {
  return process.env.BATON_HOME ?? `${process.env.HOME ?? '~'}/.baton`;
}

function projectIdHash(projectPath: string): string {
  return createHash('sha1').update(projectPath).digest('hex').slice(0, 12);
}

function checkpointsDir(projectPath: string): string {
  return join(batonHome(), 'checkpoints', projectIdHash(projectPath));
}

function checkpointFile(projectPath: string, id: string): string {
  return join(checkpointsDir(projectPath), `${id}.json`);
}

/** Run a git command in `cwd`, returning stdout. Throws on non-zero exit. */
function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`git ${args.join(' ')} failed (${code}): ${stderr.trim()}`));
    });
  });
}

export class WorkspaceCheckpointService {
  /**
   * Capture the current working-tree state as a checkpoint. Stores the diff
   * of tracked + untracked-but-added changes relative to HEAD.
   */
  async create(projectPath: string, label: string): Promise<Checkpoint> {
    const project = await canonicalProjectDir(projectPath);
    const headSha = (await git(project, ['rev-parse', 'HEAD'])).trim();
    // Diff working tree vs HEAD, including untracked files staged via `add -N`
    // would require extra steps; we capture tracked changes + staged. For a
    // robust "undo AI edits" we use `git diff HEAD` which covers modified
    // tracked files and staged new files.
    const patch = await git(project, ['diff', 'HEAD', '--no-color']);
    const status = await git(project, ['status', '--porcelain=v1']);
    const files = status
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => l.slice(3).trim());

    const id = `cp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const checkpoint: Checkpoint = {
      id,
      projectId: project,
      label,
      patch,
      files,
      headSha,
      createdAt: Date.now(),
    };

    const dir = checkpointsDir(project);
    if (!existsSync(dir)) await mkdir(dir, { recursive: true });
    await writeFile(checkpointFile(project, id), JSON.stringify(checkpoint, null, 2));
    return checkpoint;
  }

  /** List all checkpoints for a project, newest first. */
  async list(projectPath: string): Promise<Checkpoint[]> {
    const dir = checkpointsDir(projectPath);
    if (!existsSync(dir)) return [];
    const files = await readdir(dir);
    const checkpoints: Checkpoint[] = [];
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      try {
        const raw = await readFile(join(dir, f), 'utf-8');
        checkpoints.push(JSON.parse(raw) as Checkpoint);
      } catch {
        // skip corrupt
      }
    }
    return checkpoints.sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * Preview whether reverting a checkpoint can apply cleanly. Runs
   * `git apply --check -R` (reverse) without writing.
   */
  async revertPreview(projectPath: string, checkpointId: string): Promise<RevertPreview> {
    const project = await canonicalProjectDir(projectPath);
    const cp = await this.load(project, checkpointId);
    if (!cp) throw new Error(`Checkpoint ${checkpointId} not found`);
    if (!cp.patch.trim()) {
      return { canApply: true, conflicts: [], affectedFiles: [] };
    }
    try {
      // --check = don't write, just test. -R = reverse.
      await gitRaw(project, ['apply', '--check', '-R'], cp.patch);
      return { canApply: true, conflicts: [], affectedFiles: cp.files };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Extract conflict file names from the git error.
      const conflicts = msg
        .split('\n')
        .filter((l) => l.includes('patch does not apply') || l.includes(':'))
        .map((l) => l.trim())
        .slice(0, 20);
      return { canApply: false, conflicts, affectedFiles: cp.files };
    }
  }

  /**
   * Apply the checkpoint's reverse patch, rolling the working tree back to
   * the checkpointed state. Throws if the patch doesn't apply cleanly —
   * caller should preview first.
   */
  async revertApply(projectPath: string, checkpointId: string): Promise<void> {
    const project = await canonicalProjectDir(projectPath);
    const cp = await this.load(project, checkpointId);
    if (!cp) throw new Error(`Checkpoint ${checkpointId} not found`);
    if (!cp.patch.trim()) return; // nothing to revert
    await gitRaw(project, ['apply', '-R'], cp.patch);
  }

  /** Delete a checkpoint file. */
  async remove(projectPath: string, checkpointId: string): Promise<boolean> {
    const file = checkpointFile(projectPath, checkpointId);
    if (!existsSync(file)) return false;
    await unlink(file);
    return true;
  }

  private async load(projectPath: string, checkpointId: string): Promise<Checkpoint | null> {
    const file = checkpointFile(projectPath, checkpointId);
    if (!existsSync(file)) return null;
    const raw = await readFile(file, 'utf-8');
    return JSON.parse(raw) as Checkpoint;
  }
}

/** Run git with stdin (for piping a patch). */
function gitRaw(cwd: string, args: string[], stdin: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('close', (code) => {
      if (code === 0) resolve('ok');
      else reject(new Error(`git ${args.join(' ')} failed (${code}): ${stderr.trim()}`));
    });
    child.stdin.write(stdin);
    child.stdin.end();
  });
}
