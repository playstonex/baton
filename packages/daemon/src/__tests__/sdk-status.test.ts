import { describe, it, expect, beforeAll } from 'bun:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentConfig, ParsedEvent, SdkAgentAdapter, AgentStatus } from '@baton/shared';

/**
 * Regression tests for SDK session status lifecycle.
 *
 * The daemon used to keep every SDK session's canonical status at 'running'
 * forever: adapter status_change events were forwarded to clients but never
 * mirrored into the AgentProcess, and stop() aborted the session without
 * ever transitioning it to 'stopped'. Dashboards then showed piles of
 * identical "Running" rows for sessions that were idle or long dead.
 */

class FakeSdkAdapter implements SdkAgentAdapter {
  readonly name = 'Fake SDK';
  readonly agentType = 'claude-code' as const;

  private emit: ((e: ParsedEvent) => void) | null = null;
  stopCalled = false;

  isSdkAvailable(): boolean {
    return true;
  }

  detect(): boolean {
    return true;
  }

  buildSpawnConfig(config: AgentConfig) {
    return { command: 'fake', args: [], cwd: config.projectPath, env: {} };
  }

  parseOutput(): ParsedEvent[] {
    return [];
  }

  async startSession(_config: AgentConfig, onEvent: (e: ParsedEvent) => void) {
    this.emit = onEvent;
    onEvent({ type: 'status_change', status: 'running', timestamp: Date.now() });
    return {
      write: () => {},
      stop: async () => {
        this.stopCalled = true;
      },
    };
  }

  /** Simulate the backend reporting a new status mid-session. */
  send(status: AgentStatus): void {
    this.emit?.({ type: 'status_change', status, timestamp: Date.now() });
  }
}

describe('AgentManager SDK status lifecycle', () => {
  let Manager: typeof import('../agent/manager.js').AgentManager;

  beforeAll(async () => {
    process.env.BATON_HOME = await mkdtemp(join(tmpdir(), 'baton-sdk-status-'));
    ({ AgentManager: Manager } = await import('../agent/manager.js'));
  });

  it('mirrors adapter status changes into the canonical process status', async () => {
    const adapter = new FakeSdkAdapter();
    const manager = new Manager();
    const id = await manager.startSdk(
      { type: 'claude-code', projectPath: '/tmp/proj' },
      adapter,
    );

    expect(manager.get(id)?.status).toBe('running');
    expect(manager.get(id)?.mode).toBe('sdk');

    adapter.send('idle');
    expect(manager.get(id)?.status).toBe('idle');
    expect(manager.list().find((a) => a.id === id)?.status).toBe('idle');

    adapter.send('thinking');
    expect(manager.get(id)?.status).toBe('thinking');

    adapter.send('idle');
    expect(manager.get(id)?.status).toBe('idle');
  });

  it('lets a late adapter event flip an idle session back to running', async () => {
    const adapter = new FakeSdkAdapter();
    const manager = new Manager();
    const id = await manager.startSdk(
      { type: 'claude-code', projectPath: '/tmp/proj' },
      adapter,
    );

    adapter.send('idle');
    adapter.send('running');
    expect(manager.get(id)?.status).toBe('running');
  });

  it('never resurrects a stopped session from adapter events', async () => {
    const adapter = new FakeSdkAdapter();
    const manager = new Manager();
    const id = await manager.startSdk(
      { type: 'claude-code', projectPath: '/tmp/proj' },
      adapter,
    );

    adapter.send('stopped');
    expect(manager.get(id)?.status).toBe('stopped');

    adapter.send('running');
    adapter.send('thinking');
    expect(manager.get(id)?.status).toBe('stopped');
  });

  it('rejects input to an adapter-declared dead session', async () => {
    const adapter = new FakeSdkAdapter();
    const manager = new Manager();
    const id = await manager.startSdk(
      { type: 'claude-code', projectPath: '/tmp/proj' },
      adapter,
    );

    adapter.send('stopped');
    expect(() => manager.chatWrite(id, 'hello')).toThrow();
  });

  it('stop() transitions an SDK session to stopped instead of leaving it running', async () => {
    const adapter = new FakeSdkAdapter();
    const manager = new Manager();
    const id = await manager.startSdk(
      { type: 'claude-code', projectPath: '/tmp/proj' },
      adapter,
    );

    await manager.stop(id);

    expect(adapter.stopCalled).toBe(true);
    expect(manager.get(id)?.status).toBe('stopped');
    // Stopped sessions drop out of the "active" view immediately.
    expect(manager.list().find((a) => a.id === id)?.status).toBe('stopped');
  });

  it('stop() is idempotent', async () => {
    const adapter = new FakeSdkAdapter();
    const manager = new Manager();
    const id = await manager.startSdk(
      { type: 'claude-code', projectPath: '/tmp/proj' },
      adapter,
    );

    await manager.stop(id);
    await expect(manager.stop(id)).resolves.toBeUndefined();
  });
});
