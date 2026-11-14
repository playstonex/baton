import type {
  AgentConfig,
  ChatImage,
  ModelInfo,
  ParsedEvent,
  PermissionMode,
  SdkAgentAdapter,
  ThinkingConfig,
  ReasoningEffort,
  AccessMode,
  ServiceTier,
} from '@baton/shared';
import { execSync, spawn } from 'node:child_process';

export const DEFAULT_ANTIGRAVITY_MODELS: ModelInfo[] = [
  {
    id: 'gemini-3.8-flash-high',
    name: 'Gemini 3.8 Flash (High)',
    description: 'Fast, high-reasoning Gemini model',
  },
  {
    id: 'gemini-3.8-flash-medium',
    name: 'Gemini 3.8 Flash (Medium)',
    description: 'Balanced speed and reasoning',
  },
  {
    id: 'gemini-3.8-flash-low',
    name: 'Gemini 3.8 Flash (Low)',
    description: 'Low-latency for quick tasks',
  },
  {
    id: 'claude-sonnet-4-6',
    name: 'Claude Sonnet 4.6 (Thinking)',
    description: 'Claude Sonnet with extended thinking',
  },
  {
    id: 'claude-opus-4-6-thinking',
    name: 'Claude Opus 4.6 (Thinking)',
    description: 'Claude Opus with deep reasoning',
  },
  {
    id: 'gpt-oss-120b-medium',
    name: 'GPT-OSS 120B (Medium)',
    description: 'Open-weights 120B model',
  },
];

interface JsonRpcMessage {
  jsonrpc: '2.0';
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: { code: number; message: string; data?: unknown };
}

/**
 * Antigravity SDK Adapter (Chat Mode).
 *
 * Google Antigravity CLI (`agy`) exposes a first-class Agent Client Protocol (ACP)
 * stdio server via `agy acp`. This adapter drives `agy acp` over JSON-RPC 2.0 stdio,
 * providing structured events (thinking, message chunks, tool calls, approvals, token usage)
 * without terminal escape residue.
 */
export class AntigravitySdkAdapter implements SdkAgentAdapter {
  readonly name = 'Antigravity (SDK)';
  readonly agentType = 'antigravity' as const;

  selectedModel: string | null = null;
  selectedReasoningEffort: ReasoningEffort | null = null;
  selectedAccessMode: AccessMode = 'on-request';
  selectedServiceTier: ServiceTier = 'default';
  permissionMode?: PermissionMode;

  private process: ReturnType<typeof spawn> | null = null;
  private sessionId: string | null = null;
  private msgIdCounter = 1;
  private lineBuffer = '';
  private onEvent: ((event: ParsedEvent) => void) | null = null;
  private pendingPermissions = new Map<
    number | string,
    {
      toolCallId?: string;
      options?: Array<{ optionId: string; name?: string; kind?: string }>;
    }
  >();
  private messageQueue: Array<{ text: string; images?: ChatImage[] }> = [];
  private availableModels: string[] = [];
  private modelDetails: ModelInfo[] = [];
  private currentPromptId: number | null = null;

  detect(): boolean {
    try {
      execSync('which agy', { stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }

  isSdkAvailable(): boolean {
    return this.detect();
  }

  listModels(): string[] {
    return this.availableModels.length > 0
      ? this.availableModels
      : DEFAULT_ANTIGRAVITY_MODELS.map((m) => m.id);
  }

  listModelDetails(): ModelInfo[] {
    return this.modelDetails.length > 0 ? this.modelDetails : DEFAULT_ANTIGRAVITY_MODELS;
  }

  setModel(modelId: string): void {
    this.selectedModel = modelId;
    if (this.sessionId && this.process) {
      this.send({
        jsonrpc: '2.0',
        id: this.msgIdCounter++,
        method: 'session/set_model',
        params: {
          sessionId: this.sessionId,
          modelId,
        },
      });
    }
  }

  setThinkingConfig(config: ThinkingConfig): void {
    if (config.level && config.level !== 'none') {
      this.selectedReasoningEffort = config.level as ReasoningEffort;
    }
    if (this.sessionId && this.process && config.level && config.level !== 'none') {
      this.send({
        jsonrpc: '2.0',
        id: this.msgIdCounter++,
        method: 'session/set_config_option',
        params: {
          sessionId: this.sessionId,
          configId: 'thought_level',
          value: config.level,
        },
      });
    }
  }

  buildSpawnConfig(): never {
    throw new Error('SDK mode does not use spawn config');
  }

  parseOutput(): ParsedEvent[] {
    return [];
  }

  private send(msg: Record<string, unknown>): void {
    if (this.process?.stdin && !this.process.stdin.destroyed) {
      this.process.stdin.write(JSON.stringify(msg) + '\n');
    }
  }

  async startSession(
    config: AgentConfig,
    onEvent: (event: ParsedEvent) => void,
  ): Promise<{ write: (input: string, images?: ChatImage[]) => void; stop: () => Promise<void> }> {
    this.onEvent = onEvent;
    this.sessionId = null;
    this.lineBuffer = '';
    this.pendingPermissions.clear();
    this.messageQueue = [];
    this.currentPromptId = null;
    if (config.permissionMode) {
      this.permissionMode = config.permissionMode;
    }

    const cwd = config.projectPath ?? process.cwd();
    const env = { ...(process.env as Record<string, string>), ...(config.env ?? {}) };

    const args = ['acp', ...(config.args ?? [])];
    this.process = spawn('agy', args, {
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
        console.error(`[baton] antigravity-sdk stderr: ${errText}`);
      }
    });

    this.process.on('exit', (code) => {
      console.log(`[baton] antigravity-sdk exited with code ${code}`);
      this.onEvent?.({ type: 'status_change', status: 'stopped', timestamp: Date.now() });
    });

    this.process.on('error', (err) => {
      this.onEvent?.({ type: 'error', message: err.message, timestamp: Date.now() });
      this.onEvent?.({ type: 'status_change', status: 'stopped', timestamp: Date.now() });
    });

    // Start JSON-RPC handshake
    this.send({
      jsonrpc: '2.0',
      id: this.msgIdCounter++,
      method: 'initialize',
      params: {
        protocolVersion: 1,
        clientCapabilities: { tools: true },
        clientInfo: { name: 'baton-daemon', version: '1.0.0' },
      },
    });

    const write = (input: string, images?: ChatImage[]) => {
      this.handleUserWrite(input, images);
    };

    const stop = async () => {
      if (this.sessionId && this.currentPromptId) {
        try {
          this.send({
            jsonrpc: '2.0',
            id: this.msgIdCounter++,
            method: 'session/cancel',
            params: { sessionId: this.sessionId },
          });
        } catch {
          // ignore
        }
      }
      if (this.process) {
        this.process.kill();
        this.process = null;
      }
    };

    return { write, stop };
  }

  private handleUserWrite(input: string, images?: ChatImage[]): void {
    const text = input.trim();
    if (!text && (!images || images.length === 0)) return;

    this.onEvent?.({
      type: 'chat_message',
      role: 'user',
      content: text || '(image)',
      timestamp: Date.now(),
    });
    this.onEvent?.({ type: 'status_change', status: 'thinking', timestamp: Date.now() });

    if (!this.sessionId) {
      this.messageQueue.push({ text, images });
      return;
    }

    const promptItems: Array<Record<string, unknown>> = [];
    if (text) {
      promptItems.push({ type: 'text', text });
    }
    if (images && images.length > 0) {
      for (const img of images) {
        promptItems.push({
          type: 'image',
          data: img.data,
          mimeType: img.mediaType,
        });
      }
    }

    const id = this.msgIdCounter++;
    this.currentPromptId = id;
    this.send({
      jsonrpc: '2.0',
      id,
      method: 'session/prompt',
      params: {
        sessionId: this.sessionId,
        prompt: promptItems,
      },
    });
  }

  private handleOutput(chunk: string): void {
    this.lineBuffer += chunk;
    const lines = this.lineBuffer.split('\n');
    this.lineBuffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      let msg: JsonRpcMessage;
      try {
        msg = JSON.parse(trimmed);
      } catch {
        continue; // Non-JSON noise/banners
      }

      this.processMessage(msg);
    }
  }

  private processMessage(msg: JsonRpcMessage): void {
    const now = Date.now();

    // 1. Notifications from server
    if (msg.method === 'session/update' && msg.params) {
      const update = msg.params.update as Record<string, unknown> | undefined;
      if (!update) return;

      const sessionUpdate = update.sessionUpdate as string | undefined;

      switch (sessionUpdate) {
        case 'agent_thought_chunk': {
          const content = update.content as { text?: string } | undefined;
          const text = content?.text ?? '';
          if (text) {
            this.onEvent?.({ type: 'thinking', content: text, timestamp: now });
            this.onEvent?.({ type: 'status_change', status: 'thinking', timestamp: now });
          }
          break;
        }

        case 'agent_message_chunk': {
          const content = update.content as { text?: string } | undefined;
          const text = content?.text ?? '';
          if (text) {
            // chat_message only — AgentManager mirrors it into displayHistory
            // and the store's output table, so a paired raw_output duplicated
            // every reply on disk and in the terminal stream.
            this.onEvent?.({
              type: 'chat_message',
              role: 'assistant',
              content: text,
              timestamp: now,
            });
            this.onEvent?.({ type: 'status_change', status: 'executing', timestamp: now });
          }
          break;
        }

        case 'tool_call': {
          const name = (update.name as string) ?? 'tool';
          const args = (update.args ?? {}) as Record<string, unknown>;
          const toolCallId = update.toolCallId as string | undefined;

          this.onEvent?.({
            type: 'tool_use',
            tool: name,
            args,
            itemId: toolCallId,
            timestamp: now,
          });
          this.onEvent?.({ type: 'status_change', status: 'executing', timestamp: now });
          break;
        }

        case 'tool_call_update': {
          const name = (update.name as string) ?? '';
          const args = (update.args ?? {}) as Record<string, unknown>;
          const content = update.content;
          let outputText = '';
          if (typeof update.rawOutput === 'string') {
            outputText = update.rawOutput;
          } else if (
            update.rawOutput &&
            typeof (update.rawOutput as Record<string, unknown>).output === 'string'
          ) {
            outputText = (update.rawOutput as Record<string, unknown>).output as string;
          } else if (content && typeof (content as { text?: string }).text === 'string') {
            outputText = (content as { text: string }).text;
          } else if (Array.isArray(content)) {
            for (const item of content) {
              if (typeof item === 'string') {
                outputText += item;
              } else if (item && typeof item === 'object') {
                const itemObj = item as Record<string, unknown>;
                if (typeof itemObj.text === 'string') {
                  outputText += itemObj.text;
                } else if (
                  itemObj.content &&
                  typeof (itemObj.content as Record<string, unknown>).text === 'string'
                ) {
                  outputText += (itemObj.content as Record<string, unknown>).text as string;
                }
              }
            }
          }

          if (name === 'run_command' || args.CommandLine) {
            this.onEvent?.({
              type: 'command_exec',
              command: String(args.CommandLine || update.title || name),
              output: outputText,
              timestamp: now,
            });
          }

          if (outputText) {
            this.onEvent?.({ type: 'raw_output', content: outputText, timestamp: now });
          }
          break;
        }

        case 'session_info_update': {
          // Title update from Antigravity
          break;
        }

        default:
          break;
      }
      return;
    }

    // 2. Server requests (e.g. permission approval)
    // Note: Antigravity ACP sends msg.id as a string (e.g. "1"), but standard JSON-RPC may also use numbers.
    if (
      msg.method === 'session/request_permission' &&
      (typeof msg.id === 'number' || typeof msg.id === 'string')
    ) {
      const params = (msg.params ?? {}) as {
        toolCall?: {
          toolCallId?: string;
          name?: string;
          args?: Record<string, unknown>;
          title?: string;
        };
        options?: Array<{ optionId: string; name?: string; kind?: string }>;
      };

      const toolCall = params.toolCall;
      const toolCallId = toolCall?.toolCallId ?? `req_${msg.id}`;
      const toolName = toolCall?.name ?? 'action';
      const description = toolCall?.title ?? toolName;

      // Auto-approve if in full-access mode or permission mode bypasses
      const isAutoApprove =
        this.selectedAccessMode === 'full-access' ||
        this.permissionMode === 'bypassPermissions' ||
        this.permissionMode === 'yolo';

      if (isAutoApprove) {
        const allowOpt =
          params.options?.find(
            (o) =>
              o.kind?.startsWith('allow') ||
              o.optionId === 'allow' ||
              o.optionId === 'proceed_once' ||
              o.optionId === 'proceed_always',
          )?.optionId ??
          params.options?.[0]?.optionId ??
          'allow';

        this.send({
          jsonrpc: '2.0',
          id: msg.id,
          result: {
            outcome: {
              outcome: 'approved',
              optionId: allowOpt,
            },
          },
        });
        return;
      }

      this.pendingPermissions.set(msg.id, {
        toolCallId,
        options: params.options,
      });

      this.onEvent?.({
        type: 'permission_request',
        requestId: toolCallId,
        tool: toolName,
        action: toolName,
        description,
        timestamp: now,
      });

      this.onEvent?.({
        type: 'waiting_approval',
        timestamp: now,
      });

      this.onEvent?.({ type: 'status_change', status: 'waiting_input', timestamp: now });
      return;
    }

    // 3. Responses to our client requests
    if (typeof msg.id === 'number') {
      // Initialize response -> send session/new
      if (msg.result?.protocolVersion) {
        this.onEvent?.({ type: 'status_change', status: 'running', timestamp: now });
        this.send({
          jsonrpc: '2.0',
          id: this.msgIdCounter++,
          method: 'session/new',
          params: {
            cwd: process.cwd(),
            mcpServers: [],
          },
        });
        return;
      }

      // session/new response
      if (msg.result?.sessionId) {
        this.sessionId = msg.result.sessionId as string;

        const modelsObj = msg.result.models as
          | {
              availableModels?: Array<{ modelId: string; name: string }>;
              currentModelId?: string;
            }
          | undefined;

        if (modelsObj?.availableModels) {
          this.availableModels = modelsObj.availableModels.map((m) => m.modelId);
          this.modelDetails = modelsObj.availableModels.map((m) => ({
            id: m.modelId,
            name: m.name,
          }));
        }
        if (!this.selectedModel && modelsObj?.currentModelId) {
          this.selectedModel = modelsObj.currentModelId;
        }

        // Ready for chat!
        this.onEvent?.({ type: 'status_change', status: 'idle', timestamp: now });

        // Drain any queued messages
        while (this.messageQueue.length > 0) {
          const next = this.messageQueue.shift()!;
          this.handleUserWrite(next.text, next.images);
        }
        return;
      }

      // session/prompt response
      if (this.currentPromptId === msg.id) {
        this.currentPromptId = null;

        const result = msg.result as
          | {
              usage?: {
                inputTokens?: number;
                outputTokens?: number;
                totalTokens?: number;
              };
            }
          | undefined;

        if (result?.usage) {
          this.onEvent?.({
            type: 'token_usage',
            promptTokens: result.usage.inputTokens ?? 0,
            completionTokens: result.usage.outputTokens ?? 0,
            totalTokens: result.usage.totalTokens ?? 0,
            timestamp: now,
          });
        }

        // Prompt finished, agent is now idle and ready for next turn
        this.onEvent?.({ type: 'status_change', status: 'idle', timestamp: now });
        return;
      }
    }
  }

  async approve(_reason?: string): Promise<void> {
    for (const [id, req] of this.pendingPermissions.entries()) {
      const allowOpt =
        req.options?.find(
          (o) =>
            o.kind?.startsWith('allow') ||
            o.optionId === 'allow' ||
            o.optionId === 'proceed_once' ||
            o.optionId === 'proceed_always',
        )?.optionId ??
        req.options?.[0]?.optionId ??
        'allow';
      this.send({
        jsonrpc: '2.0',
        id,
        result: {
          outcome: {
            outcome: 'approved',
            optionId: allowOpt,
          },
        },
      });
      this.pendingPermissions.delete(id);
      this.onEvent?.({ type: 'status_change', status: 'executing', timestamp: Date.now() });
      break;
    }
  }

  async reject(_reason?: string): Promise<void> {
    for (const [id, req] of this.pendingPermissions.entries()) {
      const denyOpt =
        req.options?.find(
          (o) =>
            o.kind?.startsWith('reject') ||
            o.kind?.startsWith('deny') ||
            o.optionId === 'deny' ||
            o.optionId === 'cancel',
        )?.optionId ?? 'deny';
      this.send({
        jsonrpc: '2.0',
        id,
        result: {
          outcome: {
            outcome: 'rejected',
            optionId: denyOpt,
          },
        },
      });
      this.pendingPermissions.delete(id);
      break;
    }
  }
}

export const antigravitySdkAdapter = new AntigravitySdkAdapter();
