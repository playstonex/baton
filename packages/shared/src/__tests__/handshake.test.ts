import { describe, it, expect } from 'vitest';
import {
  PROTOCOL_VERSION,
  createHello,
  createWelcome,
  validateHello,
  validateWelcome,
} from '../protocol/handshake.js';

describe('Handshake Protocol', () => {
  it('creates a hello message with correct defaults', () => {
    const hello = createHello();
    expect(hello.type).toBe('hello');
    expect(hello.version).toBe(PROTOCOL_VERSION);
    expect(hello.channels).toEqual([0, 1, 2]);
    expect(hello.sessionId).toBeUndefined();
  });

  it('creates a hello message with sessionId', () => {
    const hello = createHello({ sessionId: 'abc-123' });
    expect(hello.sessionId).toBe('abc-123');
  });

  it('creates a welcome message', () => {
    const agents = [{ id: 'a1', type: 'claude-code', status: 'running', projectPath: '/tmp' }];
    const welcome = createWelcome('session-1', agents);

    expect(welcome.type).toBe('welcome');
    expect(welcome.version).toBe(PROTOCOL_VERSION);
    expect(welcome.sessionId).toBe('session-1');
    expect(welcome.agents).toEqual(agents);
    expect(welcome.serverTime).toBeGreaterThan(0);
  });

  it('validates a valid hello message', () => {
    const hello = createHello();
    const validated = validateHello(hello);
    expect(validated.type).toBe('hello');
  });

  it('rejects an invalid hello message', () => {
    expect(() => validateHello({ type: 'wrong' })).toThrow();
  });

  it('validates a valid welcome message', () => {
    const welcome = createWelcome('s1', []);
    const validated = validateWelcome(welcome);
    expect(validated.type).toBe('welcome');
  });

  it('rejects an invalid welcome message', () => {
    expect(() => validateWelcome({ type: 'wrong' })).toThrow();
  });
});
