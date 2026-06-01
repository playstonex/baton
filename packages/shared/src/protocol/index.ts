import type {
  ParsedEvent,
  AgentStatus,
  AgentType,
  SessionStatus,
  HostStatus,
  AdapterMode,
} from '../types/index.js';

// WebSocket message types: Client → Daemon
export type ClientMessage = TerminalInputMessage | ControlMessage;

export interface TerminalInputMessage {
  type: 'terminal_input';
  sessionId: string;
  data: string;
}

export type ControlAction =
  | 'start_agent'
  | 'stop_agent'
  | 'list_agents'
  | 'attach_session'
  | 'detach_session'
  | 'resize'
  | 'claim_session'
  | 'release_session'
  | 'permission_response'
  | 'register_push_token'
  | 'unregister_push_token'
  | 'set_access_mode'
  | 'git_status'
  | 'git_commit'
  | 'git_push'
  | 'git_pull'
  | 'git_branches'
  | 'git_checkout'
  | 'git_create_branch'
  | 'git_log'
  | 'git_stash'
  | 'git_stash_pop'
  | 'git_remote_url';

export interface ControlMessage {
  type: 'control';
  action: ControlAction;
  sessionId?: string;
  payload?: Record<string, unknown>;
}

// WebSocket message types: Daemon → Client
export type DaemonMessage =
  | TerminalOutputMessage
  | HistoryReplayMessage
  | ParsedEventMessage
  | EventHistoryMessage
  | StatusUpdateMessage
  | AgentListMessage
  | PermissionRequestMessage
  | SessionOwnershipMessage
  | HealthScoreMessage
  | AccessModeMessage
  | GitResultMessage
  | ErrorMessage;

export interface TerminalOutputMessage {
  type: 'terminal_output';
  sessionId: string;
  data: string;
}

export interface HistoryReplayMessage {
  type: 'history_replay';
  sessionId: string;
  output: string;
}

export interface ParsedEventMessage {
  type: 'parsed_event';
  sessionId: string;
  event: ParsedEvent;
}

export interface EventHistoryMessage {
  type: 'event_history';
  sessionId: string;
  events: ParsedEvent[];
}

export interface StatusUpdateMessage {
  type: 'status_update';
  sessionId: string;
  status: AgentStatus | SessionStatus;
}

export interface AgentListMessage {
  type: 'agent_list';
  agents: { id: string; type: string; status: AgentStatus; projectPath: string }[];
}

export interface PermissionRequestMessage {
  type: 'permission_request';
  sessionId: string;
  requestId: string;
  tool: string;
  action: string;
  description: string;
}

export interface SessionOwnershipMessage {
  type: 'session_ownership';
  sessionId: string;
  owner: 'local' | 'remote';
  claimedBy: string;
}

export interface HealthScoreMessage {
  type: 'health_score';
  score: number;
  metrics: {
    successRate: number;
    avgLatencyMs: number;
    activeAgents: number;
    errorCount24h: number;
  };
}

export interface ErrorMessage {
  type: 'error';
  message: string;
  code?: string;
}

// Access control modes for agent permission handling
export type AccessMode = 'on-request' | 'full-access';

export interface AccessModeMessage {
  type: 'access_mode';
  mode: AccessMode;
}

// Git result message: Daemon → Client
export interface GitResultMessage {
  type: 'git_result';
  action: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

// Relay protocol (Phase 2)
export interface RelayRegisterMessage {
  type: 'register';
  role: 'host' | 'client';
  hostId?: string;
  token: string;
}

export interface RelayBindMessage {
  type: 'bind';
  hostId: string;
}

// REST API types
export interface StartAgentRequest {
  agentType: AgentType;
  projectPath: string;
  args?: string[];
  env?: Record<string, string>;
  mode?: AdapterMode;
}

export interface StartAgentResponse {
  sessionId: string;
  agentType: AgentType;
  status: AgentStatus;
}

export interface HostInfoResponse {
  id: string;
  name: string;
  hostname?: string;
  os?: string;
  status: HostStatus;
  agents: { id: string; type: string; status: AgentStatus; projectPath: string }[];
}

export * from './channels.js';
export * from './handshake.js';
