import type { AgentConfig, ParsedEvent, SdkAgentAdapter, ReasoningEffort, AccessMode, ServiceTier } from '@baton/shared';
import { execSync } from 'node:child_process';

type SdkMessage = {
  type: string;
  subtype?: string;
  message?: { content?: Array<{ type: string; [key: string]: unknown }> };
  result?: string;
};

type SdkUserInput = {
  type: 'user';
  message: { role: 'user'; content: string };
  parent_tool_use_id: string | null;
};

export class ClaudeSdkAdapter implements SdkAgentAdapter {
  readonly name = 'Claude Code (SDK)';
  readonly agentType = 'claude-code-sdk' as const;

  selectedModel: string | null = null;
  selectedReasoningEffort: ReasoningEffort | null = null;
  selectedAccessMode: AccessMode = 'on-request';
  selectedServiceTier: ServiceTier = 'default';

  private controller: AbortController | null = null;
  private sdkAvailable: boolean | null = null;
  private projectPath = '';
  private resolveApproval: ((approved: boolean) => void) | null = null;

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
    config: AgentConfig,
    onEvent: (event: ParsedEvent) => void,
  ): Promise<{ write: (input: string) => void; stop: () => Promise<void> }> {
    this.projectPath = config.projectPath;
    console.log('[baton] claude-sdk: importing @anthropic-ai/claude-agent-sdk...');
    const mod: Record<string, unknown> = await import('@anthropic-ai/claude-agent-sdk');
    const queryMod = mod.query ?? mod.default;
    console.log('[baton] claude-sdk: imported, query fn:', typeof queryMod);
    this.controller = new AbortController();

    const messageQueue: string[] = [];
    let resolvePrompt: ((value: void) => void) | null = null;

    async function* promptGen(): AsyncIterable<SdkUserInput> {
      while (true) {
        if (messageQueue.length > 0) {
          const msg = messageQueue.shift()!;
          yield {
            type: 'user' as const,
            message: { role: 'user' as const, content: msg },
            parent_tool_use_id: null,
          };
        }
        await new Promise<void>((resolve) => {
          resolvePrompt = resolve;
        });
      }
    }

    const write = (input: string) => {
      console.log('[baton] claude-sdk: write() called, input:', input.slice(0, 60));
      onEvent({ type: 'chat_message', role: 'user', content: input, timestamp: Date.now() });
      messageQueue.push(input);
      if (resolvePrompt) {
        resolvePrompt();
        resolvePrompt = null;
      }
    };

    const stop = async () => {
      console.log('[baton] claude-sdk: stop() called');
      this.controller?.abort();
    };

    const options: Record<string, unknown> = {
      maxTurns: 50,
    };
    if (this.selectedModel) options.model = this.selectedModel;
    else options.model = 'claude-sonnet-7-20251119';
    if (this.selectedReasoningEffort) options.effort = this.selectedReasoningEffort;
    else options.effort = 'medium';

    console.log('[baton] claude-sdk: calling query() with model:', options.model);
    const queryFn = queryMod as (args: Record<string, unknown>) => AsyncIterable<unknown>;
    const asyncIterable = queryFn({
      prompt: promptGen(),
      options,
    });

    (async () => {
      try {
        let msgCount = 0;
        for await (const raw of asyncIterable) {
          msgCount++;
          const msg = raw as SdkMessage;
          console.log(`[baton] claude-sdk: stream msg #${msgCount} type="${msg.type}" subtype="${msg.subtype ?? ''}"`);

          if (msg.type === 'system') {
            if (msg.subtype === 'init') {
              console.log('[baton] claude-sdk: session initialized');
              onEvent({ type: 'status_change', status: 'running', timestamp: Date.now() });
            }
          } else if (msg.type === 'assistant') {
            onEvent({ type: 'status_change', status: 'thinking', timestamp: Date.now() });
            this.processAssistantMessage(msg, onEvent);
          } else if (msg.type === 'result') {
            console.log('[baton] claude-sdk: result msg, subtype:', msg.subtype);
            onEvent({ type: 'status_change', status: 'idle', timestamp: Date.now() });
            if (msg.subtype === 'success') {
              onEvent({ type: 'status_change', status: 'stopped', timestamp: Date.now() });
            }
          } else {
            console.log('[baton] claude-sdk: unhandled message type:', msg.type);
          }
        }
        console.log(`[baton] claude-sdk: stream ended after ${msgCount} messages`);
      } catch (err) {
        const error = err as Error;
        console.error('[baton] claude-sdk: stream error:', error.name, error.message);
        if (error.name !== 'AbortError') {
          onEvent({ type: 'error', message: error.message, timestamp: Date.now() });
        }
      }
    })();

    return { write, stop };
  }

  private processAssistantMessage(msg: SdkMessage, onEvent: (event: ParsedEvent) => void): void {
    const content = msg.message?.content ?? [];
    for (const block of content) {
      if (block.type === 'tool_use') {
        const toolName = (block.name as string) ?? 'unknown';
        const toolInput = (block.input as Record<string, unknown>) ?? {};

        if (toolName === 'Bash' || toolName === 'bash') {
          const command = (toolInput.command as string) ?? (toolInput.description as string) ?? '';
          onEvent({
            type: 'command_exec',
            command,
            output: '',
            isStreaming: true,
            timestamp: Date.now(),
          });
        } else if (toolName === 'Write' || toolName === 'write' || toolName === 'Edit' || toolName === 'edit' || toolName === 'MultiEdit') {
          const filePath = (toolInput.file_path as string) ?? (toolInput.path as string) ?? '';
          if (filePath) {
            const changeType = toolName === 'Write' || toolName === 'write' ? 'create' : 'modify';
            onEvent({
              type: 'file_change',
              path: filePath,
              changeType,
              timestamp: Date.now(),
            });
          }
          onEvent({
            type: 'tool_use',
            tool: toolName,
            args: toolInput,
            timestamp: Date.now(),
          });
        } else {
          onEvent({
            type: 'tool_use',
            tool: toolName,
            args: toolInput,
            timestamp: Date.now(),
          });
        }
      } else if (block.type === 'text') {
        const text = (block.text as string) ?? '';
        onEvent({
          type: 'chat_message',
          role: 'assistant',
          content: text,
          timestamp: Date.now(),
        });
        onEvent({
          type: 'raw_output',
          content: text,
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

  async approve(_reason?: string): Promise<void> {
    if (this.resolveApproval) {
      this.resolveApproval(true);
      this.resolveApproval = null;
    }
  }

  async reject(_reason?: string): Promise<void> {
    if (this.resolveApproval) {
      this.resolveApproval(false);
      this.resolveApproval = null;
    }
  }

  async listModels(): Promise<string[]> {
    try {
      const raw = execSync('claude models 2>/dev/null', {
        encoding: 'utf-8',
        timeout: 10000,
      });
      const models = raw.split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && !l.startsWith('#') && !l.startsWith('Model'));
      return models.length > 0 ? models : [
        'claude-sonnet-7-20251119',
        'claude-opus-4-20250514',
        'claude-haiku-4-20250506',
      ];
    } catch {
      return [
        'claude-sonnet-7-20251119',
        'claude-opus-4-20250514',
        'claude-haiku-4-20250506',
      ];
    }
  }

  private isGitRepo(): boolean {
    try {
      execSync('git rev-parse --is-inside-work-tree', {
        cwd: this.projectPath, encoding: 'utf-8', timeout: 3000, stdio: 'pipe',
      });
      return true;
    } catch {
      return false;
    }
  }

  async listGitBranches(): Promise<{ branches: string[]; currentBranch: string }> {
    if (!this.isGitRepo()) return { branches: [], currentBranch: '' };
    try {
      const raw = execSync('git branch --list --format="%(refname:short)"', {
        cwd: this.projectPath, encoding: 'utf-8', timeout: 5000,
      });
      const branches = raw.split('\n').map((b) => b.trim()).filter(Boolean);
      let currentBranch = '';
      try {
        currentBranch = execSync('git rev-parse --abbrev-ref HEAD', {
          cwd: this.projectPath, encoding: 'utf-8', timeout: 5000,
        }).trim();
      } catch { /* ignore */ }
      return { branches, currentBranch };
    } catch {
      return { branches: [], currentBranch: '' };
    }
  }

  async gitStatus(): Promise<string> {
    if (!this.isGitRepo()) return '';
    try {
      return execSync('git status --short', {
        cwd: this.projectPath, encoding: 'utf-8', timeout: 5000,
      }).trim();
    } catch { return ''; }
  }

  async gitDiff(): Promise<string> {
    if (!this.isGitRepo()) return '';
    try {
      return execSync('git diff --stat', {
        cwd: this.projectPath, encoding: 'utf-8', timeout: 10000,
      }).trim();
    } catch { return ''; }
  }

  async gitLog(count: number = 10): Promise<string> {
    if (!this.isGitRepo()) return '';
    try {
      return execSync(`git log --oneline -${count}`, {
        cwd: this.projectPath, encoding: 'utf-8', timeout: 5000,
      }).trim();
    } catch { return ''; }
  }

  async gitCheckout(branch: string): Promise<{ success: boolean; error?: string }> {
    try {
      execSync(`git checkout ${branch}`, {
        cwd: this.projectPath, encoding: 'utf-8', timeout: 10000,
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Checkout failed' };
    }
  }

  async gitCommit(message: string): Promise<{ success: boolean; error?: string }> {
    try {
      execSync('git add -A', { cwd: this.projectPath, encoding: 'utf-8', timeout: 10000 });
      execSync(`git commit -m ${JSON.stringify(message)}`, {
        cwd: this.projectPath, encoding: 'utf-8', timeout: 10000,
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Commit failed' };
    }
  }

  async gitPush(): Promise<{ success: boolean; error?: string }> {
    try {
      execSync('git push', { cwd: this.projectPath, encoding: 'utf-8', timeout: 30000 });
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Push failed' };
    }
  }

  async gitPull(): Promise<{ success: boolean; error?: string }> {
    try {
      execSync('git pull', { cwd: this.projectPath, encoding: 'utf-8', timeout: 30000 });
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Pull failed' };
    }
  }

  async gitCreateBranch(name: string): Promise<{ success: boolean; error?: string }> {
    try {
      execSync(`git checkout -b ${name}`, {
        cwd: this.projectPath, encoding: 'utf-8', timeout: 10000,
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Branch creation failed' };
    }
  }

  getProjectPath(): string {
    return this.projectPath;
  }

  buildSpawnConfig(): never {
    throw new Error('SDK mode does not use spawn config');
  }

  parseOutput(): ParsedEvent[] {
    return [];
  }
}

export const claudeSdkAdapter = new ClaudeSdkAdapter();
