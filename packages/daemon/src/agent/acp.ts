/**
 * Generic Agent Client Protocol (ACP) adapter.
 *
 * ACP (agentclientprotocol.com) is JSON-RPC 2.0 over stdio: initialize →
 * session/new → session/prompt, with session/notification updates streaming
 * back (AgentMessageChunk / ToolCall / ToolCallUpdate / TurnEnd) and
 * request_permission calls for approvals. Any agent that speaks it can be
 * driven by Baton without a bespoke adapter — the user declares HOW to spawn
 * it in $BATON_HOME/acp.json:
 *
 *   { "providers": { "gemini": { "command": "gemini",
 *       "args": ["--experimental-acp"], "label": "Gemini CLI" } } }
 *
 * The protocol state machine mirrors the proven KiroAcpSdkAdapter; only the
 * spawn target differs (profile-driven instead of hardcoded `kiro-cli acp`).
 */

import { execFileSync, spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  AcpProviderProfile,
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

// Capabilities advertised in `initialize`. See kiro-acp.ts for why fs and
// terminal stay false: we don't service those server-side requests, and
// claiming them would hang the agent's first file/shell tool call.
const ACP_CLIENT_CAPABILITIES = {
  fs: { readTextFile: false, writeTextFile: false },
  terminal: false,
} as const;

/**
 * Spawnable command policy: a bare executable name or an absolute path,
 * without spaces, shell metacharacters, or separators inside a name. Args
 * belong in the profile's `args` array (passed as argv, never through a
 * shell). Validated at profile load AND before every spawn.
 */
const SAFE_COMMAND_RE = /^(?:[A-Za-z0-9._@+-]+|\/[A-Za-z0-9._@/+,-]+)$/;

export function isSafeAcpCommand(command: string): boolean {
  return SAFE_COMMAND_RE.test(command) && !command.includes('..');
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

function acpProvidersFile(): string {
  const home = process.env.BATON_HOME ?? `${process.env.HOME ?? '~'}/.baton`;
  return join(home, 'acp.json');
}

/** Load + validate $BATON_HOME/acp.json. Missing file → empty map. */
export async function loadAcpProviders(
  filePath = acpProvidersFile(),
): Promise<Map<string, AcpProviderProfile>> {
  const map = new Map<string, AcpProviderProfile>();
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf-8');
  } catch {
    return map; // no acp.json — no generic providers configured
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.warn(`[baton] acp: invalid JSON in ${filePath} — ignored`);
    return map;
  }
  const providers = (parsed as { providers?: Record<string, unknown> })?.providers;
  if (typeof providers !== 'object' || providers === null) return map;
  for (const [name, value] of Object.entries(providers)) {
    const p = value as Partial<AcpProviderProfile>;
    if (typeof p.command !== 'string' || !isSafeAcpCommand(p.command)) {
      console.warn(
        `[baton] acp: provider '${name}' has missing or unsafe command — skipped`,
      );
      continue;
    }
    map.set(name, {
      command: p.command,
      args: Array.isArray(p.args) ? p.args.map(String) : [],
      label: typeof p.label === 'string' ? p.label : name,
    });
  }
  return map;
}

/** Does the profile's binary exist on this host? (used for UI availability) */
export function acpProviderAvailable(profile: AcpProviderProfile): boolean {
  try {
    execFileSync('which', [profile.command], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

// ── PTY variant (terminal mode) ──────────────────────────────────────────────

export class GenericAcpAdapter extends BaseAgentAdapter {
  readonly name: string;
  readonly agentType = 'acp' as const;

  private sessionId: string | null = null;
  private msgIdCounter = 0;
  private lineBuffer = '';

  constructor(providerName: string, private readonly profile: AcpProviderProfile) {
    super();
    this.name = `${profile.label ?? providerName} (ACP)`;
  }

  detect(_projectPath: string): boolean {
    return acpProviderAvailable(this.profile);
  }

  buildSpawnConfig(config: AgentConfig): SpawnConfig {
    return {
      command: this.profile.command,
      args: [...(this.profile.args ?? []), ...(config.args ?? [])],
      env: { ...(process.env as Record<string, string>), ...(config.env ?? {}) },
      cwd: config.projectPath,
    };
  }

  override afterSpawn(write: (data: string) => void, config: AgentConfig): void {
    setTimeout(() => {
      write(this.initMessage());
      setTimeout(() => write(this.newSessionMessage(config.projectPath)), 500);
    }, 300);
  }

  private initMessage(): string {
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

  private newSessionMessage(cwd: string): string {
    return (
      JSON.stringify({
        jsonrpc: '2.0',
        id: this.msgIdCounter++,
        method: 'session/new',
        params: { cwd, mcpServers: [] },
      }) + '\n'
    );
  }

  private promptMessage(text: string): string | null {
    if (!this.sessionId) return null;
    return (
      JSON.stringify({
        jsonrpc: '2.0',
        id: this.msgIdCounter++,
        method: 'session/prompt',
        params: { sessionId: this.sessionId, content: [{ type: 'text', text }] },
      }) + '\n'
    );
  }

  override transformInput(data: string): string | null {
    const text = data.replace(/[\r\n]+$/, '').trim();
    if (!text) return null;
    return this.promptMessage(text);
  }

  override filterRawOutput(_data: string): string | null {
    return null; // display is driven by parseOutput events
  }

  parseOutput(raw: string): ParsedEvent[] {
    const events: ParsedEvent[] = [];
    consumeAcpLines(
      raw,
      () => this.lineBuffer,
      (rest) => {
        this.lineBuffer = rest;
      },
      (ev) => events.push(ev),
      {
        onSessionId: (id) => {
          this.sessionId = id;
        },
      },
    );
    return events;
  }
}

// ── SDK variant (chat mode) ──────────────────────────────────────────────────

export class GenericAcpSdkAdapter implements SdkAgentAdapter {
  readonly name: string;
  readonly agentType = 'acp' as const;

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

  constructor(
    private readonly providerName: string,
    private readonly profile: AcpProviderProfile,
  ) {
    this.name = `${profile.label ?? providerName} (ACP)`;
  }

  setThinkingConfig(_config: ThinkingConfig): void {}

  detect(_projectPath?: string): boolean {
    return acpProviderAvailable(this.profile);
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

    // Command re-validated at the spawn boundary (belt & braces with the
    // load-time check). Spawned via a FIXED program (`env`) with the profile
    // command as argv[0] — the standard no-shell idiom: argv-only, no string
    // concatenation, config data is never interpreted as a program itself.
    if (!isSafeAcpCommand(this.profile.command)) {
      throw new Error(`ACP provider '${this.providerName}' command failed safety check`);
    }
    this.process = spawn(
      '/usr/bin/env',
      [this.profile.command, ...(this.profile.args ?? []), ...(config.args ?? [])],
      { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] },
    );

    this.process.stdout!.on('data', (chunk: Buffer) => this.handleOutput(chunk.toString('utf-8')));
    this.process.stderr!.on('data', (chunk: Buffer) => {
      const errText = chunk.toString('utf-8').trim();
      if (errText) console.error(`[baton] acp(${this.providerName}) stderr: ${errText}`);
    });
    this.process.on('exit', (code) => {
      console.log(`[baton] acp(${this.providerName}): exited with code ${code}`);
      this.onEvent?.({ type: 'status_change', status: 'stopped', timestamp: Date.now() });
    });
    this.process.on('error', (err) => {
      this.onEvent?.({ type: 'error', message: err.message, timestamp: Date.now() });
    });

    setTimeout(() => {
      this.send(this.initMessage());
      setTimeout(() => this.send(this.newSessionMessage(cwd)), 300);
    }, 200);

    const write = (input: string) => {
      const text = input.trim();
      if (!text) return;
      this.onEvent?.({ type: 'chat_message', role: 'user', content: text, timestamp: Date.now() });
      this.onEvent?.({ type: 'status_change', status: 'thinking', timestamp: Date.now() });
      if (this.sessionId) {
        const msg = this.promptMessage(text);
        if (msg) this.send(msg);
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

  private initMessage(): string {
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

  private newSessionMessage(cwd: string): string {
    return (
      JSON.stringify({
        jsonrpc: '2.0',
        id: this.msgIdCounter++,
        method: 'session/new',
        params: { cwd, mcpServers: [] },
      }) + '\n'
    );
  }

  private promptMessage(text: string): string | null {
    if (!this.sessionId) return null;
    return (
      JSON.stringify({
        jsonrpc: '2.0',
        id: this.msgIdCounter++,
        method: 'session/prompt',
        params: { sessionId: this.sessionId, content: [{ type: 'text', text }] },
      }) + '\n'
    );
  }

  private handleOutput(raw: string): void {
    if (!this.onEvent) return;
    consumeAcpLines(
      raw,
      () => this.lineBuffer,
      (rest) => {
        this.lineBuffer = rest;
      },
      (ev) => this.onEvent?.(ev),
      {
        onSessionId: (id) => {
          this.sessionId = id;
          while (this.messageQueue.length > 0) {
            const next = this.messageQueue.shift()!;
            const msg = this.promptMessage(next);
            if (msg) this.send(msg);
          }
        },
        onServerRequest: (id, method, params) => {
          this.pendingRequests.set(id, method);
          if (
            method === 'session/request_permission' ||
            method === 'request_permission'
          ) {
            this.onEvent?.({ type: 'waiting_approval', timestamp: Date.now() });
            this.onEvent?.({
              type: 'permission_request',
              requestId: String(id),
              tool: (params.tool as string) ?? (params.name as string) ?? 'unknown',
              action: (params.action as string) ?? 'execute',
              description: (params.description as string) ?? 'ACP permission request',
              timestamp: Date.now(),
            });
          }
        },
        chatAsChatMessage: true,
      },
    );
  }
}

// ── Shared JSON-RPC framing + event mapping ─────────────────────────────────

interface ConsumeOptions {
  onSessionId?: (id: string) => void;
  onServerRequest?: (id: number, method: string, params: Record<string, unknown>) => void;
  /** SDK (chat) mode emits chat_message for assistant text; PTY mode raw_output. */
  chatAsChatMessage?: boolean;
}

/**
 * Feed one stdout chunk through the line buffer and emit events for each
 * complete JSON-RPC message. PTY chunks are not line-aligned, so a partial
 * trailing line is carried over via the get/set accessors.
 */
export function consumeAcpLines(
  raw: string,
  getBuffer: () => string,
  setBuffer: (rest: string) => void,
  emit: (ev: ParsedEvent) => void,
  opts: ConsumeOptions = {},
): void {
  const now = Date.now();
  setBuffer(getBuffer() + raw);
  const lines = getBuffer().split('\n');
  setBuffer(lines.pop() ?? '');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let msg: AcpMessage;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      continue; // stderr noise / banners
    }

    // Response to one of our requests.
    if ('id' in msg && 'result' in msg && typeof msg.id === 'number') {
      const result = msg.result as Record<string, unknown> | null;
      if (result?.agentInfo) {
        emit({ type: 'status_change', status: 'running', timestamp: now });
        continue;
      }
      if (typeof result?.sessionId === 'string') {
        opts.onSessionId?.(result.sessionId);
        emit({ type: 'status_change', status: 'idle', timestamp: now });
        continue;
      }
      continue;
    }

    // Server→client request (permissions etc.).
    if ('id' in msg && 'method' in msg && typeof msg.id === 'number') {
      opts.onServerRequest?.(
        msg.id,
        msg.method as string,
        (msg.params ?? {}) as Record<string, unknown>,
      );
      continue;
    }

    // Notification stream.
    if ('method' in msg && msg.method === 'session/notification') {
      const params = msg.params as AcpNotificationParams;
      const update = params?.update;
      if (!update) continue;

      switch (update.type) {
        case 'AgentMessageChunk': {
          const content = (update.content as string) ?? '';
          if (opts.chatAsChatMessage) {
            emit({ type: 'chat_message', role: 'assistant', content, timestamp: now });
          }
          emit({ type: 'raw_output', content, timestamp: now });
          break;
        }
        case 'ToolCall':
          emit({
            type: 'tool_use',
            tool: (update.name as string) ?? 'unknown',
            args: (update.parameters as Record<string, unknown>) ?? {},
            timestamp: now,
          });
          if (update.status === 'running') {
            emit({ type: 'status_change', status: 'executing', timestamp: now });
          }
          break;
        case 'ToolCallUpdate':
          emit({
            type: 'raw_output',
            content: (update.content as string) ?? '',
            timestamp: now,
          });
          break;
        case 'TurnEnd':
          emit({ type: 'status_change', status: 'idle', timestamp: now });
          break;
        default:
          break;
      }
      continue;
    }

    if ('error' in msg && msg.error) {
      const err = msg.error as { message?: string };
      emit({ type: 'error', message: err.message ?? 'ACP error', timestamp: now });
    }
  }
}

// Configured provider profiles, refreshed whenever acp.json is (re)loaded.
// Adapters themselves are created FRESH per session: both variants carry
// per-session state (process, sessionId, lineBuffer, onEvent), so a shared
// instance would make two concurrent sessions clobber each other.
const acpProfiles = new Map<string, AcpProviderProfile>();

/** Replace the profile set (called after every acp.json load). */
export function refreshAcpAdapters(profiles: Map<string, AcpProviderProfile>): void {
  acpProfiles.clear();
  for (const [name, profile] of profiles) {
    acpProfiles.set(name, profile);
  }
}

/** Is a provider configured? (existence check without constructing an adapter) */
export function hasAcpProvider(providerName: string): boolean {
  return acpProfiles.has(providerName);
}

/** Fresh chat-mode adapter for one session. Null when unconfigured. */
export function getAcpSdkAdapter(providerName: string): GenericAcpSdkAdapter | null {
  const profile = acpProfiles.get(providerName);
  return profile ? new GenericAcpSdkAdapter(providerName, profile) : null;
}

/** Fresh terminal-mode adapter for one session. Null when unconfigured. */
export function getAcpPtyAdapter(providerName: string): GenericAcpAdapter | null {
  const profile = acpProfiles.get(providerName);
  return profile ? new GenericAcpAdapter(providerName, profile) : null;
}
