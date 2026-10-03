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
    const types = ['claude-code', 'codex', 'opencode'] as const;
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
    // Kiro/Antigravity/Pi are PTY-only — the kiro ACP path died with the
    // CLI's `acp` subcommand removal.
    expect(createSdkAdapter('kiro')).toBeNull();
    expect(createSdkAdapter('kiro-cli')).toBeNull();
    expect(createSdkAdapter('kiro-cli-acp')).toBeNull();
    expect(createSdkAdapter('antigravity')).toBeNull();
    expect(createSdkAdapter('pi')).toBeNull();
  });
});

describe('session resume argv', () => {
  it('kiro passes exact resume-id, falls back to -r', async () => {
    const { KiroAdapter } = await import('../agent/kiro.js');
    const adapter = new KiroAdapter();
    const exact = adapter.buildSpawnConfig({
      type: 'kiro',
      projectPath: '/tmp',
      resume: { providerSessionId: 'abc123' },
    });
    expect(exact.args).toContain('--resume-id');
    expect(exact.args[exact.args.indexOf('--resume-id') + 1]).toBe('abc123');
    const latest = adapter.buildSpawnConfig({
      type: 'kiro',
      projectPath: '/tmp',
      resume: {},
    });
    expect(latest.args).toContain('-r');
  });

  it('antigravity uses --conversation / -c; pi uses --session / -c', async () => {
    const { AntigravityAdapter } = await import('../agent/antigravity.js');
    const { PiAdapter } = await import('../agent/pi.js');
    const agy = new AntigravityAdapter().buildSpawnConfig({
      type: 'antigravity',
      projectPath: '/tmp',
      resume: { providerSessionId: 'u-1' },
    });
    expect(agy.args).toEqual(['--conversation', 'u-1']);
    const pi = new PiAdapter().buildSpawnConfig({
      type: 'pi',
      projectPath: '/tmp',
      resume: { providerSessionId: 's-9' },
    });
    expect(pi.args).toEqual(['--session', 's-9']);
    const piLatest = new PiAdapter().buildSpawnConfig({
      type: 'pi',
      projectPath: '/tmp',
      resume: {},
    });
    expect(piLatest.args).toEqual(['-c']);
  });

  it('claude uses --resume / -c; codex uses resume subcommand', async () => {
    const { ClaudeCodeAdapter } = await import('../agent/claude-code.js');
    const { CodexAdapter } = await import('../agent/codex.js');
    const claude = new ClaudeCodeAdapter().buildSpawnConfig({
      type: 'claude-code',
      projectPath: '/tmp',
      resume: { providerSessionId: 'sid' },
    });
    expect(claude.args.slice(0, 2)).toEqual(['--resume', 'sid']);
    const codex = new CodexAdapter().buildSpawnConfig({
      type: 'codex',
      projectPath: '/tmp',
      resume: {},
    });
    expect(codex.args[0]).toBe('resume');
    const codexPlain = new CodexAdapter().buildSpawnConfig({ type: 'codex', projectPath: '/tmp' });
    expect(codexPlain.args).toEqual([]);
  });

  it('extracts provider session ids from cleaned output', async () => {
    const { AntigravityAdapter } = await import('../agent/antigravity.js');
    const agy = new AntigravityAdapter();
    expect(
      agy.extractSessionId('Conversation 3f2504e0-4f89-11d3-9a0c-0305e82c3301 started'),
    ).toBe('3f2504e0-4f89-11d3-9a0c-0305e82c3301');
    expect(agy.extractSessionId('no ids here')).toBeNull();
  });
});

describe('KiroAdapter (unified entry)', () => {
  it('spawns kiro-cli chat with tools pre-approved for remote use', async () => {
    const { KiroAdapter } = await import('../agent/kiro.js');
    const adapter = new KiroAdapter();
    expect(adapter.agentType).toBe('kiro');
    const config = adapter.buildSpawnConfig({
      type: 'kiro',
      projectPath: '/tmp/proj',
      args: ['--model', 'sonnet'],
    });
    expect(config.command).toBe('kiro-cli');
    expect(config.args).toEqual(['chat', '--trust-all-tools', '--model', 'sonnet']);
    expect(config.cwd).toBe('/tmp/proj');
  });

  it('legacy kiro types route to the unified adapter', async () => {
    const { createAdapter, KiroAdapter } = await import('../agent/index.js');
    expect(createAdapter('kiro')).toBeInstanceOf(KiroAdapter);
    expect(createAdapter('kiro-cli')).toBeInstanceOf(KiroAdapter);
    expect(createAdapter('kiro-cli-acp')).toBeInstanceOf(KiroAdapter);
  });

  it('parses kiro chat markers', async () => {
    const { KiroAdapter } = await import('../agent/kiro.js');
    const adapter = new KiroAdapter();
    expect(
      adapter.parseOutput('Allow this action? [y/n/t]').some((e) => e.type === 'status_change'),
    ).toBe(true);
    expect(adapter.parseOutput('▸ Credits: 0.24 • Time: 3s').some((e) => e.type === 'status_change')).toBe(true);
    expect(adapter.parseOutput('read src/main.ts').some((e) => e.type === 'file_change')).toBe(true);
  });
});

describe('AntigravityAdapter', () => {
  it('spawns the agy binary with passthrough args', async () => {
    const { AntigravityAdapter } = await import('../agent/antigravity.js');
    const adapter = new AntigravityAdapter();
    expect(adapter.agentType).toBe('antigravity');
    const config = adapter.buildSpawnConfig({
      type: 'antigravity',
      projectPath: '/tmp/proj',
      args: ['--effort', 'high'],
    });
    expect(config.command).toBe('agy');
    expect(config.args).toEqual(['--effort', 'high']);
    expect(config.cwd).toBe('/tmp/proj');
  });

  it('parses thinking and shell output', async () => {
    const { AntigravityAdapter } = await import('../agent/antigravity.js');
    const adapter = new AntigravityAdapter();
    expect(adapter.parseOutput('Reasoning about the task').some((e) => e.type === 'thinking')).toBe(true);
    expect(adapter.parseOutput('Running command: npm test').some((e) => e.type === 'command_exec')).toBe(true);
    expect(adapter.parseOutput('something happened').some((e) => e.type === 'raw_output')).toBe(true);
  });
});

describe('PiAdapter', () => {
  it('spawns the pi binary with passthrough args', async () => {
    const { PiAdapter } = await import('../agent/pi.js');
    const adapter = new PiAdapter();
    expect(adapter.agentType).toBe('pi');
    const config = adapter.buildSpawnConfig({
      type: 'pi',
      projectPath: '/tmp/proj',
      args: ['--provider', 'anthropic'],
    });
    expect(config.command).toBe('pi');
    expect(config.args).toEqual(['--provider', 'anthropic']);
    expect(config.cwd).toBe('/tmp/proj');
  });

  it('parses tool-call blocks', async () => {
    const { PiAdapter } = await import('../agent/pi.js');
    const adapter = new PiAdapter();
    const events = adapter.parseOutput('› bash(npm install)');
    expect(events.some((e) => e.type === 'tool_use')).toBe(true);
    expect(adapter.parseOutput('edited src/app.ts').some((e) => e.type === 'file_change')).toBe(true);
  });
});
