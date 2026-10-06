import { describe, it, expect } from 'vitest';
import { statusDetailFromState, type AgentState } from '../types/agent.js';

describe('statusDetailFromState', () => {
  it('carries toolCount for running', () => {
    const state: AgentState = { status: 'running', at: 1000, toolCount: 3 };
    expect(statusDetailFromState(state)).toEqual({ since: 1000, toolCount: 3 });
  });

  it('carries the tool name for executing', () => {
    const state: AgentState = { status: 'executing', at: 2000, tool: 'Bash' };
    expect(statusDetailFromState(state)).toEqual({ since: 2000, tool: 'Bash' });
  });

  it('carries the prompt for waiting_input', () => {
    const state: AgentState = { status: 'waiting_input', at: 3000, prompt: 'Allow edit?' };
    expect(statusDetailFromState(state)).toEqual({ since: 3000, prompt: 'Allow edit?' });
  });

  it('carries the error message for error', () => {
    const state: AgentState = { status: 'error', at: 4000, error: 'boom', code: 1 };
    expect(statusDetailFromState(state)).toEqual({ since: 4000, error: 'boom' });
  });

  it('carries only since for statuses without metadata', () => {
    expect(statusDetailFromState({ status: 'thinking', at: 5000 })).toEqual({ since: 5000 });
    expect(statusDetailFromState({ status: 'idle', at: 6000, lastActivity: 6000 })).toEqual({
      since: 6000,
    });
    expect(statusDetailFromState({ status: 'stopped', at: 7000, exitCode: 0 })).toEqual({
      since: 7000,
    });
  });
});
