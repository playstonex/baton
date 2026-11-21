import { describe, it, expect } from 'vitest';
import {
  buildProjectLabels,
  canonicalAgentType,
  deriveSessionBucket,
  describeSessionStatus,
  groupSessions,
  mostUrgentBucket,
  sessionMatchesQuery,
  UNKNOWN_PROJECT_LABEL,
  type SessionListItem,
} from '../utils/session-list.js';

const NOW = 1_700_000_000_000;
const HOUR = 3_600_000;

function item(overrides: Partial<SessionListItem> & { id: string }): SessionListItem {
  return {
    type: 'codex',
    projectPath: '/work/app',
    status: 'idle',
    lastActivity: NOW,
    ...overrides,
  };
}

describe('deriveSessionBucket', () => {
  it('maps every status', () => {
    expect(deriveSessionBucket('waiting_input')).toBe('needs_input');
    expect(deriveSessionBucket('error')).toBe('failed');
    for (const status of ['starting', 'running', 'thinking', 'executing'] as const) {
      expect(deriveSessionBucket(status)).toBe('running');
    }
    expect(deriveSessionBucket('idle')).toBe('idle');
    expect(deriveSessionBucket('stopped')).toBe('done');
  });

  it('picks the most urgent bucket', () => {
    expect(mostUrgentBucket(['done', 'running', 'idle'])).toBe('running');
    expect(mostUrgentBucket(['running', 'needs_input'])).toBe('needs_input');
    expect(mostUrgentBucket([])).toBe('done');
  });
});

describe('canonicalAgentType', () => {
  it('folds SDK variants and legacy aliases', () => {
    expect(canonicalAgentType('claude-code-sdk')).toBe('claude-code');
    expect(canonicalAgentType('codex-sdk')).toBe('codex');
    expect(canonicalAgentType('kiro-cli-acp')).toBe('kiro');
    expect(canonicalAgentType('pi')).toBe('pi');
  });
});

describe('buildProjectLabels', () => {
  it('uses the last folder name', () => {
    const labels = buildProjectLabels(['/Users/me/baton', '/Users/me/site/']);
    expect(labels.get('/Users/me/baton')).toBe('baton');
    expect(labels.get('/Users/me/site/')).toBe('site');
  });

  it('adds parent folders only for clashing names', () => {
    const labels = buildProjectLabels(['/work/app', '/play/app', '/work/api']);
    expect(labels.get('/work/app')).toBe('work/app');
    expect(labels.get('/play/app')).toBe('play/app');
    expect(labels.get('/work/api')).toBe('api');
  });

  it('falls back for empty paths', () => {
    const labels = buildProjectLabels(['', undefined, null]);
    expect(labels.get('')).toBe(UNKNOWN_PROJECT_LABEL);
  });

  it('terminates when clashing paths cannot be told apart', () => {
    const labels = buildProjectLabels(['/a/app', 'a/app']);
    expect(labels.get('/a/app')).toBe('a/app');
  });
});

describe('groupSessions', () => {
  const labels = buildProjectLabels(['/work/app', '/work/api', '/work/docs']);

  it('groups by project, urgent projects first, then by recency', () => {
    const groups = groupSessions(
      [
        item({ id: 'a1', projectPath: '/work/app', status: 'idle', lastActivity: NOW }),
        item({
          id: 'b1',
          projectPath: '/work/api',
          status: 'waiting_input',
          lastActivity: NOW - 5 * HOUR,
        }),
        item({ id: 'c1', projectPath: '/work/docs', status: 'stopped', lastActivity: NOW - HOUR }),
      ],
      'project',
      { projectLabels: labels, now: NOW },
    );
    expect(groups.map((group) => group.title)).toEqual(['api', 'app', 'docs']);
    expect(groups[0].bucket).toBe('needs_input');
  });

  it('orders rows inside a project by urgency, then recency', () => {
    const [group] = groupSessions(
      [
        item({ id: 'old-idle', status: 'idle', lastActivity: NOW - HOUR }),
        item({ id: 'new-done', status: 'stopped', lastActivity: NOW }),
        item({ id: 'running', status: 'thinking', lastActivity: NOW - 2 * HOUR }),
      ],
      'project',
      { projectLabels: labels, now: NOW },
    );
    expect(group.items.map((row) => row.id)).toEqual(['running', 'old-idle', 'new-done']);
    expect(group.bucket).toBe('running');
  });

  it('groups by status in urgency order and skips empty buckets', () => {
    const groups = groupSessions(
      [
        item({ id: '1', status: 'stopped' }),
        item({ id: '2', status: 'error' }),
        item({ id: '3', status: 'executing' }),
      ],
      'status',
      { projectLabels: labels, now: NOW },
    );
    expect(groups.map((group) => group.title)).toEqual(['Error', 'Working', 'Stopped']);
  });

  it('groups by time', () => {
    const groups = groupSessions(
      [
        item({ id: 'old', lastActivity: NOW - 30 * 24 * HOUR }),
        item({ id: 'today', lastActivity: NOW - HOUR }),
        item({ id: 'week', lastActivity: NOW - 3 * 24 * HOUR }),
        item({ id: 'yesterday', lastActivity: NOW - 30 * HOUR }),
      ],
      'time',
      { projectLabels: labels, now: NOW },
    );
    expect(groups.map((group) => group.title)).toEqual([
      'Today',
      'Yesterday',
      'Previous 7 Days',
      'Older',
    ]);
  });
});

describe('describeSessionStatus', () => {
  it('shows the question a blocked session is waiting on', () => {
    const text = describeSessionStatus(
      item({
        id: 'x',
        status: 'waiting_input',
        detail: { since: 1, prompt: 'Allow   edit\nof file?' },
      }),
    );
    expect(text).toBe('Allow edit of file?');
  });

  it('shows the running tool and truncates long text', () => {
    expect(
      describeSessionStatus(
        item({ id: 'x', status: 'executing', detail: { since: 1, tool: 'Bash' } }),
      ),
    ).toBe('Bash');
    const long = describeSessionStatus(
      item({ id: 'x', status: 'error', detail: { since: 1, error: 'e'.repeat(100) } }),
      10,
    );
    expect(long).toHaveLength(10);
    expect(long.endsWith('…')).toBe(true);
  });

  it('falls back without detail', () => {
    expect(describeSessionStatus(item({ id: 'x', status: 'waiting_input' }))).toBe(
      'Waiting for you',
    );
    expect(describeSessionStatus(item({ id: 'x', status: 'stopped' }))).toBe('Stopped');
  });
});

describe('sessionMatchesQuery', () => {
  const session = item({ id: 'x', title: 'Fix login', type: 'claude-code-sdk' });
  it('matches title, project label and agent', () => {
    expect(sessionMatchesQuery(session, 'login', 'app')).toBe(true);
    expect(sessionMatchesQuery(session, 'APP', 'app')).toBe(true);
    expect(sessionMatchesQuery(session, 'claude', 'app')).toBe(true);
    expect(sessionMatchesQuery(session, 'zzz', 'app')).toBe(false);
    expect(sessionMatchesQuery(session, '  ', 'app')).toBe(true);
  });
});
