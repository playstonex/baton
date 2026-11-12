/**
 * Workspace checkpoint & revert service.
 *
 * Implements Git plumbing checkpointing (borrowed from T3 Code):
 * Captures atomic snapshots into hidden Git refs (`refs/baton/checkpoints/<id>`)
 * using a temporary isolated `GIT_INDEX_FILE` without dirtying or modifying
 * the user's working copy or staging area.
 *
 * Storage: each checkpoint ref lives inside the project's .git repository,
 * and JSON metadata is mirrored under:
 *   $BATON_HOME/checkpoints/<projectIdHash>/<id>.json
 */

import { spawn } from 'node:child_process';
import { mkdir, writeFile, readFile, readdir, unlink, realpath } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import type { Checkpoint, RevertPreview } from '@baton/shared';

export type { Checkpoint, RevertPreview };

/**
 * Canonicalize a client-supplied project path before any git subprocess
 * touches it: resolves symlinks/`..` and verifies the directory sits inside
 * a git work tree (`.git` dir — or file, for worktrees — found by walking up
 * a bounded number of parents, so nested subdirectories still qualify).
 */
async function canonicalProjectDir(projectPath: string): Promise<string> {
  const real = await realpath(projectPath);
  let dir = real;
  for (let i = 0; i < 16; i++) {
    if (existsSync(join(dir, '.git'))) return real;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('not inside a git work tree');
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

/** Run git with a custom environment (used for GIT_INDEX_FILE isolation). */
function gitWithEnv(cwd: string, args: string[], env: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
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

export class WorkspaceCheckpointService {
  /**
   * Capture the current working-tree state as a checkpoint using Git plumbing:
   * 1. Uses an isolated temporary GIT_INDEX_FILE so user's real staging area is untouched.
   * 2. Reads HEAD tree, adds tracked + untracked modifications.
   * 3. Writes tree, commits object, and updates hidden ref refs/baton/checkpoints/<id>.
   */
  async create(projectPath: string, label: string): Promise<Checkpoint> {
    const project = await canonicalProjectDir(projectPath);
    let headSha = '';
    try {
      headSha = (await git(project, ['rev-parse', 'HEAD'])).trim();
    } catch {
      // Empty repo or unborn HEAD
    }

    const id = `cp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const ref = `refs/baton/checkpoints/${id}`;

    let commitSha = '';
    let gitDir = '';
    try {
      gitDir = (await git(project, ['rev-parse', '--git-dir'])).trim();
    } catch {
      gitDir = join(project, '.git');
    }

    const tempIndex = join(gitDir, `baton-chk-${id}.idx`);
    const commitEnv: NodeJS.ProcessEnv = {
      ...process.env,
      GIT_INDEX_FILE: tempIndex,
      GIT_AUTHOR_NAME: 'Baton Checkpoint',
      GIT_AUTHOR_EMAIL: 'checkpoint@baton.internal',
      GIT_COMMITTER_NAME: 'Baton Checkpoint',
      GIT_COMMITTER_EMAIL: 'checkpoint@baton.internal',
    };

    try {
      if (headSha) {
        await gitWithEnv(project, ['read-tree', 'HEAD'], commitEnv);
      }
      await gitWithEnv(project, ['add', '-A', '--', '.'], commitEnv);
      const treeSha = (await gitWithEnv(project, ['write-tree'], commitEnv)).trim();
      const commitArgs = ['commit-tree', treeSha, '-m', `baton checkpoint ${id}: ${label}`];
      if (headSha) {
        commitArgs.push('-p', headSha);
      }
      commitSha = (await gitWithEnv(project, commitArgs, commitEnv)).trim();
      await git(project, ['update-ref', ref, commitSha]);
    } catch (plumbErr) {
      console.warn(
        `[checkpoint] git plumbing capture failed, falling back to patch diff: ${plumbErr}`,
      );
    } finally {
      if (existsSync(tempIndex)) await unlink(tempIndex).catch(() => {});
      if (existsSync(`${tempIndex}.lock`)) await unlink(`${tempIndex}.lock`).catch(() => {});
    }

    const patch = await git(project, ['diff', 'HEAD', '--no-color']).catch(() => '');
    const status = await git(project, ['status', '--porcelain=v1']).catch(() => '');
    const files = status
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => l.slice(3).trim());

    const checkpoint: Checkpoint = {
      id,
      projectId: project,
      label,
      patch,
      files,
      headSha,
      createdAt: Date.now(),
      commitSha: commitSha || undefined,
      ref: commitSha ? ref : undefined,
    };

    const dir = checkpointsDir(project);
    if (!existsSync(dir)) await mkdir(dir, { recursive: true });
    await writeFile(checkpointFile(project, id), JSON.stringify(checkpoint, null, 2));
    return checkpoint;
  }

  /** Compute unified diff between two checkpoints using Git plumbing. */
  async diff(projectPath: string, fromId: string, toId: string): Promise<string> {
    const project = await canonicalProjectDir(projectPath);
    const fromCp = await this.load(project, fromId);
    const toCp = await this.load(project, toId);
    if (!fromCp) throw new Error(`Checkpoint ${fromId} not found`);
    if (!toCp) throw new Error(`Checkpoint ${toId} not found`);

    const fromTarget = fromCp.ref ?? fromCp.commitSha;
    const toTarget = toCp.ref ?? toCp.commitSha;
    if (fromTarget && toTarget) {
      return await git(project, ['diff', fromTarget, toTarget, '--no-color']);
    }
    return '';
  }

  /** List all checkpoints for a project, newest first. */
  async list(projectPath: string): Promise<Checkpoint[]> {
    const project = await canonicalProjectDir(projectPath).catch(() => projectPath);
    const dir = checkpointsDir(project);
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
   * Preview whether reverting a checkpoint can apply cleanly.
   */
  async revertPreview(projectPath: string, checkpointId: string): Promise<RevertPreview> {
    const project = await canonicalProjectDir(projectPath);
    const cp = await this.load(project, checkpointId);
    if (!cp) throw new Error(`Checkpoint ${checkpointId} not found`);
    if (cp.ref || cp.commitSha) {
      return { canApply: true, conflicts: [], affectedFiles: cp.files };
    }
    if (!cp.patch.trim()) {
      return { canApply: true, conflicts: [], affectedFiles: [] };
    }
    try {
      await gitRaw(project, ['apply', '--check', '-R'], cp.patch);
      return { canApply: true, conflicts: [], affectedFiles: cp.files };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const conflicts = msg
        .split('\n')
        .filter((l) => l.includes('patch does not apply') || l.includes(':'))
        .map((l) => l.trim())
        .slice(0, 20);
      return { canApply: false, conflicts, affectedFiles: cp.files };
    }
  }

  /**
   * Revert working-tree back to the checkpointed state:
   * Uses git checkout <ref> -- . when plumbing ref is available,
   * falling back to reverse-patch apply.
   */
  async revertApply(projectPath: string, checkpointId: string): Promise<void> {
    const project = await canonicalProjectDir(projectPath);
    const cp = await this.load(project, checkpointId);
    if (!cp) throw new Error(`Checkpoint ${checkpointId} not found`);

    if (cp.ref || cp.commitSha) {
      try {
        const target = cp.ref ?? cp.commitSha!;
        await git(project, ['checkout', target, '--', '.']);
        return;
      } catch (err) {
        console.warn(`[checkpoint] git checkout ref failed, falling back to patch: ${err}`);
      }
    }

    if (!cp.patch.trim()) return;
    await gitRaw(project, ['apply', '-R'], cp.patch);
  }

  /** Delete a checkpoint and its underlying git ref. */
  async remove(projectPath: string, checkpointId: string): Promise<boolean> {
    try {
      const project = await canonicalProjectDir(projectPath);
      const cp = await this.load(project, checkpointId);
      if (cp?.ref) {
        await git(project, ['update-ref', '-d', cp.ref]).catch(() => {});
      } else {
        await git(project, ['update-ref', '-d', `refs/baton/checkpoints/${checkpointId}`]).catch(
          () => {},
        );
      }
      const file = checkpointFile(project, checkpointId);
      if (!existsSync(file)) return false;
      await unlink(file);
      return true;
    } catch {
      return false;
    }
  }

  private async load(projectPath: string, checkpointId: string): Promise<Checkpoint | null> {
    const file = checkpointFile(projectPath, checkpointId);
    if (!existsSync(file)) return null;
    const raw = await readFile(file, 'utf-8');
    return JSON.parse(raw) as Checkpoint;
  }
}
