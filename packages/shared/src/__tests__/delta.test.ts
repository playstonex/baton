import { describe, it, expect } from 'vitest';
import { DeltaCompressor } from '../utils/delta.js';

describe('DeltaCompressor', () => {
  it('sends full data when no previous state', () => {
    const dc = new DeltaCompressor();
    expect(dc.compress('s1', 'hello')).toBe('hello');
  });

  it('sends only delta when content is appended', () => {
    const dc = new DeltaCompressor();
    dc.compress('s1', 'hello');
    expect(dc.compress('s1', 'hello world')).toBe(' world');
  });

  it('sends full data when content changes completely', () => {
    const dc = new DeltaCompressor();
    dc.compress('s1', 'hello');
    expect(dc.compress('s1', 'world')).toBe('world');
  });

  it('handles different sessions independently', () => {
    const dc = new DeltaCompressor();
    dc.compress('s1', 'hello');
    dc.compress('s2', 'foo');
    expect(dc.compress('s1', 'hello world')).toBe(' world');
    expect(dc.compress('s2', 'foo bar')).toBe(' bar');
  });

  it('reset clears state for a session', () => {
    const dc = new DeltaCompressor();
    dc.compress('s1', 'hello');
    dc.reset('s1');
    expect(dc.compress('s1', 'hello world')).toBe('hello world');
  });

  it('compressChunk passes through unchanged', () => {
    const dc = new DeltaCompressor();
    expect(dc.compressChunk('s1', 'raw')).toBe('raw');
  });
});
