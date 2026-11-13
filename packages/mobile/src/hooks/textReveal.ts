/**
 * Paced reveal for streaming assistant text.
 *
 * Deltas arrive lumpy: the daemon/provider sends chunk bursts of characters
 * (especially fast models like GLM 5.3 Flash or local models).
 * Painting each delta as it lands makes the text jump in jarring blocks.
 *
 * Pacing derives the reveal rate from the backlog:
 * A burst makes the text catch up faster without jumping.
 */

export const TEXT_REVEAL_HORIZON_MS = 140;
export const TEXT_REVEAL_FRAME_INTERVAL_MS = 1000 / 60; // 60Hz rate limit
const MAX_ELAPSED_MS = 250;

export function computeRevealStep(input: {
  backlog: number;
  elapsedMs: number;
  horizonMs?: number;
}): number {
  const { backlog } = input;
  if (backlog <= 0) return 0;

  const horizonMs = input.horizonMs ?? TEXT_REVEAL_HORIZON_MS;
  if (horizonMs <= 0) return backlog;

  const elapsedMs = Math.min(Math.max(input.elapsedMs, 0), MAX_ELAPSED_MS);
  if (elapsedMs <= 0) return 0;
  if (elapsedMs >= horizonMs) return backlog;

  const step = Math.ceil((backlog * elapsedMs) / horizonMs);
  return Math.min(backlog, Math.max(1, step));
}

const graphemeSegmenter =
  typeof Intl !== 'undefined' && typeof (Intl as { Segmenter?: any }).Segmenter === 'function'
    ? new (Intl as any).Segmenter(undefined, { granularity: 'grapheme' })
    : null;

export function isTextRevealPacingSupported(): boolean {
  return graphemeSegmenter !== null;
}

export function clampToSafeRevealBoundary(text: string, index: number): number {
  if (index <= 0) return 0;
  if (index >= text.length) return text.length;

  const segment = graphemeSegmenter?.segment(text).containing(index);
  return segment?.index ?? index;
}

export interface TextRevealFrame {
  elapsedMs: number;
  frameAtMs: number;
}

export function nextTextRevealFrame(
  previousFrameAtMs: number | null,
  timestampMs: number,
): TextRevealFrame | null {
  const elapsedMs =
    previousFrameAtMs === null ? TEXT_REVEAL_FRAME_INTERVAL_MS : timestampMs - previousFrameAtMs;
  if (elapsedMs < TEXT_REVEAL_FRAME_INTERVAL_MS) {
    return null;
  }
  return {
    elapsedMs,
    frameAtMs: timestampMs - (elapsedMs % TEXT_REVEAL_FRAME_INTERVAL_MS),
  };
}

export interface TextRevealState {
  readonly target: string;
  readonly revealed: number;
}

export function beginTextReveal(text: string): TextRevealState {
  return { target: text, revealed: text.length };
}

export function retargetTextReveal(state: TextRevealState, text: string): TextRevealState {
  if (state.target === text) return state;
  // If target got shorter, message was replaced/reset
  return { target: text, revealed: Math.min(state.revealed, text.length) };
}

export function advanceTextReveal(
  state: TextRevealState,
  elapsedMs: number,
  horizonMs?: number,
): TextRevealState {
  const step = computeRevealStep({
    backlog: state.target.length - state.revealed,
    elapsedMs,
    ...(horizonMs !== undefined ? { horizonMs } : {}),
  });
  if (step <= 0) return state;
  return { target: state.target, revealed: Math.min(state.target.length, state.revealed + step) };
}

export function completeTextReveal(state: TextRevealState): TextRevealState {
  if (state.revealed >= state.target.length) return state;
  return { target: state.target, revealed: state.target.length };
}

export function isTextRevealSettled(state: TextRevealState): boolean {
  return state.revealed >= state.target.length;
}

export function visibleRevealedText(
  state: TextRevealState,
  _options?: { streaming?: boolean },
): string {
  if (state.revealed >= state.target.length) {
    return state.target;
  }
  return state.target.slice(0, clampToSafeRevealBoundary(state.target, state.revealed));
}
