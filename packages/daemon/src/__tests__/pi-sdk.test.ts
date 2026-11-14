import { describe, it, expect } from 'bun:test';
import type { ParsedEvent } from '@baton/shared';
import { PiSdkAdapter, piMessageText } from '../agent/pi-sdk.js';

function feed(lines: object[]): ParsedEvent[] {
  const adapter = new PiSdkAdapter();
  const events: ParsedEvent[] = [];
  (adapter as unknown as { onEvent: (e: ParsedEvent) => void }).onEvent = (e) => events.push(e);
  (adapter as unknown as { handleOutput: (s: string) => void }).handleOutput(
    lines.map((l) => JSON.stringify(l)).join('\n') + '\n',
  );
  return events;
}

describe('piMessageText', () => {
  it('reads string and block content', () => {
    expect(piMessageText({ content: 'hi' })).toBe('hi');
    expect(
      piMessageText({ content: [{ type: 'text', text: 'a' }, { type: 'thinking' }, { type: 'text', text: 'b' }] }),
    ).toBe('ab');
    expect(piMessageText(undefined)).toBe('');
  });
});

describe('PiSdkAdapter event mapping', () => {
  it('maps a turn: start, assistant message, end', () => {
    const events = feed([
      { type: 'agent_start' },
      { type: 'message_end', message: { role: 'user', content: 'q' } },
      { type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'Hi' }] } },
      { type: 'agent_end', messages: [] },
    ]);
    expect(events.map((e) => e.type)).toEqual(['status_change', 'chat_message', 'raw_output', 'status_change']);
    expect(events[1]).toMatchObject({ role: 'assistant', content: 'Hi' });
    expect(events[3]).toMatchObject({ status: 'idle' });
  });

  it('maps tool execution and failed responses', () => {
    const events = feed([
      { type: 'tool_execution_start', toolCallId: 't1', toolName: 'bash', args: { command: 'ls' } },
      { type: 'tool_execution_end', toolCallId: 't1', toolName: 'bash', result: {}, isError: true },
      { type: 'response', command: 'prompt', success: false, error: 'No API key' },
    ]);
    expect(events[0]).toMatchObject({ type: 'tool_use', tool: 'bash', itemId: 't1' });
    expect(events.some((e) => e.type === 'error' && e.message === 'No API key')).toBe(true);
    expect(events[events.length - 1]).toMatchObject({ status: 'idle' });
  });
});
