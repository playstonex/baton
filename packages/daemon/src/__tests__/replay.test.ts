import { describe, it, expect } from 'bun:test';
import { ReplaySdkAdapter, REPLAY_MODELS } from '../agent/replay-sdk.js';
import { createSdkAdapter, isSdkMode } from '../agent/index.js';
import type { ParsedEvent } from '@baton/shared';

describe('ReplaySdkAdapter (T3 Code-style Offline Harness)', () => {
  it('exposes replay models', () => {
    expect(REPLAY_MODELS.length).toBeGreaterThan(0);
    expect(REPLAY_MODELS.map((m) => m.id)).toContain('showcase');
    expect(REPLAY_MODELS.map((m) => m.id)).toContain('approval');
    expect(REPLAY_MODELS.map((m) => m.id)).toContain('question');
  });

  it('detects and creates replay adapter correctly', () => {
    const adapter = new ReplaySdkAdapter();
    expect(adapter.detect('/any/path')).toBe(true);
    expect(adapter.isSdkAvailable()).toBe(true);
    expect(isSdkMode('replay')).toBe(true);

    const created = createSdkAdapter('replay');
    expect(created).toBeDefined();
    expect(created?.name).toBe('Replay (dev)');
  });

  it('streams realistic turns without real LLM API calls', async () => {
    const adapter = new ReplaySdkAdapter();
    adapter.selectedModel = 'showcase';
    const events: ParsedEvent[] = [];

    const session = await adapter.startSession(
      {
        type: 'replay',
        projectPath: '/test/workspace',
      },
      (ev) => events.push(ev),
    );

    expect(session.write).toBeDefined();
    expect(session.stop).toBeDefined();

    // Wait for the simulated turn sequence to stream
    for (let i = 0; i < 40; i++) {
      if (events.some((e) => e.type === 'status_change' && e.status === 'idle')) break;
      await new Promise((r) => setTimeout(r, 50));
    }

    // Verify thinking, tool_call, file_change, and assistant messages were emitted
    expect(events.some((e) => e.type === 'thinking')).toBe(true);
    expect(events.some((e) => e.type === 'tool_call_start')).toBe(true);
    expect(events.some((e) => e.type === 'command_exec')).toBe(true);
    expect(events.some((e) => e.type === 'file_change')).toBe(true);
    expect(events.some((e) => e.type === 'chat_message' && e.role === 'assistant')).toBe(true);
    expect(events.some((e) => e.type === 'status_change' && e.status === 'idle')).toBe(true);

    await session.stop();
    expect(events.some((e) => e.type === 'status_change' && e.status === 'stopped')).toBe(true);
  });
});
