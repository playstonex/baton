// Strip ANSI escape codes for parsing
// OSC title sequences
const OSC_REGEX = /\x1b\]0;.*?\x07/g;
// CSI sequences (cursor movement, colors, etc.)
const CSI_REGEX = /\x1b\[[\d;]*[A-Za-z]/g;
// SGR sequences (text formatting)
const SGR_REGEX = /\x1b\[\d*m/g;

export function stripAnsi(text: string): string {
  return text
    .replace(OSC_REGEX, '')
    .replace(CSI_REGEX, '')
    .replace(SGR_REGEX, '')
    .replace(/\x1b\[[^a-zA-Z]*[a-zA-Z]/g, '')
    .replace(/\x1b[^[\]].*?(?:\x1b\\|\x07)/g, '')
    .trim();
}

// Check if text contains any ANSI codes
export function hasAnsi(text: string): boolean {
  return /\x1b\[/.test(text);
}
