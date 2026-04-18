import { z } from 'zod';
import { buildTool, toolResult, toolError, type BuiltTool } from '@flowwhips/shared';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
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

async function listWorktrees(): Promise<WorktreeInfo[]> {
  const home = getFlowwhipsHome();
  const indexFile = join(home, `${WORKTREES_DIR}/index.json`);
  try {
    const data = await readFile(indexFile, 'utf-8');
    return JSON.parse(data) as WorktreeInfo[];
  } catch {
    return [];
  }
}

async function saveWorktreeIndex(worktrees: WorktreeInfo[]): Promise<void> {
  const home = getFlowwhipsHome();
  const dir = join(home, WORKTREES_DIR);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'index.json'), JSON.stringify(worktrees, null, 2));
}

const worktreeCreate = buildTool({
  name: 'worktree_create',
  description: 'Create a git worktree for isolated agent work',
  inputSchema: {
    basePath: z.string().describe('Path to the main repository'),
    branch: z.string().describe('Name for the new branch'),
  },
  isReadOnly: false,
  isConcurrencySafe: false,
  execute: async (params) => {
    const basePath = resolve(params.basePath as string);
    const branch = params.branch as string;
    const worktreePath = `${basePath}-worktree-${branch.replace(/[^a-zA-Z0-9-]/g, '-')}`;

    try {
      await execFileAsync('git', ['worktree', 'add', worktreePath, '-b', branch], {
        cwd: basePath,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return toolError(`Failed to create worktree: ${msg}`);
    }

    const wt: WorktreeInfo = {
      id: randomUUID(),
      basePath,
      branch,
      path: worktreePath,
      status: 'active',
      createdAt: new Date().toISOString(),
    };

    const worktrees = await listWorktrees();
    worktrees.push(wt);
    await saveWorktreeIndex(worktrees);

    return toolResult(JSON.stringify(wt));
  },
});

const worktreeList = buildTool({
  name: 'worktree_list',
  description: 'List all git worktrees',
  inputSchema: {},
  isReadOnly: true,
  isConcurrencySafe: true,
  execute: async () => {
    const worktrees = await listWorktrees();
    return toolResult(JSON.stringify(worktrees.filter((w) => w.status === 'active')));
  },
});

const worktreeArchive = buildTool({
  name: 'worktree_archive',
  description: 'Archive and remove a git worktree',
  inputSchema: {
    path: z.string().describe('Path to the worktree to archive'),
  },
  isReadOnly: false,
  isConcurrencySafe: false,
  execute: async (params) => {
    const worktreePath = resolve(params.path as string);
    const worktrees = await listWorktrees();
    const wt = worktrees.find((w) => w.path === worktreePath && w.status === 'active');

    if (!wt) {
      return toolError('Worktree not found');
    }

    try {
      await execFileAsync('git', ['worktree', 'remove', worktreePath], {
        cwd: wt.basePath,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return toolError(`Failed to remove worktree: ${msg}`);
    }

    wt.status = 'archived';
    await saveWorktreeIndex(worktrees);

    return toolResult(JSON.stringify({ archived: wt.id, branch: wt.branch }));
  },
});

export const worktreeTools: BuiltTool[] = [worktreeCreate, worktreeList, worktreeArchive];
