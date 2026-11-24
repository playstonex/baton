import { beforeEach, describe, expect, it } from 'vitest';
import { createChatStore } from '../stores/chat.js';

const useChatStore = createChatStore();

const t = Date.now();
const st = () => useChatStore.getState();

describe('chat store', () => {
  beforeEach(() => st().clear());

  it('closes thinking when the next event arrives and keeps its text', () => {
    st().addEvent({ type: 'thinking', content: 'step 1', timestamp: t });
    st().addEvent({ type: 'thinking', content: ' step 2', timestamp: t });
    expect(st().messages).toHaveLength(1);
    expect(st().messages[0]).toMatchObject({ content: 'step 1 step 2', done: false });
    st().addEvent({ type: 'chat_message', role: 'assistant', content: 'hi', timestamp: t });
    expect(st().messages[0].done).toBe(true);
  });

  it('does not merge assistant replies across a turn end', () => {
    st().addEvent({ type: 'chat_message', role: 'assistant', content: 'a', timestamp: t });
    st().setStatus('running');
    st().setStatus('idle');
    st().addEvent({ type: 'chat_message', role: 'assistant', content: 'b', timestamp: t });
    expect(st().messages.map((m) => m.content)).toEqual(['a', 'b']);
  });

  it('pairs permission responses with requests by id', () => {
    const req = (requestId: string) =>
      ({
        type: 'permission_request',
        requestId,
        tool: 'Bash',
        action: 'Bash',
        description: 'ls',
        timestamp: t,
      }) as const;
    st().addEvent(req('1'));
    st().addEvent(req('2'));
    expect(st().approvalQueue).toHaveLength(2);
    st().addEvent({ type: 'permission_response', requestId: '1', approved: true, timestamp: t });
    expect(st().approvalDetail?.requestId).toBe('2');
  });
});
