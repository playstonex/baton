import { describe, it, expect } from 'vitest';
import {
  deriveActivitySummary,
  formatActivityDuration,
  normalizeActivityStep,
} from '../components/messages/activitySummary';
import type { ChatMessage } from '../stores/chat';

function makeMsg(partial: Partial<ChatMessage>): ChatMessage {
  return {
    id: 'm-1',
    turnId: 't-1',
    role: 'system',
    kind: 'toolActivity',
    content: 'Read App.tsx',
    timestamp: 1000,
    ...partial,
  };
}

describe('activitySummary', () => {
  describe('formatActivityDuration', () => {
    it('formats subsecond times', () => {
      expect(formatActivityDuration(400)).toBe('0.4s');
      expect(formatActivityDuration(950)).toBe('1.0s');
    });

    it('formats seconds', () => {
      expect(formatActivityDuration(3400)).toBe('3s');
      expect(formatActivityDuration(18000)).toBe('18s');
    });

    it('formats minutes and seconds', () => {
      expect(formatActivityDuration(75000)).toBe('1m 15s');
    });

    it('handles zero or negative duration', () => {
      expect(formatActivityDuration(0)).toBe('');
      expect(formatActivityDuration(-500)).toBe('');
    });
  });

  describe('normalizeActivityStep', () => {
    it('normalizes thinking message', () => {
      const msg = makeMsg({
        kind: 'thinking',
        content: 'Analyzing the monorepo architecture and dependencies',
        isStreaming: false,
      });
      const step = normalizeActivityStep(msg);
      expect(step.kind).toBe('thinking');
      expect(step.verb).toBe('Thought process');
      expect(step.target).toBe('6 words');
      expect(step.status).toBe('completed');
    });

    it('normalizes streaming thinking message', () => {
      const msg = makeMsg({
        kind: 'thinking',
        content: 'Evaluating...',
        isStreaming: true,
      });
      const step = normalizeActivityStep(msg);
      expect(step.verb).toBe('Thinking');
      expect(step.status).toBe('running');
    });

    it('normalizes command execution message', () => {
      const msg = makeMsg({
        kind: 'commandExecution',
        content: 'git status',
        meta: { command: 'git status', exitCode: 0, durationMs: 120 },
      });
      const step = normalizeActivityStep(msg);
      expect(step.kind).toBe('commandExecution');
      expect(step.verb).toBe('Checked');
      expect(step.target).toBe('git status');
      expect(step.status).toBe('completed');
      expect(step.duration).toBe('0.1s');
    });

    it('marks command as failed when exitCode is non-zero', () => {
      const msg = makeMsg({
        kind: 'commandExecution',
        content: 'pnpm test',
        meta: { command: 'pnpm test', exitCode: 1 },
      });
      const step = normalizeActivityStep(msg);
      expect(step.status).toBe('failed');
    });

    it('normalizes toolActivity message', () => {
      const msg = makeMsg({
        kind: 'toolActivity',
        content: 'Read src/index.ts',
        meta: { tool: 'Read', filePath: 'src/index.ts', durationMs: 350 },
      });
      const step = normalizeActivityStep(msg);
      expect(step.verb).toBe('Read');
      expect(step.target).toBe('src/index.ts');
      expect(step.status).toBe('completed');
      expect(step.duration).toBe('0.4s');
    });

    it('normalizes fileChange message', () => {
      const msg = makeMsg({
        kind: 'fileChange',
        content: 'Modified packages/mobile/src/App.tsx',
        meta: { path: 'packages/mobile/src/App.tsx', changeType: 'modify' },
      });
      const step = normalizeActivityStep(msg);
      expect(step.verb).toBe('Modified');
      expect(step.target).toBe('packages/mobile/src/App.tsx');
    });
  });

  describe('deriveActivitySummary', () => {
    it('summarizes a single completed command', () => {
      const msgs = [
        makeMsg({
          kind: 'commandExecution',
          content: 'git status',
          meta: { command: 'git status', exitCode: 0, durationMs: 200 },
        }),
      ];
      const summary = deriveActivitySummary(msgs, false);
      expect(summary.totalSteps).toBe(1);
      expect(summary.isActive).toBe(false);
      expect(summary.hasError).toBe(false);
      expect(summary.title).toBe('Checked git status');
      expect(summary.pills).toContain('1 tool');
    });

    it('summarizes multiple completed tools and file changes', () => {
      const msgs = [
        makeMsg({
          id: 'm-1',
          kind: 'thinking',
          content: 'Let me inspect the files',
          timestamp: 1000,
        }),
        makeMsg({
          id: 'm-2',
          kind: 'toolActivity',
          content: 'Read package.json',
          meta: { tool: 'Read', filePath: 'package.json' },
          timestamp: 2000,
        }),
        makeMsg({
          id: 'm-3',
          kind: 'fileChange',
          content: 'Modified package.json',
          meta: { path: 'package.json', changeType: 'modify' },
          timestamp: 3500,
        }),
      ];

      const summary = deriveActivitySummary(msgs, false);
      expect(summary.totalSteps).toBe(3);
      expect(summary.isActive).toBe(false);
      expect(summary.hasFileChanges).toBe(true);
      expect(summary.fileChangesCount).toBe(1);
      expect(summary.durationMs).toBe(2500);
      expect(summary.formattedDuration).toBe('3s');
      expect(summary.title).toBe('Completed 3 steps');
      expect(summary.pills).toContain('1 tool');
      expect(summary.pills).toContain('1 file');
    });

    it('shows active status when stream is active or message is streaming', () => {
      const msgs = [
        makeMsg({
          id: 'm-1',
          kind: 'thinking',
          content: 'Thinking...',
          isStreaming: true,
        }),
      ];
      const summary = deriveActivitySummary(msgs, true);
      expect(summary.isActive).toBe(true);
      expect(summary.title).toBe('Thinking…');
    });

    it('flags error if any step failed', () => {
      const msgs = [
        makeMsg({
          id: 'm-1',
          kind: 'commandExecution',
          content: 'pnpm build',
          meta: { command: 'pnpm build', exitCode: 2 },
        }),
      ];
      const summary = deriveActivitySummary(msgs, false);
      expect(summary.hasError).toBe(true);
    });
  });
});
