import type { AgentConfig, ParsedEvent, SdkAgentAdapter, ReasoningEffort, AccessMode, ServiceTier } from '@baton/shared';
import { execSync } from 'node:child_process';
import { spawn } from 'node:child_process';

// ── JSON-RPC types for codex app-server ────────────────────────────

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

type JsonRpcMessage = JsonRpcResponse | JsonRpcNotification;

function isResponse(msg: JsonRpcMessage): msg is JsonRpcResponse {
  return 'id' in msg && typeof msg.id === 'number' && ('result' in msg || 'error' in msg);
}

function isRequest(msg: JsonRpcMessage): msg is JsonRpcRequest {
  return 'id' in msg && typeof msg.id === 'number' && 'method' in msg && !('result' in msg) && !('error' in msg);
}

// ── Codex SDK Adapter ──────────────────────────────────────────────

export class CodexSdkAdapter implements SdkAgentAdapter {
  readonly name = 'Codex (SDK)';
  readonly agentType = 'codex-sdk' as const;

  private process: ReturnType<typeof spawn> | null = null;
  private rpcId = 0;
  private threadId: string | null = null;
  private turnId: string | null = null;
  private pendingResolves = new Map<number, { resolve: (value: unknown) => void; reject: (err: Error) => void }>();
  private pendingServerRequests = new Map<number, { method: string; threadId: string }>();
  private buffer = '';
  private onEvent: ((event: ParsedEvent) => void) | null = null;
  private agentTextBuffer = '';
  private pendingApprovalEventId: string | null = null;
  private resolvedApprovalIds = new Set<number>();
  /** Throttle raw_output emission — buffer deltas and flush on a timer. */
  private rawOutputBuffer = '';
  private rawOutputFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private rawOutputItemId: string | undefined = undefined;
  /** Track active commandExecution items by itemId so started/delta/completed
   *  all reference the same logical command instead of creating duplicates. */
  private activeCommandsByItemId = new Map<string, { command: string; output: string; isStreaming: boolean }>();
  /** Deduplicate turn/diff/updated by caching the last emitted diff content per turnId. */
  private lastEmittedDiffByTurnId = new Map<string, string>();
  selectedModel: string | null = null;
  selectedReasoningEffort: ReasoningEffort | null = null;
  selectedAccessMode: AccessMode = 'on-request';
  selectedServiceTier: ServiceTier = 'default';
  private projectPath: string = process.cwd();

  isSdkAvailable(): boolean {
    return true;
  }

  detect(): boolean {
    try {
      execSync('which codex', { stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }

  async startSession(
    config: AgentConfig,
    onEvent: (event: ParsedEvent) => void,
  ): Promise<{ write: (input: string) => void; stop: () => Promise<void> }> {
    this.onEvent = onEvent;
    this.rpcId = 0;
    this.threadId = null;
    this.turnId = null;
    this.buffer = '';
    this.agentTextBuffer = '';
    this.activeCommandsByItemId.clear();
    this.lastEmittedDiffByTurnId.clear();
    if (this.rawOutputFlushTimer) { clearTimeout(this.rawOutputFlushTimer); this.rawOutputFlushTimer = null; }
    this.rawOutputBuffer = '';
    this.pendingResolves.clear();

    this.projectPath = config.projectPath ?? process.cwd();
    const env = { ...process.env as Record<string, string>, ...(config.env ?? {}) };

    console.log(`[baton] codex-sdk: spawning codex app-server (cwd=${this.projectPath})`);

    this.process = spawn('codex', ['app-server'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: this.projectPath,
      env,
    });

    this.process.stdout!.on('data', (chunk: Buffer) => {
      this.buffer += chunk.toString('utf-8');
      const lines = this.buffer.split('\n');
      this.buffer = lines.pop()!; // keep incomplete line

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        try {
          const msg = JSON.parse(trimmed) as JsonRpcMessage;
          this.handleMessage(msg);
        } catch {
          // not JSON — ignore raw output
        }
      }
    });

    this.process.stderr!.on('data', (chunk: Buffer) => {
      console.error(`[baton] codex-sdk stderr: ${chunk.toString('utf-8').trim()}`);
    });

    this.process.on('exit', (code) => {
      console.log(`[baton] codex-sdk: process exited with code ${code}`);
      if (this.onEvent) {
        this.onEvent({ type: 'status_change', status: 'stopped', timestamp: Date.now() });
      }
    });

    this.process.on('error', (err) => {
      console.error(`[baton] codex-sdk: process error:`, err);
      if (this.onEvent) {
        this.onEvent({ type: 'error', message: err.message, timestamp: Date.now() });
      }
    });

    // Send initialize handshake (required by codex app-server before any other request)
    const initResult = await this.sendRequest('initialize', {
      clientInfo: { name: 'baton', title: 'Baton', version: '0.1.0' },
      capabilities: { experimentalApi: true },
    });
    console.log(`[baton] codex-sdk: initialized, response=`, JSON.stringify(initResult));

    const write = (input: string) => {
      this.handleWrite(input);
    };

    const stop = async () => {
      console.log('[baton] codex-sdk: stop() called');
      if (this.turnId && this.threadId) {
        try {
          await this.sendRequest('turn/interrupt', {
            threadId: this.threadId,
            turnId: this.turnId,
          });
        } catch {
          // ignore — best effort
        }
      }
      this.process?.kill('SIGTERM');
    };

    return { write, stop };
  }

  async approve(reason?: string): Promise<void> {
    if (this.pendingServerRequests.size > 0) {
      const [reqId] = this.pendingServerRequests.entries().next().value ?? [];
      if (reqId != null) {
        this.pendingServerRequests.delete(reqId);
        this.resolvedApprovalIds.add(reqId);
        this.sendResponse(reqId, { decision: 'accept', reason: reason ?? 'Approved via Baton' });
        this.pendingApprovalEventId = null;
        this.onEvent?.({ type: 'status_change', status: 'running', timestamp: Date.now() });
        return;
      }
    }
    if (!this.threadId || !this.pendingApprovalEventId) return;
    try {
      await this.sendRequest('thread/approveGuardianDeniedAction', {
        threadId: this.threadId,
        event: this.pendingApprovalEventId,
        reason: reason ?? 'Approved via Baton',
        remember: true,
      });
      this.pendingApprovalEventId = null;
      this.onEvent?.({ type: 'status_change', status: 'running', timestamp: Date.now() });
    } catch (err) {
      console.error('[baton] codex-sdk: approve error:', err);
    }
  }

  async reject(reason?: string): Promise<void> {
    if (this.pendingServerRequests.size > 0) {
      const [reqId] = this.pendingServerRequests.entries().next().value ?? [];
      if (reqId != null) {
        this.pendingServerRequests.delete(reqId);
        this.resolvedApprovalIds.add(reqId);
        this.sendResponse(reqId, { decision: 'reject', reason: reason ?? 'Rejected via Baton' });
        this.pendingApprovalEventId = null;
        this.onEvent?.({ type: 'status_change', status: 'running', timestamp: Date.now() });
        return;
      }
    }
    if (!this.threadId || !this.pendingApprovalEventId) return;
    try {
      await this.sendRequest('thread/approveGuardianDeniedAction', {
        threadId: this.threadId,
        event: this.pendingApprovalEventId,
        reason: reason ?? 'Rejected via Baton',
        approve: false,
      });
      this.pendingApprovalEventId = null;
      this.onEvent?.({ type: 'status_change', status: 'running', timestamp: Date.now() });
    } catch (err) {
      console.error('[baton] codex-sdk: reject error:', err);
    }
  }

  async listModels(): Promise<string[]> {
    if (!this.process?.stdin?.writable) return [];
    try {
      const result = await this.sendRequest('model/list', {}) as Record<string, unknown>;
      const items = (result?.data ?? result?.models) as Array<Record<string, unknown>> ?? [];
      return items.map((m) => (m.id ?? m.name ?? '') as string).filter(Boolean);
    } catch (err) {
      console.error('[baton] codex-sdk: listModels error:', err);
      return [];
    }
  }

  // ── Write logic: turn/start or turn/steer ────────────────────────

  private handleWrite(input: string): void {
    if (!this.onEvent) return;

    console.log(`[baton] codex-sdk: write() called, input="${input.slice(0, 60)}" threadId=${this.threadId} turnId=${this.turnId}`);

    // Emit user message event so the UI shows what the user sent
    this.onEvent({ type: 'chat_message', role: 'user', content: input, timestamp: Date.now() });

    if (!this.threadId) {
      this.startThreadAndTurn(input);
    } else if (this.turnId) {
      this.steerTurn(input);
    } else {
      this.startTurn(input);
    }
  }

  private async startThreadAndTurn(userInput: string): Promise<void> {
    try {
      const threadResult = await this.sendRequest('thread/start', {
        experimentalRawEvents: false,
        persistExtendedHistory: false,
      }) as Record<string, unknown>;
      // Response: { thread: { id: "...", ... }, model: "...", ... }
      const thread = threadResult?.thread as Record<string, unknown> | undefined;
      this.threadId = (thread?.id ?? threadResult?.threadId) as string | null;
      console.log(`[baton] codex-sdk: thread started, threadId=${this.threadId}`);

      if (!this.threadId) {
        this.onEvent?.({ type: 'error', message: 'Failed to create thread', timestamp: Date.now() });
        return;
      }

      await this.startTurn(userInput);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[baton] codex-sdk: startThreadAndTurn error:`, msg);
      this.onEvent?.({ type: 'error', message: msg, timestamp: Date.now() });
    }
  }

  private async startTurn(userInput: string): Promise<void> {
    if (!this.threadId) return;

    try {
      const turnParams: Record<string, unknown> = {
        threadId: this.threadId,
        input: [{ type: 'text', text: userInput, text_elements: [] }],
      };
      if (this.selectedModel) {
        turnParams.model = this.selectedModel;
      } else {
        turnParams.model = 'gpt-5.4';
      }
      if (this.selectedReasoningEffort) {
        turnParams.effort = this.selectedReasoningEffort;
      }
      if (this.selectedServiceTier && this.selectedServiceTier !== 'default') {
        turnParams.serviceTier = this.selectedServiceTier;
      }
      if (this.selectedAccessMode === 'full-access') {
        turnParams.sandboxPolicy = { type: 'dangerFullAccess' };
      } else {
        turnParams.sandboxPolicy = { type: 'workspaceWrite', networkAccess: true };
      }

      const result = await this.sendRequest('turn/start', turnParams) as Record<string, unknown>;

      // Response: { turn: { id: "...", status: "..." } }
      const turn = result?.turn as Record<string, unknown> | undefined;
      this.turnId = (turn?.id ?? result?.turnId) as string | null;
      console.log(`[baton] codex-sdk: turn started, turnId=${this.turnId}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[baton] codex-sdk: startTurn error:`, msg);
      this.onEvent?.({ type: 'error', message: msg, timestamp: Date.now() });
    }
  }

  private async steerTurn(userInput: string): Promise<void> {
    if (!this.threadId || !this.turnId) return;

    try {
      const result = await this.sendRequest('turn/steer', {
        threadId: this.threadId,
        expectedTurnId: this.turnId,
        input: [{ type: 'text', text: userInput, text_elements: [] }],
      }) as Record<string, unknown>;

      // turn/steer may return a new turnId
      const newTurnId = (result?.turnId ?? result?.turn_id ?? result?.id) as string | null;
      if (newTurnId) this.turnId = newTurnId;
      console.log(`[baton] codex-sdk: steer sent, turnId=${this.turnId}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[baton] codex-sdk: steerTurn error:`, msg);
      this.onEvent?.({ type: 'error', message: msg, timestamp: Date.now() });
    }
  }

  // ── JSON-RPC transport ───────────────────────────────────────────

  private sendRequest(method: string, params: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = ++this.rpcId;
      const req: JsonRpcRequest = { jsonrpc: '2.0', id, method, params };
      const payload = JSON.stringify(req) + '\n';

      if (!this.process?.stdin?.writable) {
        reject(new Error('codex process stdin not writable'));
        return;
      }

      this.pendingResolves.set(id, { resolve, reject });
      this.process.stdin.write(payload);

      // Timeout after 60s
      setTimeout(() => {
        if (this.pendingResolves.delete(id)) {
          reject(new Error(`JSON-RPC request timed out: ${method} (id=${id})`));
        }
      }, 60_000);
    });
  }

  private sendResponse(id: number, result: Record<string, unknown>): void {
    const payload = JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n';
    this.process?.stdin?.write(payload);
  }

  // Handle JSON-RPC requests FROM Codex (approval requests, user input requests, etc.)
  private handleServerRequest(req: JsonRpcRequest): void {
    console.log(`[baton] codex-sdk: server request method=${req.method} id=${req.id}`);
    const method = req.method;
    const params = (req.params ?? {}) as Record<string, unknown>;
    const threadId = params.threadId as string ?? '';

    if (method === 'item/fileChange/requestApproval'
        || method === 'item/commandExecution/requestApproval'
        || method === 'item/tool/requestUserInput'
        || method.includes('requestApproval')) {
      if (this.resolvedApprovalIds.has(req.id)) return;
      this.pendingServerRequests.set(req.id, { method, threadId });
      this.pendingApprovalEventId = params.event as string ?? null;
      const toolName = params.toolName ?? params.name ?? method.split('/').pop() ?? 'unknown';
      const detail = params.description ?? params.message ?? params.path ?? '';
      this.onEvent?.({
        type: 'waiting_approval',
        timestamp: Date.now(),
        meta: { toolName: String(toolName), detail: String(detail), requestId: req.id },
      } as ParsedEvent & { meta: Record<string, unknown> });
      return;
    }

    this.sendResponse(req.id, {});
  }

  // ── Handle incoming JSON-RPC messages ────────────────────────────

  private handleMessage(msg: JsonRpcMessage): void {
    // Handle responses (to our outgoing requests)
    if (isResponse(msg)) {
      const pending = this.pendingResolves.get(msg.id);
      if (pending) {
        this.pendingResolves.delete(msg.id);
        if (msg.error) {
          pending.reject(new Error(msg.error.message));
        } else {
          pending.resolve(msg.result);
        }
      }
      return;
    }

    // Handle server requests (Codex asking us to do something, like approval)
    if (isRequest(msg)) {
      this.handleServerRequest(msg as JsonRpcRequest);
      return;
    }

    // Handle notifications (server-pushed events)
    const method = (msg as JsonRpcNotification).method ?? '';
    const params = ((msg as JsonRpcNotification).params ?? {}) as Record<string, unknown>;

    if (method !== 'item/agentMessage/delta') {
      console.log(`[baton] codex-sdk: notification method=${method} params=${JSON.stringify(params).slice(0, 200)}`);
    }

    switch (method) {
      case 'thread/status/changed': {
        const params2 = (msg as JsonRpcNotification).params as Record<string, unknown>;
        const status = params2.status as Record<string, unknown> | undefined;
        const activeFlags = status?.activeFlags as string[] | undefined;
        if (activeFlags?.includes('waitingOnApproval')) {
          this.onEvent?.({ type: 'waiting_approval', timestamp: Date.now() });
          break;
        }
        const statusType = (status?.type ?? params2.type) as string | undefined;
        if (statusType === 'active') {
          this.onEvent?.({ type: 'status_change', status: 'running', timestamp: Date.now() });
        }
        break;
      }
      case 'turn/started':
        this.handleTurnStarted(params);
        break;
      case 'turn/completed':
        this.handleTurnCompleted(params);
        break;
      case 'turn/failed':
        this.handleTurnFailed(params);
        break;
      case 'item/agentMessage/delta':
      case 'codex/event/agent_message_content_delta':
      case 'codex/event/agent_message_delta':
        this.handleAgentMessageDelta(params);
        break;
      case 'item/toolCall/outputDelta':
      case 'item/toolCall/output_delta':
      case 'item/tool_call/outputDelta':
      case 'item/tool_call/output_delta':
        this.handleToolCallDelta(params);
        break;
      case 'item/reasoning/summaryTextDelta':
      case 'item/reasoning/summaryPartAdded':
      case 'item/reasoning/textDelta':
        this.handleReasoningDelta(params);
        break;
      case 'item/commandExecution/outputDelta':
      case 'command/exec/outputDelta':
      case 'item/command_execution/outputDelta':
        this.handleCommandDelta(params);
        break;
      case 'item/commandExecution/terminalInteraction':
      case 'item/command_execution/terminalInteraction':
        this.handleCommandTerminalInteraction(params);
        break;
      case 'item/fileChange/outputDelta':
        this.handleFileChangeDelta(params);
        break;
      case 'item/started':
      case 'codex/event/item_started':
        this.handleItemStarted(params);
        break;
      case 'item/completed':
      case 'codex/event/item_completed':
      case 'codex/event/agent_message':
        this.handleItemCompleted(params);
        break;
      case 'turn/plan/updated':
        this.handlePlanUpdated(params);
        break;
      case 'item/plan/delta':
        this.handlePlanDelta(params);
        break;
      case 'thread/tokenUsage/updated':
        this.handleTokenUsage(params);
        break;
      case 'turn/diff/updated':
      case 'codex/event/turn_diff_updated':
      case 'codex/event/turn_diff':
        this.handleDiffUpdated(params);
        break;
      case 'codex/event/exec_command_begin':
        this.handleLegacyCommandBegin(params);
        break;
      case 'codex/event/exec_command_output_delta':
        this.handleLegacyCommandOutputDelta(params);
        break;
      case 'codex/event/exec_command_end':
        this.handleLegacyCommandEnd(params);
        break;
      case 'item/tool/requestUserInput':
        this.handleStructuredUserInput(params);
        break;
      case 'error': {
        const message = (params.message ?? 'Unknown error') as string;
        this.onEvent?.({ type: 'error', message, timestamp: Date.now() });
        break;
      }
      default:
        break;
    }
  }

  // ── Notification handlers ────────────────────────────────────────

  private handleTurnStarted(params: Record<string, unknown>): void {
    const turn = params.turn as Record<string, unknown> | undefined;
    const turnId = (turn?.id ?? params.turnId) as string | undefined;
    if (turnId) this.turnId = turnId;
    this.flushAgentText();
    if (this.rawOutputFlushTimer) { clearTimeout(this.rawOutputFlushTimer); this.rawOutputFlushTimer = null; }
    this.rawOutputBuffer = '';
    this.onEvent?.({ type: 'status_change', status: 'running', timestamp: Date.now() });
    console.log(`[baton] codex-sdk: turn/started, turnId=${turnId}`);
  }

  private handleTurnCompleted(params: Record<string, unknown>): void {
    this.flushAgentText();
    this.activeCommandsByItemId.clear();
    this.lastEmittedDiffByTurnId.delete(this.turnId ?? '');
    this.pendingServerRequests.clear();
    this.pendingApprovalEventId = null;
    this.resolvedApprovalIds.clear();
    const turn = params.turn as Record<string, unknown> | undefined;
    const turnId = (turn?.id ?? params.turnId) as string | undefined;
    if (turnId && this.turnId === turnId) this.turnId = null;
    this.onEvent?.({ type: 'status_change', status: 'idle', timestamp: Date.now() });
    console.log(`[baton] codex-sdk: turn/completed`);
  }

  private handleTurnFailed(params: Record<string, unknown>): void {
    this.flushAgentText();
    this.activeCommandsByItemId.clear();
    this.lastEmittedDiffByTurnId.delete(this.turnId ?? '');
    this.pendingServerRequests.clear();
    this.pendingApprovalEventId = null;
    this.resolvedApprovalIds.clear();
    const turn = params.turn as Record<string, unknown> | undefined;
    const error = turn?.error as Record<string, unknown> | undefined;
    const message = (error?.message ?? params.error ?? params.message ?? 'Turn failed') as string;
    this.onEvent?.({ type: 'error', message, timestamp: Date.now() });
    this.turnId = null;
    console.error(`[baton] codex-sdk: turn/failed: ${message}`);
  }

  private handleAgentMessageDelta(params: Record<string, unknown>): void {
    const delta = (params.delta ?? params.text ?? params.content ?? '') as string;
    const itemId = this.extractItemId(params);
    if (delta) this.agentTextBuffer += delta;
    if (!delta) return;

    this.rawOutputBuffer += delta;
    this.rawOutputItemId = itemId || undefined;

    if (!this.rawOutputFlushTimer) {
      this.rawOutputFlushTimer = setTimeout(() => {
        this.rawOutputFlushTimer = null;
        const content = this.rawOutputBuffer;
        const id = this.rawOutputItemId;
        this.rawOutputBuffer = '';
        this.rawOutputItemId = undefined;
        if (content) {
          this.onEvent?.({ type: 'raw_output', content, timestamp: Date.now(), itemId: id });
        }
      }, 60);
    }
  }

  private handleToolCallDelta(params: Record<string, unknown>): void {
    const toolName = (params.name ?? params.tool ?? params.toolName ?? 'unknown') as string;
    const output = (params.delta ?? params.output ?? '') as string;
    const itemId = this.extractItemId(params);
    if (toolName && toolName !== 'unknown') {
      this.onEvent?.({
        type: 'tool_use',
        tool: toolName,
        args: { output },
        timestamp: Date.now(),
        itemId: itemId || undefined,
      });
    }
  }

  private handleReasoningDelta(params: Record<string, unknown>): void {
    const delta = (params.delta ?? params.text ?? params.summary ?? '') as string;
    const itemId = this.extractItemId(params);
    if (delta) {
      this.onEvent?.({ type: 'thinking', content: delta, timestamp: Date.now(), itemId: itemId || undefined });
    }
  }

  private handleCommandDelta(params: Record<string, unknown>): void {
    const output = (params.delta ?? params.output ?? '') as string;
    const command = (params.command ?? '') as string;
    const itemId = this.extractItemId(params);
    if (this.isBareShellPrompt(output) && !command) return;
    if (!output && !command) return;

    if (itemId && this.activeCommandsByItemId.has(itemId)) {
      const tracked = this.activeCommandsByItemId.get(itemId)!;
      if (output) tracked.output += output;
      if (command) tracked.command = command;
      tracked.isStreaming = true;
      this.onEvent?.({
        type: 'command_exec',
        command: tracked.command,
        output: tracked.output,
        isStreaming: true,
        timestamp: Date.now(),
        itemId,
      });
      return;
    }

    this.onEvent?.({
      type: 'command_exec',
      command,
      output,
      isStreaming: true,
      timestamp: Date.now(),
      itemId: itemId || undefined,
    });
  }

  private handleFileChangeDelta(params: Record<string, unknown>): void {
    const path = (params.path ?? params.filePath ?? '') as string;
    const raw = (params.changeType ?? params.type ?? 'modify') as string;
    const changeType = raw === 'create' ? 'create' : raw === 'delete' ? 'delete' : 'modify';
    const itemId = this.extractItemId(params);
    if (path) {
      this.onEvent?.({ type: 'file_change', path, changeType, timestamp: Date.now(), itemId: itemId || undefined });
    }
  }

  private handleItemStarted(params: Record<string, unknown>): void {
    const item = params.item as Record<string, unknown> | undefined;
    if (!item) return;
    const itemType = item.type as string | undefined;
    const itemId = (item.id ?? '') as string;
    if (itemType === 'fileChange') {
      this.pendingApprovalEventId = itemId || null;
      console.log(`[baton] codex-sdk: tracking fileChange for approval, eventId=${this.pendingApprovalEventId}`);
    }
    if (itemType === 'commandExecution' && itemId) {
      const command = (item.command ?? '') as string;
      this.activeCommandsByItemId.set(itemId, { command, output: '', isStreaming: true });
    }
  }

  private handleItemCompleted(params: Record<string, unknown>): void {
    const item = params.item as Record<string, unknown> | undefined;
    if (!item) return;
    const itemType = item.type as string | undefined;
    const itemId = (item.id ?? '') as string;

    if (itemType === 'agentMessage') {
      this.flushAgentText();
    } else if (itemType === 'commandExecution') {
      const command = (item.command ?? '') as string;
      const exitCode = item.exitCode as number | undefined;
      const tracked = itemId ? this.activeCommandsByItemId.get(itemId) : undefined;
      const resolvedCommand = command || tracked?.command || '';
      const resolvedOutput = tracked?.output ?? '';
      this.onEvent?.({
        type: 'command_exec',
        command: resolvedCommand,
        output: resolvedOutput,
        exitCode,
        isStreaming: false,
        timestamp: Date.now(),
        itemId: itemId || undefined,
      });
      if (itemId) this.activeCommandsByItemId.delete(itemId);
    } else if (itemType === 'fileChange') {
      const changes = item.changes as Array<Record<string, unknown>> | undefined;
      if (changes && changes.length > 0) {
        for (const change of changes) {
          const path = (change.path ?? change.filePath ?? '') as string;
          const raw = (change.changeType ?? change.type ?? 'modify') as string;
          const changeType = raw === 'create' ? 'create' : raw === 'delete' ? 'delete' : 'modify';
          if (path) {
            this.onEvent?.({ type: 'file_change', path, changeType, timestamp: Date.now(), itemId: itemId || undefined });
          }
        }
      }
    }
  }

  private handlePlanUpdated(params: Record<string, unknown>): void {
    const explanation = (params.explanation ?? '') as string;
    const rawSteps = (params.steps ?? []) as Array<Record<string, unknown>>;
    const itemId = this.extractItemId(params);
    const steps = rawSteps.map((s) => ({
      step: String(s.step ?? s.description ?? ''),
      status: (s.status ?? 'pending') as 'pending' | 'in_progress' | 'completed',
    }));
    this.onEvent?.({
      type: 'plan',
      explanation,
      steps,
      presentation: 'progress',
      timestamp: Date.now(),
      itemId: itemId || undefined,
    });
  }

  private handlePlanDelta(params: Record<string, unknown>): void {
    const explanation = (params.delta ?? params.text ?? '') as string;
    const itemId = this.extractItemId(params);
    this.onEvent?.({
      type: 'plan',
      explanation,
      presentation: 'resultStreaming',
      timestamp: Date.now(),
      itemId: itemId || undefined,
    });
  }

  private handleTokenUsage(params: Record<string, unknown>): void {
    const usage = params.usage as Record<string, unknown> | undefined ?? params as Record<string, unknown>;
    const promptTokens = (usage.promptTokens ?? usage.prompt_tokens ?? 0) as number;
    const completionTokens = (usage.completionTokens ?? usage.completion_tokens ?? 0) as number;
    this.onEvent?.({
      type: 'token_usage',
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      timestamp: Date.now(),
    });
  }

  private handleDiffUpdated(params: Record<string, unknown>): void {
    const diff = (params.diff ?? '') as string;
    const path = (params.path ?? '') as string | undefined;
    const itemId = this.extractItemId(params);
    if (!diff) return;

    const dedupeKey = this.turnId ?? itemId ?? '';
    if (dedupeKey) {
      const lastDiff = this.lastEmittedDiffByTurnId.get(dedupeKey);
      if (lastDiff === diff) return;
      this.lastEmittedDiffByTurnId.set(dedupeKey, diff);
    }

    this.onEvent?.({ type: 'diff', diff, path: path || undefined, timestamp: Date.now(), itemId: itemId || undefined });
  }

  private handleCommandTerminalInteraction(params: Record<string, unknown>): void {
    const command = (params.command ?? '') as string;
    const itemId = this.extractItemId(params);
    if (!command || this.isBareShellPrompt(command)) return;

    if (itemId && !this.activeCommandsByItemId.has(itemId)) {
      this.activeCommandsByItemId.set(itemId, { command, output: '', isStreaming: true });
    } else if (itemId) {
      this.activeCommandsByItemId.get(itemId)!.command = command;
    }

    this.onEvent?.({
      type: 'command_exec',
      command,
      isStreaming: true,
      timestamp: Date.now(),
      itemId: itemId || undefined,
    });
  }

  private handleLegacyCommandBegin(params: Record<string, unknown>): void {
    const command = (params.command ?? '') as string;
    const itemId = this.extractItemId(params);
    if (!command || this.isBareShellPrompt(command)) return;

    if (itemId) {
      if (this.activeCommandsByItemId.has(itemId)) return;
      this.activeCommandsByItemId.set(itemId, { command, output: '', isStreaming: true });
    }

    this.onEvent?.({
      type: 'command_exec',
      command,
      isStreaming: true,
      timestamp: Date.now(),
      itemId: itemId || undefined,
    });
  }

  private handleLegacyCommandOutputDelta(params: Record<string, unknown>): void {
    const output = (params.delta ?? params.output ?? '') as string;
    const command = (params.command ?? '') as string;
    const itemId = this.extractItemId(params);
    if (this.isBareShellPrompt(output) && !command) return;
    if (!output && !command) return;

    if (itemId && this.activeCommandsByItemId.has(itemId)) {
      const tracked = this.activeCommandsByItemId.get(itemId)!;
      if (output) tracked.output += output;
      if (command) tracked.command = command;
      tracked.isStreaming = true;
      this.onEvent?.({
        type: 'command_exec',
        command: tracked.command,
        output: tracked.output,
        isStreaming: true,
        timestamp: Date.now(),
        itemId,
      });
      return;
    }

    this.onEvent?.({
      type: 'command_exec',
      command,
      output,
      isStreaming: true,
      timestamp: Date.now(),
      itemId: itemId || undefined,
    });
  }

  private handleLegacyCommandEnd(params: Record<string, unknown>): void {
    const command = (params.command ?? '') as string;
    const exitCode = params.exitCode as number | undefined;
    const itemId = this.extractItemId(params);
    if (!command || this.isBareShellPrompt(command)) return;

    const tracked = itemId ? this.activeCommandsByItemId.get(itemId) : undefined;
    const resolvedCommand = command || tracked?.command || '';

    this.onEvent?.({
      type: 'command_exec',
      command: resolvedCommand,
      output: tracked?.output ?? '',
      exitCode,
      isStreaming: false,
      timestamp: Date.now(),
      itemId: itemId || undefined,
    });

    if (itemId) this.activeCommandsByItemId.delete(itemId);
  }

  private handleStructuredUserInput(params: Record<string, unknown>): void {
    const rawQuestions = (params.questions ?? []) as Array<Record<string, unknown>>;
    const questions = rawQuestions.map((q) => ({
      id: String(q.id ?? ''),
      header: String(q.header ?? ''),
      question: String(q.question ?? ''),
      options: (q.options as Array<{ label: string; description: string }> | undefined) ?? undefined,
    }));
    if (questions.length > 0) {
      this.onEvent?.({ type: 'user_input_prompt', questions, timestamp: Date.now() });
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────

  /** Extract itemId from notification params. Codex uses either
   *  params.itemId or params.item.id depending on notification type. */
  private extractItemId(params: Record<string, unknown>): string {
    const direct = params.itemId as string | undefined;
    if (direct) return direct;
    const item = params.item as Record<string, unknown> | undefined;
    if (item?.id) return item.id as string;
    return '';
  }

  /** Check if a string is just a shell prompt character like "$", "#", ">" */
  private isBareShellPrompt(text: string): boolean {
    const trimmed = text.trim();
    if (!trimmed) return true;
    // Common shell prompt patterns: "$", "$ ", "# ", "> ", "$ Exit N"
    if (/^\$?\s*(Exit\s+\d+)?$/.test(trimmed)) return true;
    if (/^[#$>]\s*$/.test(trimmed)) return true;
    return false;
  }

  /** Silently clears the agent text buffer. handleAgentMessageDelta already
   *  emits raw_output for each delta, so emitting chat_message here would
   *  duplicate the entire response. */
  private flushAgentText(): void {
    this.agentTextBuffer = '';
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
        cwd: this.projectPath,
        encoding: 'utf-8',
        timeout: 5000,
      });
      const branches = raw.split('\n').map((b) => b.trim()).filter(Boolean);
      let currentBranch = '';
      try {
        currentBranch = execSync('git rev-parse --abbrev-ref HEAD', {
          cwd: this.projectPath,
          encoding: 'utf-8',
          timeout: 5000,
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

export const codexSdkAdapter = new CodexSdkAdapter();
