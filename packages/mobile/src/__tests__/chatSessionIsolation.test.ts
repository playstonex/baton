import { afterEach, describe, expect, it } from 'vitest';
import type { ParsedEvent } from '@baton/shared';
import { getChatStore, resetChatStores, retainChatStore } from '../stores/chat';

function userMsg(content: string, timestamp: number): ParsedEvent {
  return { type: 'chat_message', role: 'user', content, timestamp } as ParsedEvent;
}

/**
 * Two chat screens can be mounted at once (expo-router keeps the screen under
 * the stack top alive), and a replay for one can arrive while the other is on
 * screen. Each session must only ever see its own transcript.
 */
describe('chat store session isolation', () => {
  afterEach(() => resetChatStores());

  it('keeps interleaved events in their own session', () => {
    const a = getChatStore('A');
    const b = getChatStore('B');
    a.getState().addEvent(userMsg('查看当前状态', 1));
    b.getState().addEvent(userMsg('完成所有修复', 2));
    a.getState().addEvent(userMsg('按你的建议来', 3));

    expect(a.getState().messages.map((m) => m.content)).toEqual(['查看当前状态', '按你的建议来']);
    expect(b.getState().messages.map((m) => m.content)).toEqual(['完成所有修复']);
  });

  it("a late replay for B cannot touch A after A's clear", () => {
    const a = getChatStore('A');
    a.getState().clear();
    getChatStore('B').getState().addEvent(userMsg('late B history', 5));
    expect(a.getState().messages).toHaveLength(0);
  });

  it('status, prompt queue and approvals are per session', () => {
    const a = getChatStore('A');
    const b = getChatStore('B');
    b.getState().setStatus('thinking');
    b.getState().enqueuePrompt('queued for B');
    b.getState().setWaitingApproval(true);

    expect(a.getState().agentStatus).toBe('unknown');
    expect(a.getState().promptQueue).toEqual([]);
    expect(a.getState().waitingApproval).toBe(false);
  });

  it('returns the same store for a session and never evicts a retained one', () => {
    const release = retainChatStore('A');
    const a = getChatStore('A');
    a.getState().addEvent(userMsg('keep me', 1));
    for (let i = 0; i < 10; i++) {
      const r = retainChatStore(`S${i}`);
      getChatStore(`S${i}`);
      r();
    }
    expect(getChatStore('A')).toBe(a);
    expect(a.getState().messages).toHaveLength(1);
    release();
  });
});
