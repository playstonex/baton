import { describe, it, expect } from 'vitest';
import { CodexAdapter } from '../agent/codex.js';
import { OpenCodeAdapter } from '../agent/opencode.js';

describe('CodexAdapter', () => {
  const adapter = new CodexAdapter();

  it('has correct name and type', () => {
    expect(adapter.name).toBe('Codex');
    expect(adapter.agentType).toBe('codex');
  });

  it('builds spawn config', () => {
    const config = adapter.buildSpawnConfig({
      type: 'codex',
      projectPath: '/tmp/test',
      args: ['--model', 'gpt-4'],
    });
    expect(config.command).toBe('codex');
    expect(config.args).toEqual(['--model', 'gpt-4']);
    expect(config.cwd).toBe('/tmp/test');
  });

  it('detects thinking', () => {
    const events = adapter.parseOutput('Thinking about the solution...');
    expect(events.some((e) => e.type === 'thinking')).toBe(true);
  });

  it('detects file creation', () => {
    const events = adapter.parseOutput('Creating src/new-file.ts');
    const fc = events.find((e) => e.type === 'file_change');
    expect(fc).toBeDefined();
    if (fc?.type === 'file_change') {
      expect(fc.changeType).toBe('create');
      expect(fc.path).toContain('src/new-file.ts');
    }
  });

  it('detects command execution', () => {
    const events = adapter.parseOutput('Running: npm test');
    const cmd = events.find((e) => e.type === 'command_exec');
    expect(cmd).toBeDefined();
    if (cmd?.type === 'command_exec') {
      expect(cmd.command).toContain('npm test');
    }
  });

  it('detects errors', () => {
    const events = adapter.parseOutput('Error: compilation failed');
    expect(events.some((e) => e.type === 'error')).toBe(true);
  });
});

describe('OpenCodeAdapter', () => {
  const adapter = new OpenCodeAdapter();

  it('has correct name and type', () => {
    expect(adapter.name).toBe('OpenCode');
    expect(adapter.agentType).toBe('opencode');
  });

  it('detects thinking', () => {
    const events = adapter.parseOutput('Processing input...');
    expect(events.some((e) => e.type === 'thinking')).toBe(true);
  });

  it('detects file changes', () => {
    const events = adapter.parseOutput('read src/main.ts');
    expect(events.some((e) => e.type === 'file_change')).toBe(true);
  });

  it('returns raw_output for unknown output', () => {
    const events = adapter.parseOutput('something happened');
    expect(events.some((e) => e.type === 'raw_output')).toBe(true);
  });
});

describe('createSdkAdapter factory semantics', () => {
  // SDK adapters carry per-session state (child process, sessionId, pending
  // callbacks) — every lookup must hand back a FRESH instance or two
  // concurrent same-type sessions would clobber each other.
  it('returns a fresh instance per call for every SDK-capable type', async () => {
    const { createSdkAdapter } = await import('../agent/index.js');
    const types = ['claude-code', 'codex', 'opencode', 'kiro-cli', 'kiro-cli-acp'] as const;
    for (const t of types) {
      const a = createSdkAdapter(t);
      const b = createSdkAdapter(t);
      expect(a, `${t} should resolve`).not.toBeNull();
      expect(a, `${t} must not share instances between sessions`).not.toBe(b);
    }
  });

  it('returns null for PTY-only types', async () => {
    const { createSdkAdapter } = await import('../agent/index.js');
    expect(createSdkAdapter('acp')).toBeNull(); // acp resolves via its own per-provider factory
  });
});
