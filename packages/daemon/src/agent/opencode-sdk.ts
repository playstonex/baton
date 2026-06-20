import type { AgentConfig, ParsedEvent, SdkAgentAdapter, ThinkingConfig, ReasoningEffort, AccessMode, ServiceTier } from '@baton/shared';
import { execSync, spawn } from 'node:child_process';

type OcPart = {
  id?: string;
  type?: string;
  text?: string;
  tool?: string;
  callID?: string;
  snapshot?: string;
  hash?: string;
  files?: string[];
  time?: { start?: number; end?: number };
  state?: {
    status?: string;
    input?: Record<string, unknown>;
    output?: string;
    metadata?: Record<string, unknown>;
  };
};

type OcMessage = {
  id: string;
  role: string;
  parts?: OcPart[];
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

  detect(): boolean {
    try {
      execSync('which opencode', { stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }

  isSdkAvailable(): boolean {
    return this.detect();
  }

  async startSession(
    config: AgentConfig,
    onEvent: (event: ParsedEvent) => void,
  ): Promise<{ write: (input: string) => void; stop: () => Promise<void> }> {
    this.projectPath = config.projectPath;

    await this.startServer();

    const session = await this.httpPost('/session', { title: `baton-${Date.now()}` });
    this.sessionId = session.id as string;


    this.pollEvents(onEvent);

    onEvent({ type: 'status_change', status: 'running', timestamp: Date.now() });

    const write = (input: string) => {

      onEvent({ type: 'chat_message', role: 'user', content: input, timestamp: Date.now() });
      this.httpPost(`/session/${this.sessionId}/prompt_async`, {
        parts: [{ type: 'text', text: input }],
      }).catch((err) => {
        console.error('[baton] opencode-sdk: prompt_async error:', err);
        onEvent({ type: 'error', message: String(err), timestamp: Date.now() });
      });
    };

    const stop = async () => {

      try {
        await this.httpPost(`/session/${this.sessionId}/abort`, {});
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
      let outputBuf = '';

      this.serverProcess.stdout?.on('data', (data: Buffer) => {
        const text = data.toString();
        outputBuf += text;
        if (!resolved) {
          const portMatch = outputBuf.match(/listening on http:\/\/[\d.]+:(\d+)/);
          if (portMatch) {
            this.port = parseInt(portMatch[1], 10);
            this.baseUrl = `http://127.0.0.1:${this.port}`;
            resolved = true;
            console.log(`[baton] opencode-sdk: server started on port ${this.port}`);
            resolve();
          }
        }
      });

      this.serverProcess.stderr?.on('data', (data: Buffer) => {
        const text = data.toString();
        if (!resolved) {
          const portMatch = text.match(/listening on http:\/\/[\d.]+:(\d+)/);
          if (portMatch) {
            this.port = parseInt(portMatch[1], 10);
            this.baseUrl = `http://127.0.0.1:${this.port}`;
            resolved = true;
            resolve();
          }
        }
      });

      this.serverProcess.on('error', (err) => {
        console.error('[baton] opencode-sdk: server error:', err);
        if (!resolved) reject(err);
      });

      this.serverProcess.on('exit', (code) => {
        console.log(`[baton] opencode-sdk: server exited with code ${code}`);
        if (!resolved) reject(new Error(`Server exited with code ${code}`));
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
    if (this.serverProcess) {
      this.serverProcess.kill();
      this.serverProcess = null;
    }
  }

  private async httpPost(path: string, body: unknown): Promise<Record<string, unknown>> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${text}`);
    }
    return res.json() as Promise<Record<string, unknown>>;
  }

  private async httpGet(path: string): Promise<unknown> {
    const res = await fetch(`${this.baseUrl}${path}`);
    if (!res.ok) return null;
    return res.json();
  }

  private pollEvents(onEvent: (event: ParsedEvent) => void): void {
    let lastMessageCount = 0;

    const poll = async () => {
      if (!this.sessionId || !this.baseUrl) return;

      try {
        const result = await this.httpGet(`/session/${this.sessionId}/message`);
        if (!result) return;

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

    const interval = setInterval(poll, 500);

    const stopPolling = () => clearInterval(interval);
    this.serverProcess?.on('exit', stopPolling);
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

  async approve(_reason?: string): Promise<void> {
    try {
      const permissions = await this.httpGet('/permission/') as Array<{ requestID: string }> | null;
      if (permissions && permissions.length > 0) {
        await this.httpPost(`/permission/${permissions[0].requestID}/reply`, { outcome: 'approve' });
      }
    } catch { /* ignore */ }
  }

  async reject(_reason?: string): Promise<void> {
    try {
      const permissions = await this.httpGet('/permission/') as Array<{ requestID: string }> | null;
      if (permissions && permissions.length > 0) {
        await this.httpPost(`/permission/${permissions[0].requestID}/reply`, { outcome: 'reject' });
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

export const opencodeSdkAdapter = new OpenCodeSdkAdapter();
