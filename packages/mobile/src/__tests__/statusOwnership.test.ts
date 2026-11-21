import { beforeEach, describe, expect, it } from 'vitest';
import type { ParsedEvent } from '@baton/shared';
import { useChatStore } from '../stores/chat';

/**
 * agentStatus is owned by the daemon's `status_update` (setStatus). Raw
 * parser events can be rejected by the daemon's state machine, so they must
 * never move the status the UI shows.
 */
describe('chat store status ownership', () => {
  beforeEach(() => {
    useChatStore.setState({ agentStatus: 'thinking' });
  });

  it('ignores raw status_change events', () => {
    useChatStore
      .getState()
      .addEvent({ type: 'status_change', status: 'idle', timestamp: 1 } as ParsedEvent);
    expect(useChatStore.getState().agentStatus).toBe('thinking');
  });

  it('ignores turn_boundary end events', () => {
    useChatStore.getState().addEvent({
      type: 'turn_boundary',
      turnId: 't1',
      direction: 'end',
      timestamp: 1,
    } as ParsedEvent);
    expect(useChatStore.getState().agentStatus).toBe('thinking');
  });

  it('setStatus applies the daemon status and detail', () => {
    useChatStore.getState().setStatus('executing', { tool: 'Bash' } as never);
    expect(useChatStore.getState().agentStatus).toBe('executing');
  });

  it('setStatus(idle) settles the turn', () => {
    useChatStore.setState({ waitingApproval: true });
    useChatStore.getState().setStatus('idle');
    const s = useChatStore.getState();
    expect(s.agentStatus).toBe('idle');
    expect(s.waitingApproval).toBe(false);
    expect(s.activePrompt).toBeNull();
  });
});
