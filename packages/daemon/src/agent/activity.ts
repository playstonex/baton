import { stripAnsi } from '../parser/ansi.js';

/**
 * Pure helpers behind the PTY status heuristics (turn start / real output).
 * Kept free of manager state so they can be unit-tested directly.
 */

/** How many recent output signatures are remembered for redraw detection. */
export const SIGNATURE_WINDOW = 6;

/**
 * Whitespace, digits, braille/box/block glyphs, spinner glyphs and common
 * punctuation. Timers ("12s"), token counters and spinner frames only differ
 * in these characters.
 */
const NOISE = /[\s\d\u2800-\u28FF\u2500-\u257F\u2580-\u259F✻✶✳✢✽·•*|/\\\-.…]+/g;

/** Elapsed-time / token counters such as "12s", "1m 3s", "2.4k tokens". */
const COUNTER = /\b\d+(?:\.\d+)?\s*(?:ms|[smhkKM]|tokens?)\b/g;

/** Reduce a PTY chunk to the letters that would survive a spinner redraw. */
export function outputSignature(data: string): string {
  return stripAnsi(data).replace(COUNTER, ' ').replace(NOISE, '');
}

/**
 * Decide whether a chunk is real content. `recent` is the caller's window of
 * previous signatures (mutated). A chunk is a redraw when its signature is
 * empty or equals any of the last SIGNATURE_WINDOW signatures, which also
 * catches alternating spinner frames (A, B, A, B) that a single-slot compare
 * would count as new output every time.
 *
 * Limitation: output whose letters repeat exactly inside the window (only a
 * number changing, e.g. a bare progress counter) is treated as a redraw.
 */
export function isFreshOutput(recent: string[], data: string): boolean {
  const sig = outputSignature(data);
  if (!sig) return false;
  if (recent.includes(sig)) return false;
  recent.push(sig);
  if (recent.length > SIGNATURE_WINDOW) recent.shift();
  return true;
}

const ESCAPES = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b./g;

export interface InputFold {
  /** Line buffer after applying the keystrokes. */
  line: string;
  /** An Enter followed non-empty text (a real prompt was submitted). */
  submitted: boolean;
  /** The data contained an Enter or a printable key (answers a menu/prompt). */
  answered: boolean;
}

/**
 * Fold raw keystrokes into a line buffer. Escape sequences (arrows, bracketed
 * paste markers) never count as text. Pasted text that contains newlines
 * submits once per non-empty line, which is what the TUI does with it.
 */
export function foldTerminalInput(line: string, data: string): InputFold {
  let submitted = false;
  let answered = false;
  const plain = data.replace(ESCAPES, '');
  for (const ch of plain) {
    if (ch === '\r' || ch === '\n') {
      answered = true;
      if (line.trim()) submitted = true;
      line = '';
    } else if (ch === '\x7f' || ch === '\b') {
      line = line.slice(0, -1);
    } else if (ch === '\x03' || ch === '\x15') {
      line = '';
    } else if (ch >= ' ') {
      answered = true;
      line += ch;
    }
  }
  return { line, submitted, answered };
}
