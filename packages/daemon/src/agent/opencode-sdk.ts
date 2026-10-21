import type { AgentConfig, ParsedEvent, SdkAgentAdapter, ThinkingConfig, ReasoningEffort, AccessMode, ServiceTier } from '@baton/shared';
import { execSync, execFileSync, spawn } from 'node:child_process';
import { isSafeGitRef } from './adapter.js';

type OcToolState = {
  status?: string;
  input?: Record<string, unknown>;
  output?: string;
  content?: Array<{ type?: string; text?: string }>;
  metadata?: Record<string, unknown>;
};

/**
 * A message content part. opencode 1.x used `parts[]` with `tool`/`callID`;
 * 2.x uses `content[]` with `name`/`id` and a `state.content` text array.
 * The shape below is the union of both so one parser handles each.
 */
type OcPart = {
  id?: string;
  type?: string;
  text?: string;
  // 1.x tool fields
  tool?: string;
  callID?: string;
  // 2.x tool fields
  name?: string;
  executed?: boolean;
  snapshot?: string;
  hash?: string;
  files?: string[];
  time?: { start?: number; end?: number; created?: number; ran?: number; completed?: number };
  state?: OcToolState;
};

type OcMessage = {
  id: string;
  /** 1.x */
  role?: string;
  parts?: OcPart[];
  /** 2.x — 'user' | 'assistant' | 'idle' */
  type?: string;
  content?: OcPart[];
  text?: string;
  outcome?: string;
  finish?: string | null;
  time?: { created?: number; streamed?: number; completed?: number };
};

type AssistantProgress = {
  /** partIndex → characters already emitted */
  text: Map<number, number>;
  reasoning: Map<number, number>;
  tools: Set<string>;
  finishedTools: Set<string>;
};

export class OpenCodeSdkAdapter implements SdkAgentAdapter {
  readonly name = 'OpenCode (SDK)';
  readonly agentType = 'opencode' as const;

  selectedModel: string | null = null;
  selectedReasoningEffort: ReasoningEffort | null = null;
  selectedAccessMode: AccessMode = 'on-request';
  selectedServiceTier: ServiceTier = 'default';

  setThinkingConfig(_config: ThinkingConfig): void {
    // OpenCode SDK does not currently support thinking/reasoning configuration
  }

  private projectPath = '';
  private serverProcess: ReturnType<typeof spawn> | null = null;
  private port = 0;
  private sessionId = '';
  private baseUrl = '';
  /** '' on opencode 1.x, '/api' on the 2.x API. */
  private apiPrefix = '';
  /** Basic-auth password printed by `opencode serve` on 2.x. */
  private serverPassword = '';
  private isV2 = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private assistantProgress = new Map<string, AssistantProgress>();
  private seenIdle = new Set<string>();

  detect(): boolean {
    try {
      execSync('which opencode', { stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }

  /** PTY-only hook — SDK adapters track provider session ids natively. */
  extractSessionId(_clean: string): string | null {
    return null;
  }

  isSdkAvailable(): boolean {
    return this.detect();
  }

  async startSession(
    config: AgentConfig,
    onEvent: (event: ParsedEvent) => void,
  ): Promise<{ write: (input: string) => void; stop: () => Promise<void> }> {
    this.projectPath = config.projectPath;
    this.assistantProgress.clear();
    this.seenIdle.clear();

    await this.startServer();

    const created = await this.httpPost('/session', { title: `baton-${Date.now()}` });
    const session = this.unwrap<{ id: string }>(created);
    this.sessionId = session.id ?? '';

    this.pollEvents(onEvent);

    onEvent({ type: 'status_change', status: 'running', timestamp: Date.now() });

    const write = (input: string) => {
      onEvent({ type: 'chat_message', role: 'user', content: input, timestamp: Date.now() });

      // 2.x takes a flat { text } body; 1.x took content parts on
      // prompt_async. Both accept the request asynchronously.
      const request = this.isV2
        ? this.httpPost(`/session/${this.sessionId}/prompt`, { text: input })
        : this.httpPost(`/session/${this.sessionId}/prompt_async`, {
            parts: [{ type: 'text', text: input }],
          });

      request.catch((err) => {
        console.error('[baton] opencode-sdk: prompt error:', err);
        onEvent({ type: 'error', message: String(err), timestamp: Date.now() });
      });
    };

    const stop = async () => {
      try {
        await (this.isV2
          ? this.httpPost(`/session/${this.sessionId}/interrupt`, {})
          : this.httpPost(`/session/${this.sessionId}/abort`, {}));
      } catch { /* ignore */ }
      this.stopServer();
    };

    return { write, stop };
  }

  private async startServer(): Promise<void> {
    return new Promise((resolve, reject) => {
      const args = ['serve', '--port', '0', '--hostname', '127.0.0.1'];
      this.serverProcess = spawn('opencode', args, {
        cwd: this.projectPath,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env as Record<string, string> },
      });

      let resolved = false;
      let portFound = false;
      let outputBuf = '';

      const onOutput = (data: Buffer) => {
        outputBuf += data.toString();

        // 2.x prints the Basic-auth password right after the listen line.
        const pwMatch = outputBuf.match(/server password (\S+)/);
        if (pwMatch) this.serverPassword = pwMatch[1];

        if (portFound) return;
        const portMatch = outputBuf.match(/listening on https?:\/\/[\d.]+:(\d+)/);
        if (!portMatch) return;

        portFound = true;
        this.port = parseInt(portMatch[1], 10);
        this.baseUrl = `http://127.0.0.1:${this.port}`;

        // Give the password line (printed immediately after "listening") a
        // moment to arrive before deciding which API generation this is.
        const settle = this.serverPassword ? 0 : 350;
        setTimeout(() => {
          if (resolved) return;
          this.isV2 = Boolean(this.serverPassword);
          this.apiPrefix = this.isV2 ? '/api' : '';
          resolved = true;
          console.log(
            `[baton] opencode-sdk: server started on port ${this.port} (api v${this.isV2 ? 2 : 1})`,
          );
          resolve();
        }, settle);
      };

      this.serverProcess.stdout?.on('data', onOutput);
      this.serverProcess.stderr?.on('data', onOutput);

      this.serverProcess.on('error', (err) => {
        console.error('[baton] opencode-sdk: server error:', err);
        if (!resolved) {
          resolved = true;
          reject(err);
        }
      });

      this.serverProcess.on('exit', (code) => {
        console.log(`[baton] opencode-sdk: server exited with code ${code}`);
        this.stopPolling();
        if (!resolved) {
          resolved = true;
          reject(new Error(`Server exited with code ${code}`));
        }
      });

      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          reject(new Error('Server startup timed out'));
        }
      }, 15000);
    });
  }

  private stopServer(): void {
    this.stopPolling();
    if (this.serverProcess) {
      this.serverProcess.kill();
      this.serverProcess = null;
    }
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private requestHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.isV2 && this.serverPassword) {
      headers.Authorization =
        'Basic ' + Buffer.from(`opencode:${this.serverPassword}`).toString('base64');
    }
    return headers;
  }

  /** opencode 2.x wraps responses as `{ data }`; 1.x returns payloads bare. */
  private unwrap<T>(payload: unknown): T {
    if (payload && typeof payload === 'object' && 'data' in payload) {
      return (payload as { data: T }).data;
    }
    return payload as T;
  }

  private async httpPost(path: string, body: unknown): Promise<Record<string, unknown>> {
    const res = await fetch(`${this.baseUrl}${this.apiPrefix}${path}`, {
      method: 'POST',
      headers: this.requestHeaders(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${text}`);
    }
    // Accepted async calls (1.x prompt_async, 2.x permission replies) may
    // answer 204 No Content — res.json() would throw on the empty body.
    const text = await res.text();
    if (!text) return {};
    return JSON.parse(text) as Record<string, unknown>;
  }

  private async httpGet(path: string): Promise<unknown> {
    const res = await fetch(`${this.baseUrl}${this.apiPrefix}${path}`, {
      headers: this.requestHeaders(),
    });
    if (!res.ok) return null;
    const text = await res.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  private pollEvents(onEvent: (event: ParsedEvent) => void): void {
    let lastMessageCount = 0;

    const poll = async () => {
      if (!this.sessionId || !this.baseUrl) return;

      try {
        const result = await this.httpGet(`/session/${this.sessionId}/message`);
        if (!result) return;

        if (this.isV2) {
          const messages = this.extractMessages(result);
          // 2.x returns newest-first; process oldest-first so text and tool
          // events land in conversational order.
          messages.sort((a, b) => (a.time?.created ?? 0) - (b.time?.created ?? 0));
          for (const msg of messages) this.processV2Message(msg, onEvent);
          return;
        }

        const messages = Array.isArray(result)
          ? result as OcMessage[]
          : (result as { messages?: OcMessage[] }).messages;
        if (!messages) return;
        if (messages.length <= lastMessageCount) return;

        const newMessages = messages.slice(lastMessageCount);
        lastMessageCount = messages.length;

        for (const msg of newMessages) {
          this.processMessage(msg, onEvent);
        }
      } catch (err) {
        console.error('[baton] opencode-sdk: poll error:', err);
      }
    };

    this.pollTimer = setInterval(poll, 500);
    this.serverProcess?.on('exit', () => this.stopPolling());
  }

  private extractMessages(result: unknown): OcMessage[] {
    if (Array.isArray(result)) return result as OcMessage[];
    const record = result as { data?: OcMessage[]; messages?: OcMessage[] };
    return record.data ?? record.messages ?? [];
  }

  private processMessage(msg: OcMessage, onEvent: (event: ParsedEvent) => void): void {
    if (msg.role === 'user') return;

    const parts = msg.parts ?? [];
    for (const part of parts) {
      const ptype = part.type ?? '';


      if (ptype === 'text' && part.text) {
        onEvent({
          type: 'raw_output',
          content: part.text,
          timestamp: Date.now(),
        });
      } else if (ptype === 'reasoning' && part.text) {
        onEvent({
          type: 'thinking',
          content: part.text,
          timestamp: Date.now(),
        });
      } else if (ptype === 'step-start') {
        onEvent({ type: 'status_change', status: 'running', timestamp: Date.now() });
      } else if (ptype === 'step-finish') {
      } else if (ptype === 'tool' && part.tool && part.state) {
        const toolName = part.tool;
        const state = part.state;
        const input = state.input ?? {};
        const output = state.output ?? '';


        if (toolName === 'bash' || toolName === 'Bash') {
          onEvent({
            type: 'command_exec',
            command: (input.command as string) ?? '',
            output,
            exitCode: (state.metadata?.exit as number) ?? (state.status === 'completed' ? 0 : undefined),
            isStreaming: state.status !== 'completed',
            timestamp: Date.now(),
          });
        } else if (['read', 'write', 'edit', 'glob', 'grep'].includes(toolName)) {
          const filePath =
            (input.filePath as string) ??
            (input.file_path as string) ??
            (input.path as string) ?? '';
          if (filePath && (toolName === 'write' || toolName === 'edit')) {
            onEvent({
              type: 'file_change',
              path: filePath,
              changeType: toolName === 'write' ? 'create' : 'modify',
              timestamp: Date.now(),
            });
          }
          onEvent({
            type: 'tool_use',
            tool: toolName,
            args: input,
            timestamp: Date.now(),
          });
        } else {
          onEvent({
            type: 'tool_use',
            tool: toolName,
            args: input,
            timestamp: Date.now(),
          });
        }
      } else if (ptype === 'patch') {
        const files = part.files;
        if (Array.isArray(files) && files.length > 0) {
          onEvent({
            type: 'raw_output',
            content: `[patch] ${files.length} file(s) changed: ${(files as string[]).map((f) => f.split('/').pop()).join(', ')}`,
            timestamp: Date.now(),
          });
        }
      }
    }
  }

  /**
   * opencode 2.x messages: `{ type: 'assistant', content: [...] }` whose text
   * and tool state grow while the turn streams. Emit text as deltas and each
   * tool once at start and once at completion so a 500ms poll never duplicates
   * content.
   */
  private processV2Message(msg: OcMessage, onEvent: (event: ParsedEvent) => void): void {
    if (msg.type === 'user') return;

    if (msg.type === 'idle') {
      if (this.seenIdle.has(msg.id)) return;
      this.seenIdle.add(msg.id);
      if (msg.outcome === 'failed') {
        onEvent({ type: 'error', message: 'OpenCode turn failed', timestamp: Date.now() });
        onEvent({ type: 'status_change', status: 'error', timestamp: Date.now() });
      } else {
        onEvent({ type: 'status_change', status: 'idle', timestamp: Date.now() });
      }
      return;
    }

    if (msg.type !== 'assistant' && msg.role !== 'assistant') return;

    let progress = this.assistantProgress.get(msg.id);
    if (!progress) {
      progress = {
        text: new Map(),
        reasoning: new Map(),
        tools: new Set(),
        finishedTools: new Set(),
      };
      this.assistantProgress.set(msg.id, progress);
    }

    const parts = msg.content ?? msg.parts ?? [];
    parts.forEach((part, index) => {
      const ptype = part.type ?? '';

      if (ptype === 'text') {
        const text = part.text ?? '';
        const emitted = progress.text.get(index) ?? 0;
        if (text.length > emitted) {
          onEvent({
            type: 'raw_output',
            content: text.slice(emitted),
            timestamp: Date.now(),
          });
          progress.text.set(index, text.length);
        }
        return;
      }

      if (ptype === 'reasoning') {
        const text = part.text ?? '';
        const emitted = progress.reasoning.get(index) ?? 0;
        if (text.length > emitted) {
          onEvent({
            type: 'thinking',
            content: text.slice(emitted),
            timestamp: Date.now(),
          });
          progress.reasoning.set(index, text.length);
        }
        return;
      }

      if (ptype !== 'tool') return;

      const toolName = part.name ?? part.tool ?? '';
      if (!toolName) return;
      const toolKey = part.id ?? part.callID ?? `idx-${index}`;
      const state = part.state;
      const input = state?.input ?? {};

      if (!progress.tools.has(toolKey)) {
        progress.tools.add(toolKey);

        if (toolName === 'write' || toolName === 'edit') {
          const filePath =
            (input.filePath as string) ??
            (input.file_path as string) ??
            (input.path as string) ?? '';
          if (filePath) {
            onEvent({
              type: 'file_change',
              path: filePath,
              changeType: toolName === 'write' ? 'create' : 'modify',
              timestamp: Date.now(),
            });
          }
        }

        onEvent({
          type: 'tool_use',
          tool: toolName,
          args: input,
          timestamp: Date.now(),
        });
      }

      const status = state?.status ?? (state?.metadata?.status as string | undefined);
      const isDone = status === 'completed' || status === 'error';
      if (isDone && !progress.finishedTools.has(toolKey)) {
        progress.finishedTools.add(toolKey);
        const output = this.toolOutput(part);

        if (toolName === 'bash' || toolName === 'shell' || toolName === 'Bash') {
          onEvent({
            type: 'command_exec',
            command: (input.command as string) ?? '',
            output,
            exitCode:
              (state?.metadata?.exit as number) ??
              (status === 'completed' ? 0 : undefined),
            isStreaming: false,
            timestamp: Date.now(),
          });
        } else if (status === 'error') {
          onEvent({
            type: 'error',
            message: `${toolName} failed${output ? `: ${output.slice(0, 500)}` : ''}`,
            timestamp: Date.now(),
          });
        }
      }
    });
  }

  private toolOutput(part: OcPart): string {
    if (part.state?.content) {
      return part.state.content.map((c) => c.text ?? '').join('');
    }
    return part.state?.output ?? '';
  }

  async approve(_reason?: string): Promise<void> {
    await this.replyPermission('once');
  }

  async reject(_reason?: string): Promise<void> {
    await this.replyPermission('reject');
  }

  /**
   * 2.x: list pending requests for this session, then reply with a
   * `decision` of 'once' | 'always' | 'reject' (Permission.Reply).
   * 1.x kept the old outcome-based pair of endpoints.
   */
  private async replyPermission(decision: 'once' | 'reject'): Promise<void> {
    try {
      if (this.isV2) {
        const list = this.unwrap<Array<{ id?: string }>>(
          await this.httpGet(`/session/${this.sessionId}/permission`),
        );
        const request = Array.isArray(list) ? list[0] : undefined;
        if (request?.id) {
          await this.httpPost(
            `/session/${this.sessionId}/permission/${request.id}/reply`,
            { decision },
          );
        }
        return;
      }

      const permissions = await this.httpGet('/permission/') as Array<{ requestID: string }> | null;
      if (permissions && permissions.length > 0) {
        await this.httpPost(`/permission/${permissions[0].requestID}/reply`, {
          outcome: decision === 'once' ? 'approve' : 'reject',
        });
      }
    } catch { /* ignore */ }
  }

  async listModels(): Promise<string[]> {
    try {
      const raw = execSync('opencode models 2>/dev/null', {
        encoding: 'utf-8',
        timeout: 15000,
      });
      return raw.split('\n').map((l) => l.trim()).filter(Boolean);
    } catch {
      return [];
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
      // Arg-array exec: count sanitized to a positive integer.
      const n = Math.max(1, Math.floor(Number(count) || 1));
      return execFileSync('git', ['log', '--oneline', `-${n}`], {
        cwd: this.projectPath, encoding: 'utf-8', timeout: 5000,
      }).trim();
    } catch { return ''; }
  }

  async gitCheckout(branch: string): Promise<{ success: boolean; error?: string }> {
    if (!isSafeGitRef(branch)) return { success: false, error: 'Invalid branch name' };
    try {
      // Arg-array exec — branch comes from the client and must never touch a shell.
      execFileSync('git', ['checkout', branch], {
        cwd: this.projectPath, encoding: 'utf-8', timeout: 10000,
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Checkout failed' };
    }
  }

  async gitCommit(message: string): Promise<{ success: boolean; error?: string }> {
    try {
      execFileSync('git', ['add', '-A'], { cwd: this.projectPath, encoding: 'utf-8', timeout: 10000 });
      // Message flows via stdin (-F -), never into argv — no quoting or
      // option-position concerns at all.
      execFileSync('git', ['commit', '-F', '-'], {
        cwd: this.projectPath,
        encoding: 'utf-8',
        timeout: 10000,
        input: message,
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
    if (!isSafeGitRef(name)) return { success: false, error: 'Invalid branch name' };
    try {
      execFileSync('git', ['checkout', '-b', name], {
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

export const opencodeSdkAdapter = new OpenCodeSdkAdapter();
