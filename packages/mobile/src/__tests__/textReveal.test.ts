import { describe, it, expect } from 'vitest';
import {
  computeRevealStep,
  clampToSafeRevealBoundary,
  beginTextReveal,
  retargetTextReveal,
  advanceTextReveal,
  completeTextReveal,
  isTextRevealSettled,
  visibleRevealedText,
  TEXT_REVEAL_HORIZON_MS,
} from '../hooks/textReveal';

describe('textReveal pacing', () => {
  it('reveals whole text on initial beginTextReveal', () => {
    const text = 'Hello world from Baton!';
    const state = beginTextReveal(text);
    expect(state.target).toBe(text);
    expect(state.revealed).toBe(text.length);
    expect(isTextRevealSettled(state)).toBe(true);
  });

  it('computes step proportional to backlog over elapsed time', () => {
    const backlog = 100;
    // Over a 16.6ms frame with 140ms horizon
    const step = computeRevealStep({ backlog, elapsedMs: 16.6, horizonMs: 140 });
    expect(step).toBeGreaterThan(5);
    expect(step).toBeLessThan(25);
  });

  it('returns full backlog if elapsed exceeds horizon', () => {
    const backlog = 50;
    const step = computeRevealStep({ backlog, elapsedMs: 200, horizonMs: 140 });
    expect(step).toBe(50);
  });

  it('advances revealed characters monotonically', () => {
    let state = { target: '12345678901234567890', revealed: 0 };
    state = advanceTextReveal(state, 16.6, 140);
    expect(state.revealed).toBeGreaterThan(0);
    const firstRevealed = state.revealed;

    state = advanceTextReveal(state, 16.6, 140);
    expect(state.revealed).toBeGreaterThan(firstRevealed);
  });

  it('completes reveal immediately when turn ends', () => {
    const state = { target: 'Full completed turn text', revealed: 5 };
    const completed = completeTextReveal(state);
    expect(completed.revealed).toBe(completed.target.length);
    expect(isTextRevealSettled(completed)).toBe(true);
  });

  it('retargetTextReveal preserves revealed count if text grows', () => {
    const initial = { target: 'Hello', revealed: 5 };
    const grown = retargetTextReveal(initial, 'Hello world');
    expect(grown.revealed).toBe(5);
    expect(grown.target).toBe('Hello world');
    expect(isTextRevealSettled(grown)).toBe(false);
  });

  it('clamps to safe boundary', () => {
    const text = 'Hello world';
    expect(clampToSafeRevealBoundary(text, 5)).toBe(5);
    expect(clampToSafeRevealBoundary(text, 0)).toBe(0);
    expect(clampToSafeRevealBoundary(text, 100)).toBe(text.length);
  });
});
