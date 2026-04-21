import type {
  ParsedEvent,
  AgentStatus,
  AgentType,
  SessionStatus,
  HostStatus,
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
  | 'resize';

export interface ControlMessage {
  type: 'control';
  action: ControlAction;
  sessionId?: string;
  payload?: Record<string, unknown>;
}

// WebSocket message types: Daemon → Client
export type DaemonMessage =
  | TerminalOutputMessage
  | ParsedEventMessage
  | StatusUpdateMessage
  | AgentListMessage
  | ErrorMessage;

export interface TerminalOutputMessage {
  type: 'terminal_output';
  sessionId: string;
  data: string;
}

export interface ParsedEventMessage {
  type: 'parsed_event';
  sessionId: string;
  event: ParsedEvent;
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

export interface ErrorMessage {
  type: 'error';
  message: string;
  code?: string;
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
