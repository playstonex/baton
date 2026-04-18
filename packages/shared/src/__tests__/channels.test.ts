import { describe, it, expect } from 'vitest';
import {
  Channel,
  encodeFrame,
  decodeFrame,
  encodeJsonFrame,
  encodeTerminalFrame,
  decodeJsonFrame,
} from '../protocol/channels.js';

describe('Binary Protocol Channels', () => {
  it('encodes and decodes a control frame', () => {
    const payload = new TextEncoder().encode('{"type":"hello"}');
    const frame = encodeFrame(Channel.Control, payload);

    expect(frame[0]).toBe(Channel.Control);
    expect(frame.length).toBe(9 + payload.length);

    const decoded = decodeFrame(frame);
    expect(decoded.channel).toBe(Channel.Control);
    expect(decoded.payload).toEqual(payload);
    expect(decoded.timestamp).toBeGreaterThan(0);
  });

  it('encodes and decodes a terminal frame', () => {
    const payload = new TextEncoder().encode('Hello terminal');
    const frame = encodeFrame(Channel.Terminal, payload);
    const decoded = decodeFrame(frame);

    expect(decoded.channel).toBe(Channel.Terminal);
    expect(new TextDecoder().decode(decoded.payload)).toBe('Hello terminal');
  });

  it('encodes and decodes an events frame', () => {
    const payload = new TextEncoder().encode('{"type":"tool_use","tool":"read"}');
    const frame = encodeFrame(Channel.Events, payload);
    const decoded = decodeFrame(frame);

    expect(decoded.channel).toBe(Channel.Events);
  });

  it('rejects frames that are too short', () => {
    const short = new Uint8Array(5);
    expect(() => decodeFrame(short)).toThrow('Frame too short');
  });

  it('rejects invalid channel', () => {
    const invalid = new Uint8Array(10);
    invalid[0] = 99;
    expect(() => decodeFrame(invalid)).toThrow('Invalid channel');
  });

  it('encodes JSON frame helper', () => {
    const frame = encodeJsonFrame(Channel.Control, { type: 'hello', version: 1 });
    const decoded = decodeFrame(frame);
    const parsed = decodeJsonFrame<{ type: string; version: number }>(decoded);
    expect(parsed.type).toBe('hello');
    expect(parsed.version).toBe(1);
  });

  it('encodes terminal frame from string', () => {
    const frame = encodeTerminalFrame('ls -la\n');
    const decoded = decodeFrame(frame);
    expect(decoded.channel).toBe(Channel.Terminal);
    expect(new TextDecoder().decode(decoded.payload)).toBe('ls -la\n');
  });

  it('encodes terminal frame from Uint8Array', () => {
    const data = new Uint8Array([1, 2, 3, 4]);
    const frame = encodeTerminalFrame(data);
    const decoded = decodeFrame(frame);
    expect(decoded.payload).toEqual(data);
  });

  it('preserves timestamp ordering', async () => {
    const f1 = encodeFrame(Channel.Control, new Uint8Array(0));
    await new Promise((r) => setTimeout(r, 2));
    const f2 = encodeFrame(Channel.Control, new Uint8Array(0));

    const d1 = decodeFrame(f1);
    const d2 = decodeFrame(f2);
    expect(d2.timestamp).toBeGreaterThanOrEqual(d1.timestamp);
  });
});
