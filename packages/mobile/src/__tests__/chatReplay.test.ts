import { describe, expect, it } from 'vitest';
import type { ParsedEvent } from '@baton/shared';
import { createChatStore } from '../stores/chat';

function user(content: string, timestamp: number): ParsedEvent {
  return { type: 'chat_message', role: 'user', content, timestamp } as ParsedEvent;
}
function reply(content: string, timestamp: number): ParsedEvent {
  return { type: 'chat_message', role: 'assistant', content, timestamp } as ParsedEvent;
}
const contents = (s: ReturnType<typeof createChatStore>) =>
  s.getState().messages.map((m) => m.content);

describe('full replay', () => {
  it('keeps a failed send the daemon never received, still retryable', () => {
    const s = createChatStore();
    s.getState().applyReplay([user('hi', 1), reply('hello', 2)]);
    s.getState().addUserMessage('lost one', 'mid-1');
    s.getState().resolveDelivery('mid-1', false);

    s.getState().applyReplay([user('hi', 1), reply('hello', 2)]);

    const last = s.getState().messages.at(-1)!;
    expect(contents(s)).toEqual(['hi', 'hello', 'lost one']);
    expect(last.delivery).toBe('failed');
    expect(last.meta?.messageId).toBe('mid-1');
  });

  it('drops a pending send whose echo is in the replay (ack was lost)', () => {
    const s = createChatStore();
    s.getState().addUserMessage('ship it', 'mid-2');
    const sentAt = s.getState().messages[0].timestamp;

    s.getState().applyReplay([user('ship it', sentAt + 5), reply('ok', sentAt + 10)]);

    expect(contents(s)).toEqual(['ship it', 'ok']);
    expect(s.getState().messages.some((m) => m.delivery)).toBe(false);
  });

  it('keeps a pending send with no echo yet', () => {
    const s = createChatStore();
    s.getState().addUserMessage('in flight', 'mid-3');
    s.getState().applyReplay([user('older', 1)]);
    expect(contents(s)).toEqual(['older', 'in flight']);
    expect(s.getState().messages.at(-1)!.delivery).toBe('pending');
  });

  it('keeps the prompt queue and records the paging cursor', () => {
    const s = createChatStore();
    s.getState().enqueuePrompt('next');
    s.getState().applyReplay([user('a', 1)], { beforeSeq: 42, hasMore: true });
    expect(s.getState().promptQueue).toEqual(['next']);
    expect(s.getState().historyCursor).toBe(42);
    expect(s.getState().hasOlderHistory).toBe(true);
  });

  it('treats a replay without a cursor (older daemon) as complete', () => {
    const s = createChatStore();
    s.getState().applyReplay([user('a', 1)]);
    expect(s.getState().hasOlderHistory).toBe(false);
  });
});

describe('load earlier', () => {
  it('prepends older events before everything already shown, live ones included', () => {
    const s = createChatStore();
    s.getState().applyReplay([user('q3', 30), reply('a3', 31)], { beforeSeq: 10, hasMore: true });
    s.getState().setStatus('idle');
    s.getState().addEvent(user('q4', 40)); // arrived live after the replay

    s.getState().prependHistory([user('q1', 10), reply('a1', 11)], {
      beforeSeq: 3,
      hasMore: false,
    });

    expect(contents(s)).toEqual(['q1', 'a1', 'q3', 'a3', 'q4']);
    expect(s.getState().agentStatus).toBe('idle');
    expect(s.getState().historyCursor).toBe(3);
    expect(s.getState().hasOlderHistory).toBe(false);
  });
});

describe('thinking indicator', () => {
  it('stops streaming once the agent replies, before the turn goes idle', () => {
    const s = createChatStore();
    s.getState().addEvent({ type: 'thinking', content: 'hmm', timestamp: 1 } as ParsedEvent);
    expect(s.getState().messages[0].isStreaming).toBe(true);

    s.getState().addEvent(reply('done', 2));

    const thinking = s.getState().messages.find((m) => m.kind === 'thinking')!;
    expect(thinking.isStreaming).toBe(false);
    expect(s.getState().agentStatus).not.toBe('idle');
  });

  it('starts a fresh block for a later thinking phase', () => {
    const s = createChatStore();
    s.getState().addEvent({ type: 'thinking', content: 'a', timestamp: 1 } as ParsedEvent);
    s.getState().addEvent(reply('x', 2));
    s.getState().addEvent({ type: 'thinking', content: 'b', timestamp: 3 } as ParsedEvent);
    const blocks = s.getState().messages.filter((m) => m.kind === 'thinking');
    expect(blocks.map((m) => [m.content, m.isStreaming])).toEqual([
      ['a', false],
      ['b', true],
    ]);
  });
});
