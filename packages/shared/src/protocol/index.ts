import type {
  ParsedEvent,
  AgentStatus,
  AgentType,
  SessionStatus,
  HostStatus,
  AdapterMode,
  ThinkingConfig,
  ReasoningEffort,
  ServiceTier,
} from '../types/index.js';
// AccessMode is defined locally below (kept for backward compat with main).

// WebSocket message types: Client → Daemon
export type ClientMessage =
  | TerminalInputMessage
  | ChatInputMessage
  | SteerInputMessage
  | CancelTurnMessage
  | ApproveInputMessage
  | RejectInputMessage
  | ModelListRequestMessage
  | ModelSelectMessage
  | ReasoningEffortSelectMessage
  | ThinkingConfigSelectMessage
  | AccessModeSelectMessage
  | ServiceTierSelectMessage
  | GitBranchListRequestMessage
  | GitBranchSelectMessage
  | GitStatusRequestMessage
  | GitCommitMessage
  | GitPushMessage
  | GitPullMessage
  | GitCreateBranchMessage
  | ControlMessage;

export interface TerminalInputMessage {
  type: 'terminal_input';
  sessionId: string;
  data: string;
}

// ── Chat / SDK input messages (Client → Daemon) ────────────────────

/** Conversational message — routed to SDK messageQueue (preferred) or PTY stdin. */
export interface ChatInputMessage {
  type: 'chat_input';
  sessionId: string;
  content: string;
  model?: string;
  /** Optional message ID for request-response tracking */
  messageId?: string;
}

/** Mid-turn steering — injects a follow-up while the agent is still running (SDK only). */
export interface SteerInputMessage {
  type: 'steer_input';
  sessionId: string;
  content: string;
}

/** Cancel the current in-progress turn. */
export interface CancelTurnMessage {
  type: 'cancel_turn';
  sessionId: string;
}

export interface ApproveInputMessage {
  type: 'approve_input';
  sessionId: string;
  reason?: string;
}

export interface RejectInputMessage {
  type: 'reject_input';
  sessionId: string;
  reason?: string;
}

export interface ModelListRequestMessage {
  type: 'model_list_request';
  sessionId: string;
}

export interface ModelSelectMessage {
  type: 'model_select';
  sessionId: string;
  model: string;
}

export interface ReasoningEffortSelectMessage {
  type: 'reasoning_effort_select';
  sessionId: string;
  effort: ReasoningEffort;
}

export interface ThinkingConfigSelectMessage {
  type: 'thinking_config_select';
  sessionId: string;
  config: ThinkingConfig;
}

export interface AccessModeSelectMessage {
  type: 'access_mode_select';
  sessionId: string;
  mode: AccessMode;
}

export interface ServiceTierSelectMessage {
  type: 'service_tier_select';
  sessionId: string;
  tier: ServiceTier;
}

export interface GitBranchListRequestMessage {
  type: 'git_branch_list_request';
  sessionId: string;
}

export interface GitBranchSelectMessage {
  type: 'git_branch_select';
  sessionId: string;
  branch: string;
}

export interface GitStatusRequestMessage {
  type: 'git_status_request';
  sessionId: string;
}

export interface GitCommitMessage {
  type: 'git_commit';
  sessionId: string;
  message: string;
}

export interface GitPushMessage {
  type: 'git_push';
  sessionId: string;
}

export interface GitPullMessage {
  type: 'git_pull';
  sessionId: string;
}

export interface GitCreateBranchMessage {
  type: 'git_create_branch';
  sessionId: string;
  name: string;
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
  | ModelListMessage
  | GitBranchListMessage
  | GitStatusMessage
  | GitResultMessage
  | AckMessage
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
  /** Optional: echo back the messageId from the original request */
  replyToMessageId?: string;
}

export interface AckMessage {
  type: 'ack';
  status: 'ok' | 'error';
  messageId: string;
  error?: string;
}

export interface ModelListMessage {
  type: 'model_list';
  sessionId: string;
  models: string[];
  selected?: string;
}

export interface GitBranchListMessage {
  type: 'git_branch_list';
  sessionId: string;
  branches: string[];
  currentBranch: string;
}

export interface GitStatusMessage {
  type: 'git_status';
  sessionId: string;
  status: string;
  diff: string;
  projectPath: string;
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
  /** Optional for new chat-style per-session operations; absent on legacy broadcasts. */
  sessionId?: string;
  /** New unified operation tag (checkout/commit/push/pull/create_branch). */
  operation?: string;
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
