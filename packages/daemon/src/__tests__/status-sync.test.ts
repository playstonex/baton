import { describe, it, expect, beforeAll } from 'bun:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ParsedEvent } from '@baton/shared';
import { foldTerminalInput, isFreshOutput, outputSignature } from '../agent/activity.js';

describe('isFreshOutput (redraw filter)', () => {
  it('ignores empty / glyph-only / digit-only chunks', () => {
    const recent: string[] = [];
    expect(isFreshOutput(recent, '   \r\n')).toBe(false);
    expect(isFreshOutput(recent, '\x1b[2K⠋ 12s')).toBe(false);
    expect(isFreshOutput(recent, '╭────╮')).toBe(false);
  });

  it('treats spinner frames that differ only by glyph/timer as one redraw', () => {
    const recent: string[] = [];
    expect(isFreshOutput(recent, '✻ Thinking… (3s)')).toBe(true);
    expect(isFreshOutput(recent, '✶ Thinking… (4s)')).toBe(false);
    expect(isFreshOutput(recent, '✳ Thinking… (5s)')).toBe(false);
  });

  it('catches alternating frames (A, B, A, B)', () => {
    const recent: string[] = [];
    expect(isFreshOutput(recent, 'Working')).toBe(true);
    expect(isFreshOutput(recent, 'Esc to interrupt')).toBe(true);
    expect(isFreshOutput(recent, 'Working 2s')).toBe(false);
    expect(isFreshOutput(recent, 'Esc to interrupt 2s')).toBe(false);
  });

  it('counts genuinely new text as activity', () => {
    const recent: string[] = [];
    isFreshOutput(recent, 'Reading file a.ts');
    expect(isFreshOutput(recent, 'Editing file b.ts')).toBe(true);
    expect(outputSignature('\x1b[1mHi 1\x1b[0m')).toBe('Hi');
  });

  it('forgets signatures older than the window', () => {
    const recent: string[] = [];
    isFreshOutput(recent, 'alpha');
    for (const w of ['b', 'c', 'd', 'e', 'f', 'g', 'h']) isFreshOutput(recent, `word${w}x`);
    expect(isFreshOutput(recent, 'alpha')).toBe(true);
  });
});

describe('foldTerminalInput', () => {
  it('submits only after non-empty text + Enter', () => {
    expect(foldTerminalInput('', '\r').submitted).toBe(false);
    const typed = foldTerminalInput('', 'hello');
    expect(typed).toMatchObject({ line: 'hello', submitted: false, answered: true });
    expect(foldTerminalInput(typed.line, '\r')).toMatchObject({ line: '', submitted: true });
  });

  it('ignores arrows and editing keys; backspace and Ctrl-C clear text', () => {
    expect(foldTerminalInput('', '\x1b[A\x1b[B').answered).toBe(false);
    expect(foldTerminalInput('ab', '\x7f\x7f\r').submitted).toBe(false);
    expect(foldTerminalInput('abc', '\x03\r').submitted).toBe(false);
  });

  it('handles bracketed paste with and without trailing Enter', () => {
    expect(foldTerminalInput('', '\x1b[200~fix the bug\x1b[201~').submitted).toBe(false);
    expect(foldTerminalInput('', '\x1b[200~fix the bug\x1b[201~\r').submitted).toBe(true);
    expect(foldTerminalInput('', '\x1b[200~a\nb\x1b[201~').submitted).toBe(true);
  });

  it('flags a bare Enter as an answer (menu confirm) but not a submission', () => {
    expect(foldTerminalInput('', '\r')).toMatchObject({ submitted: false, answered: true });
  });
});

describe('AgentManager turn status (PTY)', () => {
  let Manager: typeof import('../agent/manager.js').AgentManager;

  beforeAll(async () => {
    process.env.BATON_HOME = await mkdtemp(join(tmpdir(), 'baton-status-sync-'));
    ({ AgentManager: Manager } = await import('../agent/manager.js'));
  });

  function setup(status: string) {
    const manager = new Manager();
    const id = `status-sync-${status}-${Math.random().toString(36).slice(2, 8)}`;
    const writes: string[] = [];
    const events: ParsedEvent[] = [];
    const managed: any = {
      process: {
        id,
        type: 'claude-code',
        status,
        projectPath: '/tmp/proj',
        startedAt: new Date().toISOString(),
      },
      state: { status, at: Date.now(), prompt: '' },
      eventHistory: [],
      displayHistory: [],
      outputHistory: [],
      timeline: [],
      eventCallbacks: new Set([(e: ParsedEvent) => events.push(e)]),
      rawCallbacks: new Set(),
      firstOutputReceived: true,
      pty: { write: (d: string) => writes.push(d), kill: () => {} },
    };
    (manager as any).agents.set(id, managed);
    return { manager, id, managed, writes, events };
  }

  it('submitting text from idle marks the session thinking and records one event', () => {
    const { manager, id, events } = setup('idle');
    manager.write(id, 'fix it');
    expect(manager.get(id)?.status).toBe('idle');
    manager.write(id, '\r');
    expect(manager.get(id)?.status).toBe('thinking');
    expect(events.filter((e) => e.type === 'status_change')).toHaveLength(1);
  });

  it('a bare Enter or arrow keys in idle do not start a turn', () => {
    const { manager, id } = setup('idle');
    manager.write(id, '\r');
    manager.write(id, '\x1b[A');
    expect(manager.get(id)?.status).toBe('idle');
  });

  it('answering a permission prompt resumes work', () => {
    const { manager, id } = setup('waiting_input');
    manager.write(id, '\x1b[B'); // navigating the menu is not an answer
    expect(manager.get(id)?.status).toBe('waiting_input');
    manager.write(id, '1');
    expect(manager.get(id)?.status).toBe('thinking');
  });

  it('cancelTurn returns a busy session to idle and is a no-op once stopped', async () => {
    const busy = setup('thinking');
    await busy.manager.cancelTurn(busy.id);
    expect(busy.manager.get(busy.id)?.status).toBe('idle');

    const dead = setup('stopped');
    await dead.manager.cancelTurn(dead.id).catch(() => {});
    expect(dead.manager.get(dead.id)?.status).toBe('stopped');
  });

  it('chatWrite starts a turn for PTY sessions', () => {
    const { manager, id, writes } = setup('idle');
    manager.chatWrite(id, 'hello');
    expect(writes.length).toBeGreaterThan(0);
    expect(manager.get(id)?.status).toBe('thinking');
  });
});
