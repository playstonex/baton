import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { AgentManager } from '../agent/manager.js';
import { WorkspaceCheckpointService } from '../workspace/checkpoint.js';
import type { ParsedEvent, CheckpointCreatedEvent, ChatMessageEvent } from '@baton/shared';

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

describe('Turn-level Git Checkpoints & Rollback', () => {
  let tempRepo: string;
  let manager: AgentManager;
  let checkpointService: WorkspaceCheckpointService;

  beforeEach(async () => {
    tempRepo = await mkdtemp(join(tmpdir(), 'baton-turn-chk-'));
    checkpointService = new WorkspaceCheckpointService();
    manager = new AgentManager();
    manager.setCheckpointService(checkpointService);

    await runGit(tempRepo, ['init', '-b', 'main']);
    await runGit(tempRepo, ['config', 'user.name', 'Test User']);
    await runGit(tempRepo, ['config', 'user.email', 'test@example.com']);

    await writeFile(join(tempRepo, 'code.ts'), 'export const a = 1;\n');
    await runGit(tempRepo, ['add', 'code.ts']);
    await runGit(tempRepo, ['commit', '-m', 'initial commit']);
  });

  afterEach(async () => {
    await rm(tempRepo, { recursive: true, force: true });
  });

  it('captures an automatic checkpoint when agent turn completes with modified files', async () => {
    const receivedEvents: ParsedEvent[] = [];
    const sessionId = 'test-session-chk-1';

    // Simulate agent process in manager
    const managed: any = {
      process: {
        id: sessionId,
        type: 'claude-code',
        status: 'running',
        projectPath: tempRepo,
        startedAt: new Date().toISOString(),
      },
      state: { status: 'running', at: Date.now(), toolCount: 1 },
      turnIndex: 1,
      eventHistory: [],
      displayHistory: [],
      outputHistory: [],
      timeline: [],
      eventCallbacks: new Set([(ev: ParsedEvent) => receivedEvents.push(ev)]),
      rawCallbacks: new Set(),
      firstOutputReceived: true,
      lastPrompt: 'Add function b',
    };
    (manager as any).agents.set(sessionId, managed);

    // Agent modifies file during turn
    await writeFile(join(tempRepo, 'code.ts'), 'export const a = 1;\nexport const b = 2;\n');

    // Agent completes turn -> transitions to idle
    (manager as any).syncStatus(sessionId, 'idle');

    // Wait for async checkpoint creation
    for (let i = 0; i < 40; i++) {
      if (managed.lastCheckpointId) break;
      await new Promise((r) => setTimeout(r, 50));
    }

    expect(managed.lastCheckpointId).toBeDefined();
    const chkEvent = receivedEvents.find(
      (e): e is CheckpointCreatedEvent => e.type === 'checkpoint_created',
    );
    expect(chkEvent).toBeDefined();
    expect(chkEvent?.checkpointId).toBe(managed.lastCheckpointId);
    expect(chkEvent?.files).toContain('code.ts');
    expect(chkEvent?.turnId).toBe('turn_1');

    // Verify rollback
    await writeFile(join(tempRepo, 'code.ts'), 'export const broken = true;\n');
    await manager.rollbackSession(sessionId, managed.lastCheckpointId);

    const revertedContent = await readFile(join(tempRepo, 'code.ts'), 'utf-8');
    expect(revertedContent).toBe('export const a = 1;\nexport const b = 2;\n');

    const rollbackMsg = receivedEvents.find(
      (e): e is ChatMessageEvent => e.type === 'chat_message' && e.role === 'system',
    );
    expect(rollbackMsg).toBeDefined();
    expect(rollbackMsg?.content).toContain('rolled back to checkpoint');
  });
});
