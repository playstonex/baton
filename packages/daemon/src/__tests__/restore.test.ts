import { describe, it, expect, beforeAll } from 'bun:test';
import { mkdtemp, mkdir, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// AgentManager reads BATON_HOME lazily via a getter, so pointing the env at
// a temp dir before constructing an instance is enough.
let home: string;

function snapshotJson(id: string, at: number): string {
  return JSON.stringify({
    id,
    type: 'claude-code',
    projectPath: '/tmp/proj',
    state: { status: 'stopped', at, exitCode: 0 },
    timeline: [],
    createdAt: new Date(at - 60_000).toISOString(),
    cols: 80,
    rows: 24,
  });
}

describe('AgentManager.restore — history cap + list exclusion', () => {
  let manager: import('../agent/manager.js').AgentManager;

  beforeAll(async () => {
    home = await mkdtemp(join(tmpdir(), 'baton-restore-'));
    process.env.BATON_HOME = home;
    // 105 stopped snapshots (older first) + 1 crashed (non-stopped → forced stopped).
    const agentsDir = join(home, 'agents');
    for (let i = 0; i < 105; i++) {
      const hashDir = join(agentsDir, `h${i % 7}`);
      await mkdir(hashDir, { recursive: true });
      await writeFile(join(hashDir, `cp-old-${i}.json`), snapshotJson(`old-${i}`, 1_000_000 + i));
    }
    await mkdir(join(agentsDir, 'h-crash'), { recursive: true });
    await writeFile(
      join(agentsDir, 'h-crash', 'crashed.json'),
      JSON.stringify({
        id: 'crashed-1',
        type: 'codex',
        projectPath: '/tmp/proj',
        state: { status: 'running', at: 2_000_000 },
        timeline: [{ t: 1 }],
        createdAt: new Date(2_000_000 - 60_000).toISOString(),
        cols: 80,
        rows: 24,
      }),
    );

    const { AgentManager } = await import('../agent/manager.js');
    manager = new AgentManager();
    await manager.restore();
  });

  it('excludes restored dead sessions from list()', () => {
    // All 106 restored agents are stopped → none may appear as "active".
    expect(manager.list()).toEqual([]);
  });

  it('keeps transcripts reachable via get()', () => {
    expect(manager.get('old-104')).toBeDefined();
    expect(manager.get('crashed-1')).toBeDefined();
    expect(manager.get('crashed-1')!.status).toBe('stopped');
  });

  it('prunes snapshot files beyond the 100 cap (newest kept)', async () => {
    const agentsDir = join(home, 'agents');
    let files = 0;
    for (const d of await readdir(agentsDir)) {
      files += (await readdir(join(agentsDir, d))).length;
    }
    // 100 kept + nothing else; oldest 5 + their crashed entry all retained/capped.
    expect(files).toBeLessThanOrEqual(100);
    // The NEWEST old snapshot must survive pruning.
    expect(manager.get('old-104')).toBeDefined();
    // The OLDEST must have been pruned from disk (file gone → get still works
    // from memory, so check the file directly).
    const oldestPath = join(agentsDir, 'h0', 'cp-old-0.json');
    expect(await readdir(join(agentsDir, 'h0')).then((f) => f.includes('cp-old-0.json'))).toBe(false);
    void oldestPath;
  });
});
