import { describe, it, expect } from 'vitest';
import { parseClientMessage, parseDaemonMessage } from '../protocol/schemas.js';

describe('parseClientMessage', () => {
  it('accepts a valid terminal_input', () => {
    const r = parseClientMessage({ type: 'terminal_input', sessionId: 's1', data: 'ls\n' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.type).toBe('terminal_input');
  });

  it('accepts a valid chat_input with optional messageId', () => {
    const r = parseClientMessage({
      type: 'chat_input',
      sessionId: 's1',
      content: 'hello',
      messageId: 'm1',
    });
    expect(r.ok).toBe(true);
  });

  it('accepts a control message', () => {
    const r = parseClientMessage({
      type: 'control',
      action: 'attach_session',
      sessionId: 's1',
    });
    expect(r.ok).toBe(true);
  });

  it('rejects an unknown message type', () => {
    const r = parseClientMessage({ type: 'not_a_real_type' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('invalid message');
  });

  it('rejects a terminal_input with empty sessionId', () => {
    const r = parseClientMessage({ type: 'terminal_input', sessionId: '', data: 'x' });
    expect(r.ok).toBe(false);
  });

  it('rejects a non-object payload', () => {
    const r = parseClientMessage('not an object');
    expect(r.ok).toBe(false);
  });

  it('rejects an invalid access_mode enum value', () => {
    const r = parseClientMessage({
      type: 'access_mode_select',
      sessionId: 's1',
      mode: 'invalid-mode',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('invalid');
  });

  it('includes a path in the error for nested validation failures', () => {
    const r = parseClientMessage({
      type: 'thinking_config_select',
      sessionId: 's1',
      config: { mode: 'invalid-mode' },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('config');
  });
});

describe('parseDaemonMessage', () => {
  it('accepts a valid agent_list', () => {
    const r = parseDaemonMessage({
      type: 'agent_list',
      agents: [{ id: 'a1', type: 'claude-code', status: 'running', projectPath: '/tmp' }],
    });
    expect(r.ok).toBe(true);
  });

  it('accepts a parsed_event with arbitrary event shape', () => {
    const r = parseDaemonMessage({
      type: 'parsed_event',
      sessionId: 's1',
      event: { type: 'status_change', status: 'running', timestamp: Date.now() },
    });
    expect(r.ok).toBe(true);
  });

  it('accepts a terminal_output with optional seq (sessionResume)', () => {
    const r = parseDaemonMessage({ type: 'terminal_output', sessionId: 's1', data: 'x', seq: 42 });
    expect(r.ok).toBe(true);
  });

  it('accepts a resume_reply', () => {
    const r = parseDaemonMessage({
      type: 'resume_reply',
      sessionId: 's1',
      fromSeq: 10,
      toSeq: 15,
      currentSeq: 15,
    });
    expect(r.ok).toBe(true);
  });

  it('accepts a resume_reply with gap flag', () => {
    const r = parseDaemonMessage({
      type: 'resume_reply',
      sessionId: 's1',
      fromSeq: 0,
      toSeq: 0,
      currentSeq: 100,
      gap: true,
    });
    expect(r.ok).toBe(true);
  });

  it('accepts a control action resume_session with payload', () => {
    const r = parseClientMessage({
      type: 'control',
      action: 'resume_session',
      sessionId: 's1',
      payload: { lastSeq: 42 },
    });
    expect(r.ok).toBe(true);
  });

  it('accepts an error with optional fields', () => {
    const r = parseDaemonMessage({ type: 'error', message: 'boom' });
    expect(r.ok).toBe(true);
  });

  it('rejects a daemon message missing required fields', () => {
    const r = parseDaemonMessage({ type: 'agent_list' });
    expect(r.ok).toBe(false);
  });

  it('rejects an unknown daemon message type', () => {
    const r = parseDaemonMessage({ type: 'not_real' });
    expect(r.ok).toBe(false);
  });
});
