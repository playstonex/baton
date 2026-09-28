import { describe, it, expect } from 'vitest';
import { SeqBuffer } from '../protocol/seq-buffer.js';
import type { TerminalOutputMessage } from '../protocol/index.js';

function terminalMsg(sessionId: string, data: string): TerminalOutputMessage {
  return { type: 'terminal_output', sessionId, data };
}

describe('SeqBuffer', () => {
  it('assigns monotonic seq starting at 1', () => {
    const buf = new SeqBuffer();
    expect(buf.push(terminalMsg('s', 'a'))).toBe(1);
    expect(buf.push(terminalMsg('s', 'b'))).toBe(2);
    expect(buf.currentSeq).toBe(2);
  });

  it('replays everything after lastSeq in order', () => {
    const buf = new SeqBuffer();
    buf.push(terminalMsg('s', 'a')); // 1
    buf.push(terminalMsg('s', 'b')); // 2
    buf.push(terminalMsg('s', 'c')); // 3
    const r = buf.replay(1);
    expect(r.messages.map((m) => m.seq)).toEqual([2, 3]);
    expect(r.fromSeq).toBe(2);
    expect(r.toSeq).toBe(3);
    expect(r.gap).toBe(false);
  });

  it('returns empty messages when lastSeq is current', () => {
    const buf = new SeqBuffer();
    buf.push(terminalMsg('s', 'a')); // 1
    const r = buf.replay(1);
    expect(r.messages).toEqual([]);
    expect(r.gap).toBe(false);
  });

  it('evicts oldest when over message cap', () => {
    const buf = new SeqBuffer({ maxMessages: 3 });
    buf.push(terminalMsg('s', 'a')); // 1
    buf.push(terminalMsg('s', 'b')); // 2
    buf.push(terminalMsg('s', 'c')); // 3
    buf.push(terminalMsg('s', 'd')); // 4 — evicts seq 1
    expect(buf.floorSeq).toBe(2);
    expect(buf.currentSeq).toBe(4);
  });

  it('flags gap when lastSeq is behind the buffer floor', () => {
    const buf = new SeqBuffer({ maxMessages: 3 });
    buf.push(terminalMsg('s', 'a')); // 1
    buf.push(terminalMsg('s', 'b')); // 2
    buf.push(terminalMsg('s', 'c')); // 3
    buf.push(terminalMsg('s', 'd')); // 4 — evicts seq 1, floor now 2
    // Client asks for everything after seq 0, but seq 1 is gone.
    const r = buf.replay(0);
    expect(r.gap).toBe(true);
    expect(r.messages.map((m) => m.seq)).toEqual([2, 3, 4]);
  });

  it('respects the byte cap', () => {
    const buf = new SeqBuffer({ maxBytes: 100 });
    for (let i = 0; i < 50; i++) {
      buf.push(terminalMsg('s', 'x'.repeat(20)));
    }
    // Each msg ~50 bytes serialized; cap 100 → at most ~2 retained.
    expect(buf.floorSeq).toBeGreaterThan(40);
  });

  it('mutates the message to attach seq', () => {
    const buf = new SeqBuffer();
    const m = terminalMsg('s', 'a');
    expect(m.seq).toBeUndefined();
    buf.push(m);
    expect(m.seq).toBe(1);
  });

  it('clear() empties the buffer and resets nothing about seq', () => {
    const buf = new SeqBuffer();
    buf.push(terminalMsg('s', 'a')); // 1
    buf.push(terminalMsg('s', 'b')); // 2
    buf.clear();
    // nextSeq continues monotonically (not reset) — important so a client
    // that reconnects mid-clear doesn't see a duplicate seq.
    expect(buf.push(terminalMsg('s', 'c'))).toBe(3);
    expect(buf.currentSeq).toBe(3);
  });

  it('flags gap when lastSeq is ahead of currentSeq (daemon restart / buffer recreated)', () => {
    // Client saw seq 500 from a previous daemon process; the new buffer restarted at 1.
    const buf = new SeqBuffer();
    buf.push(terminalMsg('s', 'a')); // 1
    const r = buf.replay(500);
    expect(r.gap).toBe(true);
    expect(r.messages).toEqual([]);
  });

  it('flags gap for a stale lastSeq against an empty fresh buffer', () => {
    const buf = new SeqBuffer();
    expect(buf.replay(42).gap).toBe(true);
    expect(buf.replay(0).gap).toBe(false);
  });
});

