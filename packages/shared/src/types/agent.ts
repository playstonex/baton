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
}

export interface AgentConfig {
  type: AgentType;
  projectPath: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cols?: number;
  rows?: number;
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
