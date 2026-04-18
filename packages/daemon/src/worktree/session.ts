import type { AgentManager } from '../agent/manager.js';
import { createAdapter } from '../agent/index.js';
import { createWorktree, listWorktrees, archiveWorktree } from './core.js';

export async function startWorktreeSession(
  agentManager: AgentManager,
  basePath: string,
  branch: string,
  agentType: string = 'claude-code',
): Promise<{ sessionId: string; worktreePath: string }> {
  const wt = await createWorktree(basePath, branch);
  const adapter = createAdapter(agentType as 'claude-code' | 'codex' | 'opencode');

  const sessionId = await agentManager.start(
    {
      type: agentType as 'claude-code' | 'codex' | 'opencode',
      projectPath: wt.path,
    },
    adapter,
  );

  return { sessionId, worktreePath: wt.path };
}

export async function stopWorktreeSession(
  worktreePath: string,
): Promise<{ archived: boolean; path: string }> {
  const result = await archiveWorktree(worktreePath);
  return {
    archived: result !== null,
    path: worktreePath,
  };
}

export { listWorktrees };
