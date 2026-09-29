import { describe, it, expect, beforeEach, afterAll } from 'bun:test';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadProviderPlugins } from '../plugins/loader.js';
import { AdapterRegistry } from '../agent/adapter-registry.js';

let root: string;
let registry: AdapterRegistry;

async function makePlugin(
  dir: string,
  name: string,
  manifest: object | string,
  entry?: string,
): Promise<void> {
  await mkdir(join(dir, name), { recursive: true });
  const raw = typeof manifest === 'string' ? manifest : JSON.stringify(manifest);
  await writeFile(join(dir, name, 'plugin.json'), raw);
  if (entry !== undefined) {
    await writeFile(join(dir, name, 'index.js'), entry);
  }
}

// A real compiled-JS adapter the loader can import (mirrors what a third
// party would drop in).
const ENTRY_JS = `export default class EchoAdapter {
  constructor() { this.brand = 'echo'; }
}
`;

describe('loadProviderPlugins', () => {
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'baton-plugins-'));
    // Isolated registry per test — loaded types never leak across suites
    // or into the daemon's real singleton.
    registry = new AdapterRegistry();
    registry.register('claude-code', class {} as never);
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('loads a valid provider plugin', async () => {
    await makePlugin(
      root,
      'echo',
      { name: 'echo', kind: 'provider', type: 'echo-test-1', entry: 'index.js', version: '1.0.0' },
      ENTRY_JS,
    );
    const res = await loadProviderPlugins(root, registry);
    expect(res.loaded).toHaveLength(1);
    expect(res.loaded[0]).toMatchObject({ name: 'echo', type: 'echo-test-1' });
    expect(registry.has('echo-test-1')).toBe(true);
    const inst = registry.create('echo-test-1') as unknown as { brand: string };
    expect(inst.brand).toBe('echo');
  });

  it('skips an invalid manifest (bad kind)', async () => {
    await makePlugin(root, 'bad-kind', { name: 'bad', kind: 'theme', type: 't', entry: 'index.js' });
    const res = await loadProviderPlugins(root, registry);
    expect(res.loaded).toHaveLength(0);
    expect(res.failed[0].name).toBe('bad-kind');
  });

  it('skips malformed JSON without throwing', async () => {
    await makePlugin(root, 'broken', '{not json', ENTRY_JS);
    const res = await loadProviderPlugins(root, registry);
    expect(res.loaded).toHaveLength(0);
    expect(res.failed.some((f) => f.name === 'broken')).toBe(true);
  });

  it('refuses types that collide with a registered adapter', async () => {
    await makePlugin(
      root,
      'collide',
      { name: 'collide', kind: 'provider', type: 'claude-code', entry: 'index.js' },
      ENTRY_JS,
    );
    const res = await loadProviderPlugins(root, registry);
    expect(res.loaded).toHaveLength(0);
    expect(res.failed[0].reason).toContain('already registered');
  });

  it('returns empty for a missing plugins dir', async () => {
    const res = await loadProviderPlugins(join(root, 'does-not-exist'));
    expect(res.loaded).toEqual([]);
    expect(res.failed).toEqual([]);
  });

  it('skips an entry with no default export', async () => {
    await makePlugin(
      root,
      'no-export',
      { name: 'no-export', kind: 'provider', type: 'no-exp-1', entry: 'index.js' },
      'export const notDefault = 1;\n',
    );
    const res = await loadProviderPlugins(root, registry);
    expect(res.loaded).toHaveLength(0);
    expect(res.failed[0].reason).toContain('no default adapter export');
  });

  it('rejects an entry that escapes the plugin directory', async () => {
    // The manifest points outside its own dir — must be refused even though
    // a real module exists at that path.
    await makePlugin(
      root,
      'escape',
      { name: 'escape', kind: 'provider', type: 'escape-1', entry: '../outside/index.js' },
      ENTRY_JS,
    );
    const res = await loadProviderPlugins(root, registry);
    expect(res.loaded).toHaveLength(0);
    expect(res.failed[0].reason).toContain('escapes the plugin directory');
    expect(registry.has('escape-1')).toBe(false);
  });

  it('loads a symlinked plugin directory', async () => {
    await makePlugin(
      root,
      'real-plugin',
      { name: 'linked', kind: 'provider', type: 'linked-1', entry: 'index.js' },
      ENTRY_JS,
    );
    await symlink(join(root, 'real-plugin'), join(root, 'linked-plugin'));
    const res = await loadProviderPlugins(root, registry);
    // Both the real dir and its symlink register the SAME type — second one
    // reports a collision, which proves the symlink was followed.
    const loaded = res.loaded.filter((p) => p.type === 'linked-1');
    expect(loaded).toHaveLength(1);
    expect(res.failed.some((f) => f.reason.includes('already registered'))).toBe(true);
  });
});
