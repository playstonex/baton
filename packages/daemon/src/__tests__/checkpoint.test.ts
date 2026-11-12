import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { WorkspaceCheckpointService } from '../workspace/checkpoint.js';

function runGit(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`git ${args.join(' ')} failed (${code}): ${stderr}`));
    });
  });
}

describe('WorkspaceCheckpointService (Git Plumbing)', () => {
  let tempRepo: string;
  let service: WorkspaceCheckpointService;

  beforeEach(async () => {
    tempRepo = await mkdtemp(join(tmpdir(), 'baton-chk-test-'));
    service = new WorkspaceCheckpointService();

    await runGit(tempRepo, ['init', '-b', 'main']);
    await runGit(tempRepo, ['config', 'user.name', 'Test User']);
    await runGit(tempRepo, ['config', 'user.email', 'test@example.com']);

    await writeFile(join(tempRepo, 'file1.txt'), 'version 1\n');
    await runGit(tempRepo, ['add', 'file1.txt']);
    await runGit(tempRepo, ['commit', '-m', 'initial commit']);
  });

  afterEach(async () => {
    await rm(tempRepo, { recursive: true, force: true });
  });

  it('captures atomic checkpoint with git plumbing refs without dirtying index', async () => {
    // Stage something and have unstaged something
    await writeFile(join(tempRepo, 'file1.txt'), 'version 2\n');
    await writeFile(join(tempRepo, 'file2.txt'), 'untracked new file\n');

    const cp = await service.create(tempRepo, 'test checkpoint 1');
    expect(cp.id).toBeDefined();
    expect(cp.label).toBe('test checkpoint 1');
    expect(cp.ref).toMatch(/^refs\/baton\/checkpoints\/cp_/);
    expect(cp.commitSha).toBeDefined();
    expect(cp.files).toContain('file1.txt');
    expect(cp.files).toContain('file2.txt');

    // Verify git ref actually exists in the git database
    const rev = (await runGit(tempRepo, ['rev-parse', cp.ref!])).trim();
    expect(rev).toBe(cp.commitSha!);

    // Verify listing
    const list = await service.list(tempRepo);
    expect(list.length).toBe(1);
    expect(list[0].id).toBe(cp.id);
  });

  it('computes diff between two checkpoints', async () => {
    await writeFile(join(tempRepo, 'file1.txt'), 'step 1 changes\n');
    const cp1 = await service.create(tempRepo, 'step 1');

    await writeFile(join(tempRepo, 'file1.txt'), 'step 2 changes\n');
    const cp2 = await service.create(tempRepo, 'step 2');

    const diff = await service.diff(tempRepo, cp1.id, cp2.id);
    expect(diff).toContain('-step 1 changes');
    expect(diff).toContain('+step 2 changes');
  });

  it('reverts working copy to checkpointed state', async () => {
    await writeFile(join(tempRepo, 'file1.txt'), 'checkpointed content\n');
    const cp = await service.create(tempRepo, 'good state');

    // Mess up the file
    await writeFile(join(tempRepo, 'file1.txt'), 'corrupted changes\n');
    expect(await readFile(join(tempRepo, 'file1.txt'), 'utf-8')).toBe('corrupted changes\n');

    // Revert
    await service.revertApply(tempRepo, cp.id);
    expect(await readFile(join(tempRepo, 'file1.txt'), 'utf-8')).toBe('checkpointed content\n');
  });

  it('removes checkpoint metadata and git ref', async () => {
    await writeFile(join(tempRepo, 'file1.txt'), 'mod\n');
    const cp = await service.create(tempRepo, 'to delete');

    const removed = await service.remove(tempRepo, cp.id);
    expect(removed).toBe(true);

    const list = await service.list(tempRepo);
    expect(list.find((c) => c.id === cp.id)).toBeUndefined();

    // Verify git ref is deleted
    let refExists = true;
    try {
      await runGit(tempRepo, ['rev-parse', cp.ref!]);
    } catch {
      refExists = false;
    }
    expect(refExists).toBe(false);
  });
});
