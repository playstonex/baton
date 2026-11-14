/**
 * Pi chat adapter — drives `pi --mode rpc` (JSON lines over stdio) instead of
 * scraping its TUI.
 *
 * Commands (stdin):  { type: 'prompt', message } · { type: 'abort' } ·
 *                    { type: 'set_model', provider, modelId } ·
 *                    { type: 'set_thinking_level', level }
 * Output (stdout):   { type: 'response', command, success, error? } for each
 *                    command, plus AgentEvent objects (agent_start / agent_end,
 *                    message_update, message_end, tool_execution_start/end).
 */

import { execSync, spawn } from 'node:child_process';
import type {
  AgentConfig,
  ParsedEvent,
  SdkAgentAdapter,
  SpawnConfig,
  ThinkingConfig,
} from '@baton/shared';
import { DEFAULT_PI_MODELS } from './pi.js';

interface PiMessage {
  role?: string;
  content?: unknown;
}

/** Concatenate the text blocks of a Pi message ({ content: string | [{type:'text',text}] }). */
export function piMessageText(message: PiMessage | undefined): string {
  const content = message?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((b) => (b && typeof b === 'object' && (b as { type?: string }).type === 'text'
      ? String((b as { text?: string }).text ?? '')
      : ''))
    .join('');
}

/** Map Baton thinking config to Pi's thinking level names. */
function piThinkingLevel(config: ThinkingConfig): string {
  if (config.mode === 'none') return 'off';
  if (config.mode === 'level' && config.level) return config.level;
  return 'medium';
}

export class PiSdkAdapter implements SdkAgentAdapter {
  readonly name = 'Pi';
  readonly agentType = 'pi' as const;
  selectedModel: string | null = null;

  private process: ReturnType<typeof spawn> | null = null;
  private onEvent: ((event: ParsedEvent) => void) | null = null;
  private lineBuffer = '';
  private appliedModel: string | null = null;
  private thinkingLevel: string | null = null;

  setThinkingConfig(config: ThinkingConfig): void {
    this.thinkingLevel = piThinkingLevel(config);
    this.sendCommand({ type: 'set_thinking_level', level: this.thinkingLevel });
  }

  detect(_projectPath?: string): boolean {
    try {
      execSync('which pi', { stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }

  isSdkAvailable(): boolean {
    return this.detect();
  }

  listModels(): string[] {
    return DEFAULT_PI_MODELS.map((m) => m.id);
  }

  listModelDetails() {
    return DEFAULT_PI_MODELS;
  }

  buildSpawnConfig(): SpawnConfig {
    throw new Error('SDK mode does not use spawn config');
  }

  parseOutput(): ParsedEvent[] {
    return [];
  }

  private sendCommand(cmd: Record<string, unknown>): void {
    if (this.process?.stdin && !this.process.stdin.destroyed) {
      this.process.stdin.write(JSON.stringify(cmd) + '\n');
    }
  }

  async startSession(
    config: AgentConfig,
    onEvent: (event: ParsedEvent) => void,
  ): Promise<{ write: (input: string) => void; stop: () => Promise<void> }> {
    this.onEvent = onEvent;
    this.lineBuffer = '';
    this.appliedModel = null;

    const cwd = config.projectPath ?? process.cwd();
    const env = { ...(process.env as Record<string, string>), ...(config.env ?? {}) };
    this.process = spawn('pi', ['--mode', 'rpc', ...(config.args ?? [])], {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.process.stdout!.on('data', (chunk: Buffer) => this.handleOutput(chunk.toString('utf-8')));
    this.process.stderr!.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf-8').trim();
      if (text) console.error(`[baton] pi stderr: ${text}`);
    });
    this.process.on('exit', (code) => {
      console.log(`[baton] pi: exited with code ${code}`);
      this.onEvent?.({ type: 'status_change', status: 'stopped', timestamp: Date.now() });
    });
    this.process.on('error', (err) => {
      this.onEvent?.({ type: 'error', message: err.message, timestamp: Date.now() });
      this.onEvent?.({ type: 'status_change', status: 'stopped', timestamp: Date.now() });
    });

    // Ready as soon as the process is up; Pi has no handshake.
    this.onEvent({ type: 'status_change', status: 'idle', timestamp: Date.now() });

    const write = (input: string) => {
      const text = input.trim();
      if (!text) return;
      this.applySelectedModel();
      this.onEvent?.({ type: 'chat_message', role: 'user', content: text, timestamp: Date.now() });
      this.onEvent?.({ type: 'status_change', status: 'thinking', timestamp: Date.now() });
      this.sendCommand({ type: 'prompt', message: text });
    };

    const stop = async () => {
      if (this.process) {
        this.sendCommand({ type: 'abort' });
        this.process.kill();
        this.process = null;
      }
    };

    return { write, stop };
  }

  /** selectedModel is "provider/modelId"; Pi wants them as separate fields. */
  private applySelectedModel(): void {
    const model = this.selectedModel;
    if (!model || model === this.appliedModel) return;
    const slash = model.indexOf('/');
    if (slash <= 0) return;
    this.sendCommand({
      type: 'set_model',
      provider: model.slice(0, slash),
      modelId: model.slice(slash + 1),
    });
    this.appliedModel = model;
  }

  private handleOutput(raw: string): void {
    this.lineBuffer += raw;
    const lines = this.lineBuffer.split('\n');
    this.lineBuffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(trimmed);
      } catch {
        continue;
      }
      this.handleMessage(msg);
    }
  }

  private handleMessage(msg: Record<string, unknown>): void {
    const now = Date.now();
    const emit = (e: ParsedEvent) => this.onEvent?.(e);

    switch (msg.type) {
      case 'response': {
        if (msg.success === false) {
          emit({ type: 'error', message: String(msg.error ?? 'Pi command failed'), timestamp: now });
          emit({ type: 'status_change', status: 'idle', timestamp: now });
        }
        break;
      }
      case 'agent_start':
        emit({ type: 'status_change', status: 'thinking', timestamp: now });
        break;
      case 'agent_end':
        emit({ type: 'status_change', status: 'idle', timestamp: now });
        break;
      case 'message_update': {
        const ev = msg.assistantMessageEvent as { type?: string; content?: string } | undefined;
        if (ev?.type === 'thinking_end' && ev.content) {
          emit({ type: 'thinking', content: ev.content, timestamp: now });
        }
        break;
      }
      case 'message_end': {
        const message = msg.message as PiMessage | undefined;
        if (message?.role === 'assistant') {
          const text = piMessageText(message);
          if (text) {
            // chat_message only: AgentManager mirrors it into displayHistory
            // and the store's output table, so a paired raw_output stored and
            // streamed the same text twice.
            emit({ type: 'chat_message', role: 'assistant', content: text, timestamp: now });
          }
        }
        break;
      }
      case 'tool_execution_start':
        emit({
          type: 'tool_use',
          tool: String(msg.toolName ?? 'unknown'),
          args: (msg.args as Record<string, unknown>) ?? {},
          timestamp: now,
          itemId: typeof msg.toolCallId === 'string' ? msg.toolCallId : undefined,
        });
        emit({ type: 'status_change', status: 'executing', timestamp: now });
        break;
      case 'tool_execution_end':
        if (msg.isError === true) {
          emit({ type: 'error', message: `Tool ${String(msg.toolName)} failed`, timestamp: now });
        }
        emit({ type: 'status_change', status: 'thinking', timestamp: now });
        break;
      default:
        break;
    }
  }
}
