// Agent types
export type AgentType = 'claude-code' | 'codex' | 'opencode' | 'custom';

export type AgentStatus =
  | 'starting'
  | 'running'
  | 'idle'
  | 'thinking'
  | 'executing'
  | 'waiting_input'
  | 'error'
  | 'stopped';

export interface AgentConfig {
  type: AgentType;
  projectPath: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface AgentProcess {
  id: string;
  type: AgentType;
  projectPath: string;
  status: AgentStatus;
  pid?: number;
  startedAt: string;
  stoppedAt?: string;
}

// Parsed events — core differentiation: structured understanding of Agent output
export type ParsedEvent =
  | StatusChangeEvent
  | ToolUseEvent
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

export interface SpawnConfig {
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd: string;
}

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

export * from './agent.js';
export * from './provider.js';
