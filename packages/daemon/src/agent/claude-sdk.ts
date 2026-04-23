import type { AgentConfig, ParsedEvent, SdkAgentAdapter } from '@flowwhips/shared';
import { execSync } from 'node:child_process';

type SdkMessage = {
  type: string;
  subtype?: string;
  message?: { content?: Array<{ type: string; [key: string]: unknown }> };
  result?: string;
};

export class ClaudeSdkAdapter implements SdkAgentAdapter {
  readonly name = 'Claude Code (SDK)';
  readonly agentType = 'claude-code-sdk' as const;

  private controller: AbortController | null = null;
  private sdkAvailable: boolean | null = null;

  isSdkAvailable(): boolean {
    if (this.sdkAvailable !== null) return this.sdkAvailable;
    try {
      require.resolve('@anthropic-ai/claude-agent-sdk');
      this.sdkAvailable = true;
    } catch {
      this.sdkAvailable = false;
    }
    return this.sdkAvailable;
  }

  detect(): boolean {
    try {
      execSync('which claude', { stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }

  async startSession(
    _config: AgentConfig,
    onEvent: (event: ParsedEvent) => void,
  ): Promise<{ write: (input: string) => void; stop: () => Promise<void> }> {
    const { query } = await import('@anthropic-ai/claude-agent-sdk');
    this.controller = new AbortController();

    const messageQueue: string[] = [];
    let resolvePrompt: ((value: void) => void) | null = null;

    async function* promptGen() {
      while (true) {
        if (messageQueue.length > 0) {
          const msg = messageQueue.shift()!;
          yield { role: 'user' as const, content: msg };
        }
        await new Promise<void>((resolve) => {
          resolvePrompt = resolve;
        });
      }
    }

    const write = (input: string) => {
      messageQueue.push(input);
      if (resolvePrompt) {
        resolvePrompt();
        resolvePrompt = null;
      }
    };

    const stop = async () => {
      this.controller?.abort();
    };

    // The SDK's query() prompt expects AsyncIterable<SDKUserMessage> but our
    // generator produces a compatible subset — cast to satisfy tsc while Bun
    // handles it correctly at runtime.
    const stream = query({
      prompt: promptGen() as unknown as Parameters<typeof query>[0]['prompt'],
      options: {
        model: 'claude-sonnet-7-20251119',
        maxTurns: 50,
        effort: 'medium',
      },
    });

    (async () => {
      try {
        for await (const raw of stream) {
          const msg = raw as SdkMessage;

          if (msg.type === 'system') {
            if (msg.subtype === 'init') {
              onEvent({ type: 'status_change', status: 'running', timestamp: Date.now() });
            }
          } else if (msg.type === 'assistant') {
            this.processAssistantMessage(msg, onEvent);
          } else if (msg.type === 'result') {
            if (msg.subtype === 'success') {
              onEvent({ type: 'status_change', status: 'stopped', timestamp: Date.now() });
            }
          }
        }
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          onEvent({ type: 'error', message: (err as Error).message, timestamp: Date.now() });
        }
      }
    })();

    return { write, stop };
  }

  private processAssistantMessage(msg: SdkMessage, onEvent: (event: ParsedEvent) => void): void {
    const content = msg.message?.content ?? [];
    for (const block of content) {
      if (block.type === 'tool_use') {
        onEvent({
          type: 'tool_use',
          tool: (block.name as string) ?? 'unknown',
          args: (block.input as Record<string, unknown>) ?? {},
          timestamp: Date.now(),
        });
      } else if (block.type === 'text') {
        onEvent({
          type: 'raw_output',
          content: (block.text as string) ?? '',
          timestamp: Date.now(),
        });
      } else if (block.type === 'thinking') {
        onEvent({
          type: 'thinking',
          content: (block.thinking as string) ?? '',
          timestamp: Date.now(),
        });
      }
    }
  }

  buildSpawnConfig(): never {
    throw new Error('SDK mode does not use spawn config');
  }

  parseOutput(): ParsedEvent[] {
    return [];
  }
}

export const claudeSdkAdapter = new ClaudeSdkAdapter();