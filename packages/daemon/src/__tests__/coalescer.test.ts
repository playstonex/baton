import { describe, it, expect } from 'bun:test';
import { AgentStreamCoalescer } from '../agent/coalescer.js';
import type { ParsedEvent } from '@baton/shared';

describe('AgentStreamCoalescer', () => {
  it('sends the leading chunk immediately with 0ms latency', () => {
    const flushed: ParsedEvent[] = [];
    const coalescer = new AgentStreamCoalescer({
      windowMs: 60,
      onFlush: (e) => flushed.push(e),
    });

    coalescer.push({ type: 'raw_output', content: 'Hello ', timestamp: 1000 });
    expect(flushed.length).toBe(1);
    expect((flushed[0] as any).content).toBe('Hello ');

    coalescer.destroy();
  });

  it('coalesces trailing chunks within the window and flushes them together', async () => {
    const flushed: ParsedEvent[] = [];
    const coalescer = new AgentStreamCoalescer({
      windowMs: 40,
      onFlush: (e) => flushed.push(e),
    });

    // Chunk 1 (leading) -> sent immediately
    coalescer.push({ type: 'raw_output', content: 'Chunk 1. ', timestamp: 1000 });
    expect(flushed.length).toBe(1);

    // Chunks 2, 3, 4 -> buffered
    coalescer.push({ type: 'raw_output', content: 'Chunk 2. ', timestamp: 1010 });
    coalescer.push({ type: 'raw_output', content: 'Chunk 3. ', timestamp: 1020 });
    coalescer.push({ type: 'raw_output', content: 'Chunk 4.', timestamp: 1030 });
    expect(flushed.length).toBe(1);

    // Wait for the window timer to fire
    await new Promise((r) => setTimeout(r, 60));

    expect(flushed.length).toBe(2);
    expect((flushed[1] as any).content).toBe('Chunk 2. Chunk 3. Chunk 4.');

    coalescer.destroy();
  });

  it('flushes pending text immediately when a non-text event arrives', () => {
    const flushed: ParsedEvent[] = [];
    const coalescer = new AgentStreamCoalescer({
      windowMs: 60,
      onFlush: (e) => flushed.push(e),
    });

    coalescer.push({ type: 'raw_output', content: 'Start ', timestamp: 1000 });
    coalescer.push({ type: 'raw_output', content: 'Middle ', timestamp: 1010 });
    expect(flushed.length).toBe(1);

    // Tool use event arrives -> forces immediate flush of 'Middle ' then emits tool_use
    coalescer.push({
      type: 'tool_use',
      tool: 'Bash',
      args: { command: 'ls' },
      timestamp: 1020,
    });

    expect(flushed.length).toBe(3);
    expect((flushed[1] as any).content).toBe('Middle ');
    expect(flushed[2].type).toBe('tool_use');

    coalescer.destroy();
  });
});
