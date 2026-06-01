import type { AgentConfig, SpawnConfig } from './agent.js';

// Agent types
export type AgentType = 'claude-code' | 'claude-code-sdk' | 'codex' | 'opencode' | 'kiro-cli' | 'custom';

export type AgentStatus =
  | 'starting'
  | 'running'
  | 'idle'
  | 'thinking'
  | 'executing'
  | 'waiting_input'
  | 'error'
  | 'stopped';

export interface AgentProcess {
  id: string;
  type: AgentType;
  projectPath: string;
  status: AgentStatus;
  pid?: number;
  startedAt: string;
  stoppedAt?: string;
}

export type { AgentConfig, SpawnConfig } from './agent.js';

// Parsed events — core differentiation: structured understanding of Agent output
export type ParsedEvent =
  | StatusChangeEvent
  | ToolUseEvent
  | ToolCallStartEvent
  | ToolCallEndEvent
  | PermissionRequestEvent
  | PermissionResponseEvent
  | TurnBoundaryEvent
  | FileChangeEvent
  | CommandExecEvent
  | ThinkingEvent
  | ErrorEvent
  | RawOutputEvent;

export interface StatusChangeEvent {
  type: 'status_change';
  status: AgentStatus;
  timestamp: number;
}

export interface ToolUseEvent {
  type: 'tool_use';
  tool: string;
  args: Record<string, unknown>;
  timestamp: number;
}

/** Emitted when a tool call begins — provides structured metadata for UI rendering */
export interface ToolCallStartEvent {
  type: 'tool_call_start';
  callId: string;
  tool: string;
  title?: string;
  description?: string;
  args: Record<string, unknown>;
  timestamp: number;
}

/** Emitted when a tool call finishes — pairs with tool_call_start via callId */
export interface ToolCallEndEvent {
  type: 'tool_call_end';
  callId: string;
  success: boolean;
  durationMs?: number;
  timestamp: number;
}

/** Agent is requesting user permission to proceed with an action */
export interface PermissionRequestEvent {
  type: 'permission_request';
  requestId: string;
  tool: string;
  action: string;
  description: string;
  timestamp: number;
}

/** User response to a permission request */
export interface PermissionResponseEvent {
  type: 'permission_response';
  requestId: string;
  approved: boolean;
  timestamp: number;
}

/** Marks the boundary of a single agent turn (request → response cycle) */
export interface TurnBoundaryEvent {
  type: 'turn_boundary';
  turnId: string;
  direction: 'start' | 'end';
  status?: 'completed' | 'failed' | 'cancelled';
  timestamp: number;
}

export interface FileChangeEvent {
  type: 'file_change';
  path: string;
  changeType: 'create' | 'modify' | 'delete';
  diff?: string;
  timestamp: number;
}

export interface CommandExecEvent {
  type: 'command_exec';
  command: string;
  exitCode?: number;
  timestamp: number;
}

export interface ThinkingEvent {
  type: 'thinking';
  content: string;
  timestamp: number;
}

export interface ErrorEvent {
  type: 'error';
  message: string;
  timestamp: number;
}

export interface RawOutputEvent {
  type: 'raw_output';
  content: string;
  timestamp: number;
}

// Agent Adapter interface
export interface AgentAdapter {
  readonly name: string;
  readonly agentType: AgentType;
  detect(projectPath: string): boolean;
  buildSpawnConfig(config: AgentConfig): SpawnConfig;
  parseOutput(raw: string): ParsedEvent[];
}

export interface SdkAgentAdapter extends AgentAdapter {
  isSdkAvailable(): boolean;
  startSession(
    config: AgentConfig,
    onEvent: (event: ParsedEvent) => void,
  ): Promise<{ write: (input: string) => void; stop: () => Promise<void> }>;
}

export type AdapterMode = 'pty' | 'sdk' | 'auto';

// Host types
export type HostStatus = 'online' | 'offline' | 'error';

export interface Host {
  id: string;
  name: string;
  hostname?: string;
  os?: string;
  status: HostStatus;
  lastSeen: string;
  createdAt: string;
}

// Session types
export type SessionStatus = 'active' | 'detached' | 'ended';

export interface Session {
  id: string;
  hostId: string;
  agentType: AgentType;
  projectPath: string;
  status: SessionStatus;
  startedAt: string;
  stoppedAt?: string;
}

export * from './system.js';
export * from './agent.js';
export * from './provider.js';
export * from './git.js';
