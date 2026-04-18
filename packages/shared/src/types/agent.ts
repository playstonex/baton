import type { AgentType, ParsedEvent } from './index.js';

// Discriminated union agent state — each status carries contextual metadata
export type AgentState =
  | { status: 'initializing'; at: number }
  | { status: 'idle'; at: number; lastActivity: number }
  | { status: 'running'; at: number; toolCount: number }
  | { status: 'waiting_input'; at: number; prompt: string }
  | { status: 'error'; at: number; error: string; code?: number }
  | { status: 'stopped'; at: number; exitCode: number };

// Legal state transitions — enforces state machine invariants
export const VALID_TRANSITIONS: Record<string, string[]> = {
  initializing: ['idle', 'error', 'stopped'],
  idle: ['running', 'waiting_input', 'error', 'stopped'],
  running: ['idle', 'waiting_input', 'error', 'stopped'],
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
