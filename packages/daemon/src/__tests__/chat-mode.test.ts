import { describe, it, expect, beforeAll } from 'bun:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentConfig, ParsedEvent, SdkAgentAdapter, ChatImage } from '@baton/shared';

class MockSdkAdapter implements SdkAgentAdapter {
  readonly name = 'Mock SDK';
  readonly agentType = 'claude-code' as const;

  lastWritten: string | null = null;
  lastImages: ChatImage[] | undefined = undefined;
  approvedReason: string | undefined = undefined;
  rejectedReason: string | undefined = undefined;

  isSdkAvailable(): boolean {
    return true;
  }

  detect(): boolean {
    return true;
  }

  buildSpawnConfig(config: AgentConfig) {
    return { command: 'mock', args: [], cwd: config.projectPath, env: {} };
  }

  parseOutput(): ParsedEvent[] {
    return [];
  }

  async startSession(_config: AgentConfig, onEvent: (e: ParsedEvent) => void) {
    onEvent({ type: 'status_change', status: 'running', timestamp: Date.now() });
    return {
      write: (input: string, images?: ChatImage[]) => {
        this.lastWritten = input;
        this.lastImages = images;
        onEvent({ type: 'chat_message', role: 'user', content: input, timestamp: Date.now() });
      },
      stop: async () => {},
    };
  }

  async approve(reason?: string) {
    this.approvedReason = reason;
  }

  async reject(reason?: string) {
    this.rejectedReason = reason;
  }
}

describe('Chat Mode in AgentManager', () => {
  let Manager: typeof import('../agent/manager.js').AgentManager;

  beforeAll(async () => {
    process.env.BATON_HOME = await mkdtemp(join(tmpdir(), 'baton-chat-mode-'));
    ({ AgentManager: Manager } = await import('../agent/manager.js'));
  });

  it('chatWrite in SDK mode records user chat_message and passes images', async () => {
    const adapter = new MockSdkAdapter();
    const manager = new Manager();
    const id = await manager.startSdk({ type: 'claude-code', projectPath: '/tmp/proj' }, adapter);

    const receivedEvents: ParsedEvent[] = [];
    manager.onEvent(id, (ev) => receivedEvents.push(ev));

    const images: ChatImage[] = [{ mediaType: 'image/png', data: 'abc123base64' }];
    manager.chatWrite(id, 'Hello from chat', images);

    expect(adapter.lastWritten).toBe('Hello from chat');
    expect(adapter.lastImages).toEqual(images);

    const userEvent = receivedEvents.find((e) => e.type === 'chat_message' && e.role === 'user');
    expect(userEvent).toBeDefined();
    if (userEvent?.type === 'chat_message') {
      expect(userEvent.content).toBe('Hello from chat');
    }

    const history = manager.getEventHistory(id);
    const historyUserEvent = history.find((e) => e.type === 'chat_message' && e.role === 'user');
    expect(historyUserEvent).toBeDefined();
  });

  it('chatWrite in PTY mode broadcasts user chat_message and records in eventHistory', async () => {
    const manager = new Manager();
    const id = 'mock-pty-agent';
    let ptyWritten = '';

    // Register a simulated PTY session
    (manager as any).agents.set(id, {
      process: {
        id,
        type: 'claude-code',
        projectPath: '/tmp/proj',
        status: 'running',
        startedAt: new Date().toISOString(),
        mode: 'pty',
      },
      adapter: null,
      pty: {
        pid: 12345,
        write: (data: string) => {
          ptyWritten += data;
        },
        resize: () => {},
        kill: () => {},
        onData: () => {},
        onExit: () => {},
      },
      sdk: null,
      sdkAdapter: null,
      state: { status: 'running', at: Date.now(), toolCount: 0 },
      cols: 80,
      rows: 24,
      outputHistory: [],
      displayHistory: [],
      eventHistory: [],
      timeline: [],
      eventCallbacks: new Set(),
      rawCallbacks: new Set(),
      firstOutputReceived: true,
    });

    const receivedEvents: ParsedEvent[] = [];
    manager.onEvent(id, (ev) => receivedEvents.push(ev));

    manager.chatWrite(id, 'Fix the build please');

    // Verify it wrote to PTY with newline
    expect(ptyWritten).toBe('Fix the build please\n');

    // Verify chat_message user event was broadcast
    const userEvent = receivedEvents.find((e) => e.type === 'chat_message' && e.role === 'user');
    expect(userEvent).toBeDefined();
    if (userEvent?.type === 'chat_message') {
      expect(userEvent.content).toBe('Fix the build please');
    }

    // Verify event is in eventHistory
    const history = manager.getEventHistory(id);
    expect(history.some((e) => e.type === 'chat_message' && e.role === 'user')).toBe(true);
  });

  it('approve and reject write y\\n and n\\n to PTY for terminal-based chat sessions', async () => {
    const manager = new Manager();
    const id = 'mock-pty-perm';
    let ptyWritten = '';

    (manager as any).agents.set(id, {
      process: {
        id,
        type: 'claude-code',
        projectPath: '/tmp/proj',
        status: 'running',
        startedAt: new Date().toISOString(),
        mode: 'pty',
      },
      adapter: null,
      pty: {
        pid: 12346,
        write: (data: string) => {
          ptyWritten += data;
        },
        resize: () => {},
        kill: () => {},
        onData: () => {},
        onExit: () => {},
      },
      sdk: null,
      sdkAdapter: null,
      state: { status: 'running', at: Date.now(), toolCount: 0 },
      cols: 80,
      rows: 24,
      outputHistory: [],
      displayHistory: [],
      eventHistory: [],
      timeline: [],
      eventCallbacks: new Set(),
      rawCallbacks: new Set(),
      firstOutputReceived: true,
    });

    await manager.approve(id);
    expect(ptyWritten).toBe('y\n');

    ptyWritten = '';
    await manager.reject(id);
    expect(ptyWritten).toBe('n\n');
  });

  it('approve and reject route to sdkAdapter for SDK-based chat sessions', async () => {
    const adapter = new MockSdkAdapter();
    const manager = new Manager();
    const id = await manager.startSdk({ type: 'claude-code', projectPath: '/tmp/proj' }, adapter);

    await manager.approve(id, 'User clicked approve');
    expect(adapter.approvedReason).toBe('User clicked approve');

    await manager.reject(id, 'User clicked reject');
    expect(adapter.rejectedReason).toBe('User clicked reject');
  });

  it('AntigravitySdkAdapter parses ACP session updates and dispatches events', async () => {
    const { AntigravitySdkAdapter } = await import('../agent/antigravity-sdk.js');
    const adapter = new AntigravitySdkAdapter();
    expect(adapter.agentType).toBe('antigravity');
    expect(adapter.name).toBe('Antigravity (SDK)');

    const events: ParsedEvent[] = [];
    (adapter as any).onEvent = (e: ParsedEvent) => events.push(e);

    // Simulate agent_thought_chunk
    (adapter as any).processMessage({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId: 'sess-1',
        update: {
          sessionUpdate: 'agent_thought_chunk',
          content: { type: 'text', text: 'Analyzing repository structure...' },
        },
      },
    });

    expect(events.some((e) => e.type === 'thinking' && e.content.includes('Analyzing'))).toBe(true);

    // Simulate agent_message_chunk
    (adapter as any).processMessage({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId: 'sess-1',
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'Hello! I am ready to help.' },
        },
      },
    });

    expect(
      events.some(
        (e) =>
          e.type === 'chat_message' &&
          e.role === 'assistant' &&
          e.content === 'Hello! I am ready to help.',
      ),
    ).toBe(true);

    // Simulate tool_call
    (adapter as any).processMessage({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId: 'sess-1',
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: 'call_123',
          name: 'run_command',
          args: { CommandLine: 'git status' },
          title: 'git status',
        },
      },
    });

    expect(events.some((e) => e.type === 'tool_use' && e.tool === 'run_command')).toBe(true);
    expect(events.some((e) => e.type === 'status_change' && e.status === 'executing')).toBe(true);

    // Simulate prompt completion with end_turn
    (adapter as any).currentPromptId = 42;
    (adapter as any).processMessage({
      jsonrpc: '2.0',
      id: 42,
      result: {
        stopReason: 'end_turn',
        usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      },
    });

    expect(events.some((e) => e.type === 'token_usage' && e.totalTokens === 150)).toBe(true);
    expect(events.some((e) => e.type === 'status_change' && e.status === 'idle')).toBe(true);
  });
});
