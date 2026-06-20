import type { AgentConfig, SpawnConfig } from './agent.js';

// Agent types
export type AgentType =
  | 'claude-code'
  | 'claude-code-sdk'
  | 'codex'
  | 'codex-sdk'
  | 'opencode'
  | 'kiro-cli'
  | 'kiro-cli-acp'
  | 'custom';

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
  | RawOutputEvent
  | ChatMessageEvent
  | WaitingApprovalEvent
  | PlanEvent
  | TokenUsageEvent
  | UserInputPromptEvent
  | DiffEvent
  | SubagentEvent;

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
  itemId?: string;
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
  itemId?: string;
}

export interface CommandExecEvent {
  type: 'command_exec';
  command: string;
  exitCode?: number;
  output?: string;
  isStreaming?: boolean;
  timestamp: number;
  itemId?: string;
}

export interface ThinkingEvent {
  type: 'thinking';
  content: string;
  timestamp: number;
  itemId?: string;
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
  itemId?: string;
}

// ── Chat / SDK events (Codex-style) ────────────────────────────────

export type ChatRole = 'user' | 'assistant';

export interface ChatMessageEvent {
  type: 'chat_message';
  role: ChatRole;
  content: string;
  timestamp: number;
}

export interface WaitingApprovalEvent {
  type: 'waiting_approval';
  timestamp: number;
}

export interface PlanEvent {
  type: 'plan';
  explanation?: string;
  steps?: Array<{ step: string; status: 'pending' | 'in_progress' | 'completed' }>;
  presentation: 'progress' | 'resultStreaming' | 'resultReady' | 'resultCompleted';
  timestamp: number;
  itemId?: string;
}

export interface TokenUsageEvent {
  type: 'token_usage';
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  timestamp: number;
}

export interface UserInputPromptEvent {
  type: 'user_input_prompt';
  questions: Array<{
    id: string;
    header: string;
    question: string;
    options?: Array<{ label: string; description: string }>;
  }>;
  timestamp: number;
}

export interface DiffEvent {
  type: 'diff';
  diff: string;
  path?: string;
  timestamp: number;
  itemId?: string;
}

export interface SubagentEvent {
  type: 'subagent';
  action: 'started' | 'completed' | 'message';
  name?: string;
  model?: string;
  content?: string;
  status?: string;
  timestamp: number;
  itemId?: string;
}

// ── Thinking Configuration (unified) ───────────────────────────────

export type ThinkingMode = 'budget' | 'level' | 'none' | 'auto';

export type ThinkingLevel = 'none' | 'auto' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

export interface ThinkingConfig {
  mode: ThinkingMode;
  /** Token budget, effective when mode='budget'. Special values: 0=disabled, -1=auto */
  budget?: number;
  /** Discrete level, effective when mode='level' */
  level?: ThinkingLevel;
}

const LEVEL_TO_BUDGET: Record<string, number> = {
  none: 0,
  auto: -1,
  minimal: 512,
  low: 1024,
  medium: 8192,
  high: 24576,
  xhigh: 32768,
};

export function levelToBudget(level: ThinkingLevel): number {
  return LEVEL_TO_BUDGET[level] ?? -1;
}

export function budgetToLevel(budget: number): ThinkingLevel {
  if (budget < 0) return 'auto';
  if (budget === 0) return 'none';
  if (budget <= 512) return 'minimal';
  if (budget <= 1024) return 'low';
  if (budget <= 8192) return 'medium';
  if (budget <= 24576) return 'high';
  return 'xhigh';
}

export function thinkingConfigToEffort(config?: ThinkingConfig | null): string | undefined {
  if (!config) return undefined;
  if (config.mode === 'none') return undefined;
  if (config.mode === 'auto') return undefined;
  if (config.mode === 'level' && config.level) {
    const v = config.level;
    if (v === 'low' || v === 'medium' || v === 'high') return v;
    if (v === 'minimal') return 'low';
    if (v === 'xhigh') return 'high';
    if (v === 'none' || v === 'auto') return undefined;
  }
  if (config.mode === 'budget' && config.budget !== undefined) {
    return budgetToLevel(config.budget);
  }
  return undefined;
}

/** @deprecated Use ThinkingConfig with mode='level'. Kept for backward compat with older SDK adapters. */
export type ReasoningEffort = 'low' | 'medium' | 'high';

export type ServiceTier = 'default' | 'fast';

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
  approve?(reason?: string): Promise<void>;
  reject?(reason?: string): Promise<void>;
  selectedModel?: string | null;
  setThinkingConfig?(config: ThinkingConfig): void;
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
