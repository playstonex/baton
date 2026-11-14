import { describe, it, expect } from 'bun:test';
import { AgentStreamCoalescer } from '../agent/coalescer.js';
import type { ParsedEvent } from '@baton/shared';

/** Text-carrying events share a `content` field; the union does not. */
function textOf(event: ParsedEvent): string | undefined {
  return 'content' in event ? event.content : undefined;
}

function roleOf(event: ParsedEvent): string | undefined {
  return 'role' in event ? event.role : undefined;
}

describe('AgentStreamCoalescer', () => {
  it('sends the leading chunk immediately with 0ms latency', () => {
    const flushed: ParsedEvent[] = [];
    const coalescer = new AgentStreamCoalescer({
      windowMs: 60,
      onFlush: (e) => flushed.push(e),
    });

    coalescer.push({ type: 'raw_output', content: 'Hello ', timestamp: 1000 });
    expect(flushed.length).toBe(1);
    expect(textOf(flushed[0])).toBe('Hello ');

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
    expect(textOf(flushed[1])).toBe('Chunk 2. Chunk 3. Chunk 4.');

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
    expect(textOf(flushed[1])).toBe('Middle ');
    expect(flushed[2].type).toBe('tool_use');

    coalescer.destroy();
  });

  /**
   * Streaming providers size assistant chunks arbitrarily — an ACP
   * agent_message_chunk routinely carries one or two characters, so a reply
   * reached clients as hundreds of events.
   */
  it('coalesces assistant chat_message micro-chunks', async () => {
    const flushed: ParsedEvent[] = [];
    const coalescer = new AgentStreamCoalescer({
      windowMs: 40,
      onFlush: (e) => flushed.push(e),
    });

    const fragments = ['个主', '题提交，或', '者先', '更新 009', ' 文档状态和'];
    for (const [i, content] of fragments.entries()) {
      coalescer.push({ type: 'chat_message', role: 'assistant', content, timestamp: 1000 + i });
    }
    // Only the leading fragment went out immediately.
    expect(flushed.length).toBe(1);

    await new Promise((r) => setTimeout(r, 60));

    expect(flushed.length).toBe(2);
    expect(flushed[1].type).toBe('chat_message');
    expect(roleOf(flushed[1])).toBe('assistant');
    expect(textOf(flushed[1])).toBe('题提交，或者先更新 009 文档状态和');

    coalescer.destroy();
  });

  it('never merges user or system chat_message utterances', async () => {
    const flushed: ParsedEvent[] = [];
    const coalescer = new AgentStreamCoalescer({
      windowMs: 40,
      onFlush: (e) => flushed.push(e),
    });

    coalescer.push({ type: 'chat_message', role: 'user', content: 'first', timestamp: 1000 });
    coalescer.push({ type: 'chat_message', role: 'user', content: 'second', timestamp: 1010 });
    coalescer.push({ type: 'chat_message', role: 'system', content: 'note', timestamp: 1020 });

    await new Promise((r) => setTimeout(r, 60));

    expect(flushed.map((e) => textOf(e))).toEqual(['first', 'second', 'note']);

    coalescer.destroy();
  });

  /**
   * Regression: chat_message used to take the "any other event" path, so an
   * adapter emitting chat_message and raw_output per chunk flushed the buffer
   * on every single chunk — the coalescer was fully defeated.
   */
  it('keeps coalescing when assistant text types interleave', async () => {
    const flushed: ParsedEvent[] = [];
    const coalescer = new AgentStreamCoalescer({
      windowMs: 40,
      onFlush: (e) => flushed.push(e),
    });

    for (let i = 0; i < 10; i++) {
      coalescer.push({ type: 'raw_output', content: `r${i}`, timestamp: 1000 + i });
    }
    await new Promise((r) => setTimeout(r, 60));

    // One leading event plus one coalesced batch — not ten.
    expect(flushed.length).toBe(2);
    expect(textOf(flushed[1])).toBe('r1r2r3r4r5r6r7r8r9');

    coalescer.destroy();
  });
});
