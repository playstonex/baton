import { describe, expect, it } from 'vitest';
import type { ParsedEvent } from '@baton/shared';
import { getChatStore, retainChatStore } from '../stores/chat.js';

const user = (content: string, timestamp: number) =>
  ({ type: 'chat_message', role: 'user', content, timestamp }) as ParsedEvent;

describe('web chat store session isolation', () => {
  it('keeps each session in its own store', () => {
    const a = getChatStore('web-A');
    const b = getChatStore('web-B');
    a.getState().addEvent(user('from A', 1));
    b.getState().addEvent(user('from B', 2));
    b.getState().setStatus('thinking');

    expect(a.getState().messages.map((m) => m.content)).toEqual(['from A']);
    expect(b.getState().messages.map((m) => m.content)).toEqual(['from B']);
    expect(a.getState().agentStatus).toBe('unknown');
  });

  it('never evicts a retained store', () => {
    const release = retainChatStore('web-keep');
    const keep = getChatStore('web-keep');
    for (let i = 0; i < 10; i++) {
      getChatStore(`web-S${i}`);
      retainChatStore(`web-S${i}`)();
    }
    expect(getChatStore('web-keep')).toBe(keep);
    release();
  });
});
