import { describe, it, expect } from 'bun:test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import {
  loadAcpProviders,
  isSafeAcpCommand,
  consumeAcpLines,
  GenericAcpSdkAdapter,
  refreshAcpAdapters,
  getAcpSdkAdapter,
} from '../agent/acp.js';
import type { AcpProviderProfile, ParsedEvent } from '@baton/shared';

const STUB = join(import.meta.dir, 'fixtures', 'stub-acp-agent.mjs');

describe('isSafeAcpCommand', () => {
  it('accepts bare names and absolute paths', () => {
    expect(isSafeAcpCommand('gemini')).toBe(true);
    expect(isSafeAcpCommand('/usr/local/bin/agent-go')).toBe(true);
  });
  it('rejects shell metacharacters, spaces and traversal', () => {
    expect(isSafeAcpCommand('sh -c ls')).toBe(false);
    expect(isSafeAcpCommand('a;b')).toBe(false);
    expect(isSafeAcpCommand('$(x)')).toBe(false);
    expect(isSafeAcpCommand('..')).toBe(false);
    expect(isSafeAcpCommand('../escape')).toBe(false);
    expect(isSafeAcpCommand('')).toBe(false);
  });
});

describe('loadAcpProviders', () => {
  let dir: string;
  it('returns empty for a missing file', async () => {
    expect(await loadAcpProviders(join(tmpdir(), 'no-such-acp.json'))).toEqual(new Map());
  });
  it('parses valid providers and skips unsafe commands', async () => {
    dir = await mkdtemp(join(tmpdir(), 'acp-cfg-'));
    const file = join(dir, 'acp.json');
    await writeFile(
      file,
      JSON.stringify({
        providers: {
          gemini: { command: 'gemini', args: ['--experimental-acp'], label: 'Gemini CLI' },
          evil: { command: 'sh -c echo pwn', args: [] },
          nolabel: { command: 'node' },
        },
      }),
    );
    const map = await loadAcpProviders(file);
    expect(map.size).toBe(2);
    expect(map.get('gemini')).toEqual({
      command: 'gemini',
      args: ['--experimental-acp'],
      label: 'Gemini CLI',
    });
    expect(map.has('evil')).toBe(false);
    expect(map.get('nolabel')!.label).toBe('nolabel');
  });
  it('ignores invalid JSON without throwing', async () => {
    dir = await mkdtemp(join(tmpdir(), 'acp-cfg-'));
    const file = join(dir, 'acp.json');
    await writeFile(file, '{broken');
    expect((await loadAcpProviders(file)).size).toBe(0);
  });
});

describe('consumeAcpLines (framing + mapping)', () => {
  function harness() {
    let buf = '';
    const events: ParsedEvent[] = [];
    const opts: { onSessionId?: (id: string) => void } = {};
    const feed = (chunk: string) =>
      consumeAcpLines(
        chunk,
        () => buf,
        (r) => {
          buf = r;
        },
        (ev) => events.push(ev),
        opts,
      );
    return { events, feed, opts };
  }

  it('reassembles a JSON message split across chunks', () => {
    const h = harness();
    h.feed('{"jsonrpc":"2.0","id":0,"resu');
    expect(h.events).toEqual([]);
    h.feed('lt":{"agentInfo":{"name":"x"}}}\n');
    expect(h.events).toEqual([{ type: 'status_change', status: 'running', timestamp: h.events[0].timestamp }]);
  });

  it('maps the session lifecycle and notification stream', () => {
    const h = harness();
    let sid = '';
    h.opts.onSessionId = (id) => {
      sid = id;
    };
    h.feed('{"jsonrpc":"2.0","id":1,"result":{"sessionId":"s1"}}\n');
    expect(sid).toBe('s1');
    expect(h.events.some((e) => e.type === 'status_change' && e.status === 'idle')).toBe(true);

    h.feed(
      [
        '{"jsonrpc":"2.0","method":"session/notification","params":{"update":{"type":"AgentMessageChunk","content":"hi"}}}',
        '{"jsonrpc":"2.0","method":"session/notification","params":{"update":{"type":"ToolCall","name":"bash","parameters":{"cmd":"ls"},"status":"running"}}}',
        '{"jsonrpc":"2.0","method":"session/notification","params":{"update":{"type":"TurnEnd"}}}',
      ].join('\n') + '\n',
    );
    const types = h.events.map((e) => e.type);
    expect(types).toContain('tool_use');
    expect(types).toContain('status_change'); // executing + idle
  });

  it('surfaces JSON-RPC errors and drops non-JSON noise', () => {
    const h = harness();
    h.feed('not json at all\n{"jsonrpc":"2.0","id":9,"error":{"message":"boom"}}\n');
    expect(h.events).toEqual([{ type: 'error', message: 'boom', timestamp: h.events[0].timestamp }]);
  });
});

describe('GenericAcpSdkAdapter end-to-end (stub agent)', () => {
  it('runs initialize → session/new → prompt and streams structured events', async () => {
    const profile: AcpProviderProfile = {
      command: 'node',
      args: [STUB],
      label: 'Stub',
    };
    const adapter = new GenericAcpSdkAdapter('stub', profile);
    expect(adapter.isSdkAvailable()).toBe(true); // node exists on PATH

    const events: ParsedEvent[] = [];
    const waitUntil = (pred: (e: ParsedEvent) => boolean, ms = 5000) =>
      new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('timeout waiting for event')), ms);
        const check = () => {
          if (events.some(pred)) {
            clearTimeout(t);
            resolve();
          } else setTimeout(check, 25);
        };
        check();
      });

    const session = await adapter.startSession(
      { type: 'acp', projectPath: dirname(STUB) } as Parameters<typeof adapter.startSession>[0],
      (ev) => events.push(ev),
    );

    try {
      await waitUntil((e) => e.type === 'status_change' && e.status === 'idle'); // session ready
      session.write('hello acp');
      await waitUntil((e) => e.type === 'chat_message' && e.content === 'echo: hello acp');
      await waitUntil((e) => e.type === 'status_change' && e.status === 'idle'); // TurnEnd
      expect(events.some((e) => e.type === 'tool_use')).toBe(true);
    } finally {
      await session.stop();
    }
  }, 10000);

  it('refreshAcpAdapters warms the per-provider lookup', () => {
    refreshAcpAdapters(
      new Map([['stub', { command: 'node', args: [STUB], label: 'Stub' }]]),
    );
    expect(getAcpSdkAdapter('stub')?.name).toBe('Stub (ACP)');
    expect(getAcpSdkAdapter('missing')).toBeNull();
  });

  it('returns a FRESH adapter per session — concurrent sessions stay isolated', async () => {
    refreshAcpAdapters(
      new Map([['stub', { command: 'node', args: [STUB], label: 'Stub' }]]),
    );
    // Two lookups must be independent objects: adapters carry per-session
    // state (process/sessionId/onEvent); sharing one would clobber the first
    // session when the second starts.
    const a = getAcpSdkAdapter('stub')!;
    const b = getAcpSdkAdapter('stub')!;
    expect(a).not.toBe(b);

    const eventsA: ParsedEvent[] = [];
    const eventsB: ParsedEvent[] = [];
    const waitUntil = (events: ParsedEvent[], content: string, ms = 6000) =>
      new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error(`timeout waiting for "${content}"`)), ms);
        const check = () => {
          if (events.some((e) => e.type === 'chat_message' && e.content === content)) {
            clearTimeout(t);
            resolve();
          } else setTimeout(check, 25);
        };
        check();
      });

    const cfg = { type: 'acp', projectPath: dirname(STUB) } as Parameters<typeof a.startSession>[0];
    const sessA = await a.startSession(cfg, (ev) => eventsA.push(ev));
    const sessB = await b.startSession(cfg, (ev) => eventsB.push(ev));
    try {
      // Wait both sessions ready (idle after session/new), then prompt each.
      const ready = (events: ParsedEvent[]) =>
        new Promise<void>((resolve) => {
          const t = setTimeout(resolve, 5000);
          const check = () => {
            if (events.some((e) => e.type === 'status_change' && e.status === 'idle')) {
              clearTimeout(t);
              resolve();
            } else setTimeout(check, 25);
          };
          check();
        });
      await ready(eventsA);
      await ready(eventsB);

      sessA.write('from session A');
      sessB.write('from session B');

      await waitUntil(eventsA, 'echo: from session A');
      await waitUntil(eventsB, 'echo: from session B');
      // Cross-contamination check: A must not carry B's echo.
      expect(eventsA.some((e) => e.type === 'chat_message' && e.content === 'echo: from session B')).toBe(false);
      expect(eventsB.some((e) => e.type === 'chat_message' && e.content === 'echo: from session A')).toBe(false);
    } finally {
      await sessA.stop();
      await sessB.stop();
    }
  }, 15000);
});
