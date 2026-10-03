import { describe, it, expect } from 'vitest';
import { generateSessionId } from '../utils/base.js';
import { parseClientMessage, parseDaemonMessage } from '../protocol/schemas.js';

describe('generateSessionId (ULID)', () => {
  it('produces 26-char Crockford base32 ids', () => {
    const id = generateSessionId();
    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it('sorts lexicographically by creation time', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 50; i++) {
      ids.push(generateSessionId());
      // ensure the ms timestamp advances between samples
      await new Promise((r) => setTimeout(r, 2));
    }
    const sorted = [...ids].sort();
    expect(ids).toEqual(sorted);
  });

  it('is unique across many rapid generations', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 5000; i++) seen.add(generateSessionId());
    expect(seen.size).toBe(5000);
  });
});

describe('ping/pong protocol', () => {
  it('accepts client ping at the daemon boundary', () => {
    const result = parseClientMessage({ type: 'ping' });
    expect(result.ok).toBe(true);
  });

  it('accepts daemon pong at the client boundary', () => {
    const result = parseDaemonMessage({ type: 'pong' });
    expect(result.ok).toBe(true);
  });

  it('still rejects malformed messages', () => {
    expect(parseClientMessage({ type: 'terminal_input' }).ok).toBe(false); // missing sessionId
    expect(parseClientMessage({ type: 'pingg' }).ok).toBe(false);
  });

  it('agent_list entries carry optional session metadata', () => {
    const result = parseDaemonMessage({
      type: 'agent_list',
      agents: [
        { id: 'a', type: 'claude-code', status: 'running', projectPath: '/tmp' },
        {
          id: 'b',
          type: 'codex',
          status: 'stopped',
          projectPath: '/tmp',
          title: 'Fix login',
          startedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
    expect(result.ok).toBe(true);
  });
});
