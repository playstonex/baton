import { beforeEach, describe, expect, it } from 'vitest';
import type { ParsedEvent } from '@baton/shared';
import { useChatStore } from '../stores/chat';

/**
 * Streaming providers deliver assistant text in whatever fragments they
 * flushed. An ACP `agent_message_chunk` (daemon: agent/acp.ts) carries a few
 * characters at a time, so one reply reaches the client as dozens of
 * `chat_message` events. They must land in a single bubble.
 */

function assistantChunk(content: string, itemId?: string): ParsedEvent {
  return {
    type: 'chat_message',
    role: 'assistant',
    content,
    timestamp: 1_000,
    ...(itemId ? { itemId } : {}),
  } as ParsedEvent;
}

function userMessage(content: string): ParsedEvent {
  return { type: 'chat_message', role: 'user', content, timestamp: 900 } as ParsedEvent;
}

/** Verbatim fragmentation captured from a kiro-cli ACP session. */
const FRAGMENTS = [
  '个主',
  '题提交，或',
  '者先',
  '更新 009',
  ' 文档状态和',
  ' v6 ',
  '的',
  '取舍记',
  '录吗？',
];

describe('chat store assistant text coalescing', () => {
  beforeEach(() => {
    useChatStore.getState().clear();
  });

  it('joins consecutive fragments into one message', () => {
    const { addEvent } = useChatStore.getState();
    for (const fragment of FRAGMENTS) {
      addEvent(assistantChunk(fragment));
    }

    const assistant = useChatStore.getState().messages.filter((m) => m.role === 'assistant');
    expect(assistant).toHaveLength(1);
    expect(assistant[0].content).toBe('个主题提交，或者先更新 009 文档状态和 v6 的取舍记录吗？');
  });

  it('keeps fragment spacing intact rather than inserting separators', () => {
    const { addEvent } = useChatStore.getState();
    addEvent(assistantChunk('更新 009'));
    addEvent(assistantChunk(' 文档状态和'));

    const [assistant] = useChatStore.getState().messages.filter((m) => m.role === 'assistant');
    expect(assistant.content).toBe('更新 009 文档状态和');
  });

  it('starts a new message for a new turn instead of extending the old bubble', () => {
    const { addEvent } = useChatStore.getState();
    addEvent(assistantChunk('第一轮'));
    addEvent(userMessage('下一个问题'));
    addEvent(assistantChunk('第二轮'));

    const assistant = useChatStore.getState().messages.filter((m) => m.role === 'assistant');
    expect(assistant.map((m) => m.content)).toEqual(['第一轮', '第二轮']);
  });

  it('groups by provider item id when one is supplied', () => {
    const { addEvent } = useChatStore.getState();
    addEvent(assistantChunk('abc', 'item-1'));
    addEvent(assistantChunk('def', 'item-1'));

    const assistant = useChatStore.getState().messages.filter((m) => m.role === 'assistant');
    expect(assistant).toHaveLength(1);
    expect(assistant[0].content).toBe('abcdef');
  });

  it('does not glue text onto a bubble that is no longer trailing', () => {
    const { addEvent } = useChatStore.getState();
    addEvent(assistantChunk('before tool'));
    addEvent({
      type: 'tool_use',
      tool: 'Read',
      args: { filePath: 'App.tsx' },
      timestamp: 1_000,
    } as ParsedEvent);
    addEvent(assistantChunk('after tool'));

    const assistant = useChatStore.getState().messages.filter((m) => m.role === 'assistant');
    expect(assistant.map((m) => m.content)).toEqual(['before tool', 'after tool']);
  });
});
