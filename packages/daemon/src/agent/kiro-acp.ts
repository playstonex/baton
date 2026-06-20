import { execSync } from 'node:child_process';
import type { AgentConfig, ParsedEvent, SpawnConfig } from '@baton/shared';
import { BaseAgentAdapter } from './adapter.js';

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
        clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: true },
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
