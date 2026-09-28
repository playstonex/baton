import { describe, it, expect } from 'vitest';
import {
  createHello,
  createWelcome,
  validateHello,
  validateWelcome,
  DEFAULT_SERVER_FEATURES,
  DEFAULT_CLIENT_CAPABILITIES,
  PROTOCOL_VERSION,
} from '../protocol/handshake.js';
import { parseClientMessage, parseDaemonMessage } from '../protocol/schemas.js';

describe('hello message', () => {
  it('createHello advertises default capabilities', () => {
    const hello = createHello();
    expect(hello.type).toBe('hello');
    expect(hello.version).toBe(PROTOCOL_VERSION);
    expect(hello.capabilities).toEqual(DEFAULT_CLIENT_CAPABILITIES);
  });

  it('createHello merges custom capabilities', () => {
    const hello = createHello({ capabilities: { sessionResume: true } });
    expect(hello.capabilities?.sessionResume).toBe(true);
    expect(hello.capabilities?.chatMode).toBe(true); // default preserved
  });

  it('validateHello accepts a well-formed hello', () => {
    const hello = createHello({ sessionId: 's1' });
    const validated = validateHello(hello);
    expect(validated.sessionId).toBe('s1');
  });

  it('parseClientMessage accepts a hello (G3: hello is now a valid ClientMessage)', () => {
    const r = parseClientMessage(createHello());
    expect(r.ok).toBe(true);
  });
});

describe('welcome message', () => {
  it('createWelcome carries server features', () => {
    const welcome = createWelcome('c1', [], DEFAULT_SERVER_FEATURES);
    expect(welcome.type).toBe('welcome');
    expect(welcome.version).toBe(PROTOCOL_VERSION);
    expect(welcome.features).toEqual(DEFAULT_SERVER_FEATURES);
    expect(welcome.serverTime).toBeGreaterThan(0);
  });

  it('validateWelcome accepts a well-formed welcome', () => {
    const welcome = createWelcome('c1', [
      { id: 'a', type: 'codex', status: 'running', projectPath: '/p' },
    ]);
    const validated = validateWelcome(welcome);
    expect(validated.agents).toHaveLength(1);
  });

  it('parseDaemonMessage accepts a welcome (G3: welcome is now a valid DaemonMessage)', () => {
    const welcome = createWelcome('c1', []);
    const r = parseDaemonMessage(welcome);
    expect(r.ok).toBe(true);
  });
});
