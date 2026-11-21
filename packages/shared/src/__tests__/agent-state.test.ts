import { describe, it, expect } from 'vitest';
import { VALID_TRANSITIONS, type AgentState } from '../types/agent.js';

describe('Agent State Machine', () => {
  it('initializing can transition to idle, error, or stopped', () => {
    expect(VALID_TRANSITIONS['initializing']).toEqual(
      expect.arrayContaining(['idle', 'error', 'stopped']),
    );
  });

  it('idle can transition to running, waiting_input, error, or stopped', () => {
    expect(VALID_TRANSITIONS['idle']).toEqual(
      expect.arrayContaining(['running', 'waiting_input', 'error', 'stopped']),
    );
  });

  it('running can transition back to idle', () => {
    expect(VALID_TRANSITIONS['running']).toContain('idle');
  });

  it('error can only transition to stopped', () => {
    expect(VALID_TRANSITIONS['error']).toEqual(['stopped']);
  });

  it('stopped has no valid transitions', () => {
    expect(VALID_TRANSITIONS['stopped']).toEqual([]);
  });

  it('initializing can transition to running directly', () => {
    expect(VALID_TRANSITIONS['initializing']).toContain('running');
  });

  it('all states are covered', () => {
    const states = ['initializing', 'idle', 'running', 'waiting_input', 'error', 'stopped'];
    for (const state of states) {
      expect(VALID_TRANSITIONS).toHaveProperty(state);
    }
  });

  it('AgentState discriminated union carries metadata', () => {
    const initializing: AgentState = { status: 'initializing', at: Date.now() };
    expect(initializing.status).toBe('initializing');

    const running: AgentState = { status: 'running', at: Date.now(), toolCount: 5 };
    if (running.status === 'running') {
      expect(running.toolCount).toBe(5);
    }

    const err: AgentState = { status: 'error', at: Date.now(), error: 'crash', code: 1 };
    if (err.status === 'error') {
      expect(err.error).toBe('crash');
      expect(err.code).toBe(1);
    }

    const stopped: AgentState = { status: 'stopped', at: Date.now(), exitCode: 0 };
    if (stopped.status === 'stopped') {
      expect(stopped.exitCode).toBe(0);
    }
  });
});

describe('canTransition', () => {
  it('agrees with VALID_TRANSITIONS for every pair', async () => {
    const { canTransition } = await import('../types/agent.js');
    const all = Object.keys(VALID_TRANSITIONS);
    for (const from of all) {
      for (const to of all) {
        expect(canTransition(from, to)).toBe(VALID_TRANSITIONS[from].includes(to));
      }
    }
  });

  it('rejects unknown states and never leaves terminal states', async () => {
    const { canTransition } = await import('../types/agent.js');
    expect(canTransition('bogus', 'idle')).toBe(false);
    expect(canTransition('stopped', 'idle')).toBe(false);
    expect(canTransition('error', 'idle')).toBe(false);
    expect(canTransition('idle', 'executing')).toBe(true);
  });
});
