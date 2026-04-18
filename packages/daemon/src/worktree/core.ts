import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const execFileAsync = promisify(execFile);

export interface WorktreeInfo {
  id: string;
  basePath: string;
  branch: string;
  path: string;
  status: 'active' | 'archived';
  createdAt: string;
}

const WORKTREES_DIR = 'worktrees';

function getFlowwhipsHome(): string {
  return process.env.FLOWWHIPS_HOME ?? `${process.env.HOME ?? '~'}/.flowwhips`;
}

async function getIndexDir(): Promise<string> {
  const dir = join(getFlowwhipsHome(), WORKTREES_DIR);
  await mkdir(dir, { recursive: true });
  return dir;
}

async function loadIndex(): Promise<WorktreeInfo[]> {
  try {
    const data = await readFile(join(await getIndexDir(), 'index.json'), 'utf-8');
    return JSON.parse(data) as WorktreeInfo[];
  } catch {
    return [];
  }
}

async function saveIndex(worktrees: WorktreeInfo[]): Promise<void> {
  const dir = await getIndexDir();
  await writeFile(join(dir, 'index.json'), JSON.stringify(worktrees, null, 2));
}

export async function listWorktrees(status?: 'active' | 'archived'): Promise<WorktreeInfo[]> {
  const all = await loadIndex();
  return status ? all.filter((w) => w.status === status) : all;
}

export async function createWorktree(basePath: string, branch: string): Promise<WorktreeInfo> {
  const safeBranch = branch.replace(/[^a-zA-Z0-9-_/.]/g, '-');
  const worktreePath = `${basePath}-worktree-${safeBranch}`;

  await execFileAsync('git', ['worktree', 'add', worktreePath, '-b', branch], {
    cwd: basePath,
  });

  const wt: WorktreeInfo = {
    id: randomUUID(),
    basePath,
    branch,
    path: worktreePath,
    status: 'active',
    createdAt: new Date().toISOString(),
  };

  const worktrees = await loadIndex();
  worktrees.push(wt);
  await saveIndex(worktrees);

  return wt;
}

export async function archiveWorktree(worktreePath: string): Promise<WorktreeInfo | null> {
  const worktrees = await loadIndex();
  const wt = worktrees.find((w) => w.path === worktreePath && w.status === 'active');
  if (!wt) return null;

  await execFileAsync('git', ['worktree', 'remove', worktreePath], {
    cwd: wt.basePath,
  });

  wt.status = 'archived';
  await saveIndex(worktrees);
  return wt;
}

export async function getWorktree(id: string): Promise<WorktreeInfo | undefined> {
  const worktrees = await loadIndex();
  return worktrees.find((w) => w.id === id);
}
