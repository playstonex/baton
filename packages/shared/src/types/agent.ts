import type { AgentType, ParsedEvent } from './index.js';

// Discriminated union agent state — each status carries contextual metadata
export type AgentState =
  | { status: 'starting'; at: number }
  | { status: 'initializing'; at: number }
  | { status: 'idle'; at: number; lastActivity: number }
  | { status: 'running'; at: number; toolCount: number }
  | { status: 'thinking'; at: number }
  | { status: 'executing'; at: number; tool: string }
  | { status: 'waiting_input'; at: number; prompt: string }
  | { status: 'error'; at: number; error: string; code?: number }
  | { status: 'stopped'; at: number; exitCode: number };

export const VALID_TRANSITIONS: Record<string, string[]> = {
  starting: ['initializing', 'running', 'error', 'stopped'],
  initializing: ['idle', 'running', 'error', 'stopped'],
  idle: ['running', 'thinking', 'waiting_input', 'error', 'stopped'],
  running: ['idle', 'thinking', 'executing', 'waiting_input', 'error', 'stopped'],
  thinking: ['running', 'executing', 'idle', 'error', 'stopped'],
  executing: ['running', 'thinking', 'idle', 'error', 'stopped'],
  waiting_input: ['running', 'idle', 'error', 'stopped'],
  error: ['stopped'],
  stopped: [],
};

/**
 * What a session is doing right now, beyond the bare status word — powers the
 * activity line on dashboard lists. COMPAT(statusDetail): every field is
 * additive/optional, older clients ignore it.
 */
export interface StatusDetail {
  /** Epoch ms when the current status was entered. */
  since: number;
  /** executing — tool currently running (e.g. 'Bash'). */
  tool?: string;
  /** executing — human title of the tool call when the parser provides one. */
  toolTitle?: string;
  /** waiting_input — the question the agent is blocked on. */
  prompt?: string;
  /** error — the error message. */
  error?: string;
  /** running — tool calls completed this turn. */
  toolCount?: number;
}

export function statusDetailFromState(state: AgentState): StatusDetail {
  switch (state.status) {
    case 'running':
      return { since: state.at, toolCount: state.toolCount };
    case 'executing':
      return { since: state.at, tool: state.tool };
    case 'waiting_input':
      return { since: state.at, prompt: state.prompt };
    case 'error':
      return { since: state.at, error: state.error };
    default:
      return { since: state.at };
  }
}

// Timeline item for agent history
export interface TimelineItem {
  timestamp: number;
  type: ParsedEvent['type'];
  summary: string;
  data?: Record<string, unknown>;
}

// Agent snapshot — file-backed JSON for persistence and recovery
export interface AgentSnapshot {
  id: string;
  type: AgentType;
  projectPath: string;
  state: AgentState;
  timeline: TimelineItem[]; // capped at 200
  createdAt: string;
  pid?: number;
  cols: number;
  rows: number;
  mode?: 'pty' | 'sdk';
}

export interface AgentConfig {
  type: AgentType;
  projectPath: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cols?: number;
  rows?: number;
  /**
   * Resume a previous provider-side conversation. When `providerSessionId`
   * is known the adapter passes the provider's exact resume flag; without
   * it, adapters fall back to the provider's "continue latest" flag
   * (kiro `chat -r`, agy `-c`, pi `-c`, claude `-c`).
   */
  resume?: {
    providerSessionId?: string;
  };
}

export interface SpawnConfig {
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd: string;
  cols?: number;
  rows?: number;
}

export interface AgentSession {
  id: string;
  write(input: string): void;
  resize(cols: number, rows: number): void;
  stop(): Promise<void>;
  onEvent(handler: (event: ParsedEvent) => void): () => void;
}

export interface AgentProvider {
  readonly name: string;
  readonly type: AgentType;
  detect(projectPath: string): boolean;
  isAvailable(): boolean;
  createSession(config: AgentConfig): Promise<AgentSession>;
  buildSpawnConfig(config: AgentConfig): SpawnConfig;
  parseOutput(raw: string): ParsedEvent[];
}
