import { execSync, spawn } from 'node:child_process';
import type {
  AgentConfig,
  ParsedEvent,
  SpawnConfig,
  SdkAgentAdapter,
  ThinkingConfig,
  ReasoningEffort,
  AccessMode,
  ServiceTier,
} from '@baton/shared';
import { BaseAgentAdapter } from './adapter.js';

/**
 * Capabilities we advertise to the ACP agent in `initialize`. They must only
 * claim what this client actually services: when `fs`/`terminal` are true the
 * agent routes file reads/writes and shell commands to us as JSON-RPC requests
 * (fs/read_text_file, fs/write_text_file, terminal/create, ...) and blocks
 * until we answer. Neither adapter implements those handlers yet, so claiming
 * them hangs the agent on its first file or shell tool call. With them false
 * the agent uses its own built-in tools. Flip to true only together with
 * handlers for the corresponding methods.
 */
const ACP_CLIENT_CAPABILITIES = {
  fs: { readTextFile: false, writeTextFile: false },
  terminal: false,
} as const;

/**
 * Kiro CLI ACP adapter — spawns `kiro-cli acp` which communicates via
 * JSON-RPC 2.0 over stdin/stdout. The PTY bridge captures stdout; we parse
 * newline-delimited JSON-RPC messages into structured ParsedEvents.
 */
export class KiroAcpAdapter extends BaseAgentAdapter {
  readonly name = 'Kiro CLI (ACP)';
  readonly agentType = 'kiro-cli-acp' as const;

  private sessionId: string | null = null;
  private msgIdCounter = 0;

  /**
   * Accumulates a partial JSON-RPC line across PTY chunks.
   *
   * PTY output chunks are NOT line-aligned: a single `{"jsonrpc":"2.0",...}\n`
   * message can arrive as `{"jsonrpc":"2.0","resu` + `lt":...,"id":0}\n`.
   * Without buffering, both halves would fail JSON.parse and the message
   * would be silently lost — leaving the UI stuck on "waiting for agent
   * output..." indefinitely.
   */
  private lineBuffer = '';

  detect(_projectPath: string): boolean {
    try {
      execSync('which kiro-cli', { stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }

  buildSpawnConfig(config: AgentConfig): SpawnConfig {
    return {
      command: 'kiro-cli',
      args: ['acp', '--trust-all-tools', ...(config.args ?? [])],
      env: { ...(process.env as Record<string, string>), ...(config.env ?? {}) },
      cwd: config.projectPath,
    };
  }

  /** Send ACP init handshake after PTY is ready. */
  override afterSpawn(write: (data: string) => void, config: AgentConfig): void {
    // Small delay to let the process start reading stdin
    setTimeout(() => {
      write(this.getInitMessage(config.projectPath));
      setTimeout(() => {
        write(this.getNewSessionMessage(config.projectPath));
      }, 500);
    }, 300);
  }

  /** Returns the JSON-RPC initialize request to send after spawn. */
  getInitMessage(_cwd: string): string {
    return JSON.stringify({
      jsonrpc: '2.0',
      id: this.msgIdCounter++,
      method: 'initialize',
      params: {
        protocolVersion: 1,
        clientCapabilities: ACP_CLIENT_CAPABILITIES,
        clientInfo: { name: 'baton-daemon', version: '1.0.0' },
      },
    }) + '\n';
  }

  /** Returns the JSON-RPC session/new request. */
  getNewSessionMessage(cwd: string): string {
    return JSON.stringify({
      jsonrpc: '2.0',
      id: this.msgIdCounter++,
      method: 'session/new',
      params: { cwd, mcpServers: [] },
    }) + '\n';
  }

  /** Returns a session/prompt request. */
  getPromptMessage(text: string): string | null {
    if (!this.sessionId) return null;
    return JSON.stringify({
      jsonrpc: '2.0',
      id: this.msgIdCounter++,
      method: 'session/prompt',
      params: {
        sessionId: this.sessionId,
        content: [{ type: 'text', text }],
      },
    }) + '\n';
  }

  /** Convert user terminal input into a session/prompt JSON-RPC message. */
  override transformInput(data: string): string | null {
    // Strip trailing \r or \n from terminal input
    const text = data.replace(/[\r\n]+$/, '').trim();
    if (!text) return null;
    return this.getPromptMessage(text);
  }

  /** Filter raw PTY output — extract agent text from JSON-RPC, suppress protocol noise. */
  override filterRawOutput(_data: string): string | null {
    // All display is driven by parseOutput → events.
    // The manager will forward raw_output events to the terminal via event callbacks.
    // Return null to suppress raw JSON-RPC from xterm.
    return null;
  }

  parseOutput(raw: string): ParsedEvent[] {
    const events: ParsedEvent[] = [];
    const now = Date.now();

    // Prepend any partial line from the previous chunk, then split. The last
    // element after split is either an incomplete line (no trailing \n) or an
    // empty string (if raw ended with \n). Keep it in the buffer for next time.
    this.lineBuffer += raw;
    const lines = this.lineBuffer.split('\n');
    this.lineBuffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      let msg: AcpMessage;
      try {
        msg = JSON.parse(trimmed);
      } catch {
        // Not valid JSON — likely stderr noise or a banner. Drop silently.
        continue;
      }

      // Handle JSON-RPC response (has id + result)
      if ('id' in msg && 'result' in msg) {
        const result = msg.result as Record<string, unknown>;

        // initialize response
        if (result.agentInfo) {
          events.push({ type: 'status_change', status: 'running', timestamp: now });
          continue;
        }

        // session/new response
        if (result.sessionId) {
          this.sessionId = result.sessionId as string;
          events.push({ type: 'status_change', status: 'idle', timestamp: now });
          continue;
        }
      }

      // Handle JSON-RPC notification (has method, no id)
      if ('method' in msg && msg.method === 'session/notification') {
        const params = msg.params as AcpNotificationParams;
        const update = params?.update;
        if (!update) continue;

        switch (update.type) {
          case 'AgentMessageChunk':
            events.push({
              type: 'raw_output',
              content: (update.content as string) ?? '',
              timestamp: now,
            });
            break;

          case 'ToolCall':
            events.push({
              type: 'tool_use',
              tool: (update.name as string) ?? 'unknown',
              args: (update.parameters as Record<string, unknown>) ?? {},
              timestamp: now,
            });
            if (update.status === 'running') {
              events.push({ type: 'status_change', status: 'executing', timestamp: now });
            }
            break;

          case 'ToolCallUpdate':
            events.push({
              type: 'raw_output',
              content: (update.content as string) ?? '',
              timestamp: now,
            });
            break;

          case 'TurnEnd':
            events.push({ type: 'status_change', status: 'idle', timestamp: now });
            break;

          default:
            break;
        }
        continue;
      }

      // JSON-RPC error
      if ('error' in msg && msg.error) {
        const err = msg.error as { message?: string };
        events.push({ type: 'error', message: err.message ?? 'ACP error', timestamp: now });
      }
    }

    return events;
  }
}

interface AcpMessage {
  jsonrpc?: string;
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
}

interface AcpNotificationParams {
  sessionId?: string;
  update?: {
    type: string;
    [key: string]: unknown;
  };
}

/**
 * Kiro CLI ACP SDK adapter — spawns `kiro-cli acp --trust-all-tools` directly
 * via child_process.spawn with stdio pipes. Communicates via JSON-RPC 2.0 without
 * virtual terminal escapes, producing clean structured ParsedEvents for Chat mode.
 */
export class KiroAcpSdkAdapter implements SdkAgentAdapter {
  readonly name = 'Kiro CLI (ACP)';
  readonly agentType = 'kiro-cli' as const;

  selectedModel: string | null = null;
  selectedReasoningEffort: ReasoningEffort | null = null;
  selectedAccessMode: AccessMode = 'on-request';
  selectedServiceTier: ServiceTier = 'default';

  private process: ReturnType<typeof spawn> | null = null;
  private sessionId: string | null = null;
  private msgIdCounter = 0;
  private lineBuffer = '';
  private onEvent: ((event: ParsedEvent) => void) | null = null;
  private pendingRequests = new Map<number, string>();
  private messageQueue: string[] = [];

  setThinkingConfig(_config: ThinkingConfig): void {}

  detect(_projectPath?: string): boolean {
    try {
      execSync('which kiro-cli', { stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }

  isSdkAvailable(): boolean {
    return this.detect();
  }

  buildSpawnConfig(): never {
    throw new Error('SDK mode does not use spawn config');
  }

  parseOutput(): ParsedEvent[] {
    return [];
  }

  private send(msg: string): void {
    if (this.process?.stdin && !this.process.stdin.destroyed) {
      this.process.stdin.write(msg);
    }
  }

  getInitMessage(_cwd: string): string {
    return (
      JSON.stringify({
        jsonrpc: '2.0',
        id: this.msgIdCounter++,
        method: 'initialize',
        params: {
          protocolVersion: 1,
          clientCapabilities: ACP_CLIENT_CAPABILITIES,
          clientInfo: { name: 'baton-daemon', version: '1.0.0' },
        },
      }) + '\n'
    );
  }

  getNewSessionMessage(cwd: string): string {
    return (
      JSON.stringify({
        jsonrpc: '2.0',
        id: this.msgIdCounter++,
        method: 'session/new',
        params: { cwd, mcpServers: [] },
      }) + '\n'
    );
  }

  getPromptMessage(text: string): string | null {
    if (!this.sessionId) return null;
    return (
      JSON.stringify({
        jsonrpc: '2.0',
        id: this.msgIdCounter++,
        method: 'session/prompt',
        params: {
          sessionId: this.sessionId,
          content: [{ type: 'text', text }],
        },
      }) + '\n'
    );
  }

  async startSession(
    config: AgentConfig,
    onEvent: (event: ParsedEvent) => void,
  ): Promise<{ write: (input: string) => void; stop: () => Promise<void> }> {
    this.onEvent = onEvent;
    this.sessionId = null;
    this.lineBuffer = '';
    this.pendingRequests.clear();
    this.messageQueue = [];

    const cwd = config.projectPath ?? process.cwd();
    const env = { ...(process.env as Record<string, string>), ...(config.env ?? {}) };

    this.process = spawn('kiro-cli', ['acp', '--trust-all-tools', ...(config.args ?? [])], {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.process.stdout!.on('data', (chunk: Buffer) => {
      this.handleOutput(chunk.toString('utf-8'));
    });

    this.process.stderr!.on('data', (chunk: Buffer) => {
      const errText = chunk.toString('utf-8').trim();
      if (errText) {
        console.error(`[baton] kiro-acp stderr: ${errText}`);
      }
    });

    this.process.on('exit', (code) => {
      console.log(`[baton] kiro-acp: process exited with code ${code}`);
      this.onEvent?.({ type: 'status_change', status: 'stopped', timestamp: Date.now() });
    });

    this.process.on('error', (err) => {
      // Spawn failure (e.g. ENOENT when the CLI is missing): surface the
      // error AND a terminal status so the session doesn't linger in
      // "thinking" forever with no way for the UI to know it died.
      this.onEvent?.({ type: 'error', message: err.message, timestamp: Date.now() });
      this.onEvent?.({ type: 'status_change', status: 'stopped', timestamp: Date.now() });
    });

    setTimeout(() => {
      this.send(this.getInitMessage(cwd));
      setTimeout(() => {
        this.send(this.getNewSessionMessage(cwd));
      }, 300);
    }, 200);

    const write = (input: string) => {
      const text = input.trim();
      if (!text) return;
      this.onEvent?.({ type: 'chat_message', role: 'user', content: text, timestamp: Date.now() });
      this.onEvent?.({ type: 'status_change', status: 'thinking', timestamp: Date.now() });
      if (this.sessionId) {
        const promptMsg = this.getPromptMessage(text);
        if (promptMsg) this.send(promptMsg);
      } else {
        this.messageQueue.push(text);
      }
    };

    const stop = async () => {
      if (this.process) {
        this.process.kill();
        this.process = null;
      }
    };

    return { write, stop };
  }

  async approve(_reason?: string): Promise<void> {
    for (const [id] of this.pendingRequests.entries()) {
      this.send(JSON.stringify({ jsonrpc: '2.0', id, result: { approved: true } }) + '\n');
      this.pendingRequests.delete(id);
      break;
    }
  }

  async reject(_reason?: string): Promise<void> {
    for (const [id] of this.pendingRequests.entries()) {
      this.send(JSON.stringify({ jsonrpc: '2.0', id, result: { approved: false } }) + '\n');
      this.pendingRequests.delete(id);
      break;
    }
  }

  private handleOutput(raw: string): void {
    if (!this.onEvent) return;
    const now = Date.now();
    this.lineBuffer += raw;
    const lines = this.lineBuffer.split('\n');
    this.lineBuffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      let msg: AcpMessage;
      try {
        msg = JSON.parse(trimmed);
      } catch {
        continue;
      }

      if ('id' in msg && 'result' in msg && typeof msg.id === 'number') {
        const result = msg.result as Record<string, unknown>;
        if (result?.agentInfo) {
          this.onEvent({ type: 'status_change', status: 'running', timestamp: now });
          continue;
        }
        if (result?.sessionId) {
          this.sessionId = result.sessionId as string;
          this.onEvent({ type: 'status_change', status: 'idle', timestamp: now });
          while (this.messageQueue.length > 0) {
            const next = this.messageQueue.shift()!;
            const pMsg = this.getPromptMessage(next);
            if (pMsg) this.send(pMsg);
          }
          continue;
        }
      }

      if ('id' in msg && 'method' in msg && typeof msg.id === 'number') {
        this.pendingRequests.set(msg.id, msg.method as string);
        if (msg.method === 'session/request_permission' || msg.method === 'request_permission') {
          const params = (msg.params ?? {}) as Record<string, unknown>;
          this.onEvent({
            type: 'waiting_approval',
            timestamp: now,
          });
          this.onEvent({
            type: 'permission_request',
            requestId: String(msg.id),
            tool: (params.tool as string) ?? (params.name as string) ?? 'unknown',
            action: (params.action as string) ?? 'execute',
            description: (params.description as string) ?? 'ACP permission request',
            timestamp: now,
          });
          continue;
        }
      }

      if ('method' in msg && msg.method === 'session/notification') {
        const params = msg.params as AcpNotificationParams;
        const update = params?.update;
        if (!update) continue;

        switch (update.type) {
          case 'AgentMessageChunk':
            this.onEvent({
              type: 'chat_message',
              role: 'assistant',
              content: (update.content as string) ?? '',
              timestamp: now,
            });
            this.onEvent({
              type: 'raw_output',
              content: (update.content as string) ?? '',
              timestamp: now,
            });
            break;

          case 'ToolCall':
            this.onEvent({
              type: 'tool_use',
              tool: (update.name as string) ?? 'unknown',
              args: (update.parameters as Record<string, unknown>) ?? {},
              timestamp: now,
            });
            if (update.status === 'running') {
              this.onEvent({ type: 'status_change', status: 'executing', timestamp: now });
            }
            break;

          case 'ToolCallUpdate':
            this.onEvent({
              type: 'raw_output',
              content: (update.content as string) ?? '',
              timestamp: now,
            });
            break;

          case 'TurnEnd':
            this.onEvent({ type: 'status_change', status: 'idle', timestamp: now });
            break;

          default:
            break;
        }
        continue;
      }

      if ('error' in msg && msg.error) {
        const err = msg.error as { message?: string };
        this.onEvent({ type: 'error', message: err.message ?? 'ACP error', timestamp: now });
      }
    }
  }
}

export const kiroAcpSdkAdapter = new KiroAcpSdkAdapter();
