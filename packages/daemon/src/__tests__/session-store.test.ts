import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ParsedEvent } from '@baton/shared';

let home: string;

function ev(n: number): ParsedEvent {
  return { type: 'raw_output', content: `chunk-${n}`, timestamp: 1_000 + n };
}

describe('SessionStore', () => {
  let store: import('../session/store.js').SessionStore;

  beforeAll(async () => {
    home = await mkdtemp(join(tmpdir(), 'baton-store-'));
    process.env.BATON_HOME = home;
    const { SessionStore } = await import('../session/store.js');
    store = new SessionStore(join(home, 'sessions.db'));
  });

  afterAll(async () => {
    store.close();
    await rm(home, { recursive: true, force: true }).catch(() => {});
  });

  it('upserts and patches session metadata', () => {
    store.upsertSession({
      id: 'sess-1',
      type: 'claude-code',
      projectPath: '/tmp/proj',
      mode: 'sdk',
      status: 'starting',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    store.patchSession('sess-1', { status: 'running', title: 'Fix the parser' });

    const row = store.getSession('sess-1');
    expect(row).not.toBeNull();
    expect(row!.status).toBe('running');
    expect(row!.title).toBe('Fix the parser');
    expect(row!.archived_at).toBeNull();

    // Re-upsert (restart path) must not clobber the title.
    store.upsertSession({
      id: 'sess-1',
      type: 'claude-code',
      projectPath: '/tmp/proj',
      mode: 'sdk',
      status: 'starting',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(store.getSession('sess-1')!.status).toBe('starting');
  });

  it('appends events/output with per-session seq and returns newest-last tails', () => {
    for (let i = 0; i < 30; i++) store.appendEvent('sess-1', ev(i));
    for (let i = 0; i < 10; i++) store.appendOutput('sess-1', `out-${i}\n`);

    const tail = store.getEventTail('sess-1', 5);
    expect(tail.map((e) => (e as { content: string }).content)).toEqual([
      'chunk-25',
      'chunk-26',
      'chunk-27',
      'chunk-28',
      'chunk-29',
    ]);
    expect(store.getOutputTail('sess-1', 3)).toEqual(['out-7\n', 'out-8\n', 'out-9\n']);
    expect(store.getEventCount('sess-1')).toBe(30);
  });

  it('caps oversized payloads instead of storing unbounded rows', () => {
    const huge = 'x'.repeat(200_000);
    store.appendEvent('sess-1', { type: 'raw_output', content: huge, timestamp: 1 });
    const tail = store.getEventTail('sess-1', 1);
    const content = (tail[0] as { content: string }).content;
    expect(content.length).toBeLessThan(200_000);
    expect(content).toContain('[truncated');
  });

  it('lists sessions newest-activity-first with pagination and archive filter', () => {
    for (let i = 2; i <= 5; i++) {
      store.upsertSession({
        id: `sess-${i}`,
        type: 'codex',
        projectPath: '/tmp/proj',
        mode: 'pty',
        status: 'stopped',
        createdAt: new Date(2026, 0, i).toISOString(),
      });
      store.patchSession(`sess-${i}`, {
        updatedAt: new Date(2026, 0, i).toISOString(),
      });
    }
    store.patchSession('sess-5', { archivedAt: '2026-02-01T00:00:00.000Z' });

    const page = store.list({ limit: 2 });
    // sess-5 is archived → hidden by default; newest visible is sess-4.
    expect(page.sessions.map((s) => s.id)).toEqual(['sess-4', 'sess-3']);
    expect(page.total).toBe(4);
    expect(page.hasMore).toBe(true);

    const archived = store.list({ archivedOnly: true });
    expect(archived.sessions.map((s) => s.id)).toEqual(['sess-5']);

    const page2 = store.list({ limit: 2, offset: 2 });
    expect(page2.sessions.map((s) => s.id)).toEqual(['sess-2', 'sess-1']);
    expect(page2.hasMore).toBe(false);
  });

  it('deletes a session with its transcript', () => {
    store.deleteSession('sess-2');
    expect(store.getSession('sess-2')).toBeNull();
    expect(store.getEventCount('sess-2')).toBe(0);
  });

  it('prunes sessions past the retention window', () => {
    const old = 'sess-old';
    store.upsertSession({
      id: old,
      type: 'codex',
      projectPath: '/tmp/x',
      mode: 'pty',
      status: 'stopped',
      createdAt: '2020-01-01T00:00:00.000Z',
    });
    store.patchSession(old, { updatedAt: '2020-01-01T00:00:00.000Z' });
    expect(store.prune()).toContain(old);
    expect(store.getSession(old)).toBeNull();
  });

  it('derives titles from the first prompt line (paseo pattern)', async () => {
    const { deriveTitle } = await import('../session/store.js');
    expect(deriveTitle('  Fix the login bug\n\nIt redirects to /wrong')).toBe('Fix the login bug');
    expect(deriveTitle('\n\n   \nsecond line')).toBe('second line');
    const long = deriveTitle('x'.repeat(100));
    expect(long.length).toBeLessThanOrEqual(61); // 60 incl. ellipsis char
    expect(long.endsWith('…')).toBe(true);
    expect(deriveTitle('')).toBe('New session');
  });

  it('migrates pre-resume databases by adding the new columns', async () => {
    const { Database } = await import('bun:sqlite');
    const legacyPath = join(home, 'legacy.db');
    // Create a DB with the OLD schema (no provider_session_id / resumed_from).
    const legacy = new Database(legacyPath, { create: true });
    legacy.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        project_path TEXT NOT NULL,
        mode TEXT,
        title TEXT,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        stopped_at TEXT,
        archived_at TEXT,
        exit_code INTEGER,
        pid INTEGER
      )
    `);
    legacy
      .prepare(
        `INSERT INTO sessions (id, type, project_path, mode, status, created_at, updated_at)
         VALUES ('legacy-1', 'kiro', '/tmp/p', 'pty', 'stopped', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
      )
      .run();
    legacy.close();

    // Opening with SessionStore must ALTER the missing columns in place and
    // keep the legacy row readable/writable.
    const { SessionStore: MigratingStore } = await import('../session/store.js');
    const migrated = new MigratingStore(legacyPath);
    expect(migrated.getSession('legacy-1')).not.toBeNull();
    migrated.patchSession('legacy-1', {
      providerSessionId: 'prov-42',
      resumedFrom: 'legacy-0',
    });
    const row = migrated.getSession('legacy-1');
    expect(row!.provider_session_id).toBe('prov-42');
    expect(row!.resumed_from).toBe('legacy-0');
    expect(migrated.list().sessions[0].providerSessionId).toBe('prov-42');
    migrated.close();
  });
});

describe('AgentManager ↔ SessionStore integration (no runtime needed)', () => {
  it('lazily resolves dead sessions from the store and manages lifecycle metadata', async () => {
    const { AgentManager } = await import('../agent/manager.js');
    const { SessionStore: Store } = await import('../session/store.js');
    const manager = new AgentManager();

    // Unknown id → undefined, not a throw.
    expect(manager.get('nope')).toBeUndefined();

    // Seed via the manager's own store by creating a session through the
    // documented API surface: use a directly-attached store handle.
    const store = new Store(join(home, 'sessions.db'));
    store.upsertSession({
      id: 'dead-1',
      type: 'claude-code',
      projectPath: '/tmp/proj',
      mode: 'sdk',
      status: 'stopped',
      createdAt: '2026-01-02T00:00:00.000Z',
    });
    store.patchSession('dead-1', {
      title: 'Historic session',
      stoppedAt: '2026-01-03T00:00:00.000Z',
      updatedAt: '2026-01-03T00:00:00.000Z',
    });
    store.appendEvent('dead-1', ev(1));
    store.appendEvent('dead-1', ev(2));
    store.appendOutput('dead-1', 'hello\n');

    // Dead sessions resolve via the store, are excluded from the live list.
    const proc = manager.get('dead-1');
    expect(proc).toBeDefined();
    expect(proc!.title).toBe('Historic session');
    expect(manager.list().map((a) => a.id)).not.toContain('dead-1');

    // History getters fall back to the store (real ParsedEvents, not the old
    // TimelineItem→ParsedEvent type laundering).
    const events = manager.getEventHistory('dead-1');
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe('raw_output');
    expect(manager.getDisplayHistory('dead-1')).toEqual(['hello\n']);

    // listSessions surfaces it with live-status overlay.
    const listing = manager.listSessions();
    const entry = listing.sessions.find((s) => s.id === 'dead-1');
    expect(entry).toBeDefined();
    expect(entry!.title).toBe('Historic session');
    expect(entry!.eventCount).toBe(2);

    // onEvent/onRaw work against store-backed shells (attach path).
    const unsub = manager.onEvent('dead-1', () => {});
    expect(typeof unsub).toBe('function');
    unsub();

    // Archive hides it from the default listing; unarchive restores it.
    await manager.archive('dead-1');
    expect(manager.listSessions().sessions.find((s) => s.id === 'dead-1')).toBeUndefined();
    expect(manager.listSessions({ includeArchived: true }).sessions.find((s) => s.id === 'dead-1')).toBeDefined();
    await manager.unarchive('dead-1');
    expect(manager.listSessions().sessions.find((s) => s.id === 'dead-1')).toBeDefined();

    // Rename flows through to the store.
    manager.setTitle('dead-1', 'Renamed');
    expect(manager.get('dead-1')!.title).toBe('Renamed');
    expect(manager.listSessions().sessions.find((s) => s.id === 'dead-1')!.title).toBe('Renamed');

    // Delete removes it everywhere.
    await manager.delete('dead-1');
    expect(manager.get('dead-1')).toBeUndefined();
    expect(manager.listSessions({ includeArchived: true }).sessions.find((s) => s.id === 'dead-1')).toBeUndefined();
    store.close();
  });
});
