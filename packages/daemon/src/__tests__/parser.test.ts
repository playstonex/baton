import { describe, it, expect } from 'vitest';
import { ClaudeCodeParser } from '../parser/index.js';

describe('ClaudeCodeParser', () => {
  it('detects thinking state', () => {
    const parser = new ClaudeCodeParser();
    const events = parser.parse('  ● Thinking about the problem...\n');
    expect(events.some((e) => e.type === 'thinking' || e.type === 'status_change')).toBe(true);
  });

  it('detects tool use — Read', () => {
    const parser = new ClaudeCodeParser();
    const events = parser.parse('  ● Read file: src/index.ts\n');
    expect(events.some((e) => e.type === 'tool_use')).toBe(true);
  });

  it('detects tool use — Bash', () => {
    const parser = new ClaudeCodeParser();
    const events = parser.parse('  ● Bash: npm test\n');
    expect(events.some((e) => e.type === 'tool_use')).toBe(true);
  });

  it('detects file change — write', () => {
    const parser = new ClaudeCodeParser();
    const events = parser.parse('  ⏺ Write file: src/utils.ts\n');
    expect(events.some((e) => e.type === 'file_change')).toBe(true);
  });

  it('detects file change — edit', () => {
    const parser = new ClaudeCodeParser();
    const events = parser.parse('  ⏺ Edit file: src/index.ts\n');
    const fc = events.find((e) => e.type === 'file_change');
    expect(fc).toBeDefined();
    if (fc?.type === 'file_change') {
      expect(fc.changeType).toBe('modify');
      expect(fc.path).toContain('src/index.ts');
    }
  });

  it('detects permission request', () => {
    const parser = new ClaudeCodeParser();
    const events = parser.parse('  Allow this action? (y/n)\n');
    expect(events.some((e) => e.type === 'status_change')).toBe(true);
  });

  it('detects error messages', () => {
    const parser = new ClaudeCodeParser();
    const events = parser.parse('Error: something went wrong\n');
    expect(events.some((e) => e.type === 'error')).toBe(true);
  });

  it('returns raw_output for unrecognized output', () => {
    const parser = new ClaudeCodeParser();
    const events = parser.parse('some random output\n');
    expect(events.length).toBeGreaterThan(0);
    expect(events[0].type).toBe('raw_output');
  });

  it('returns empty array for empty/ANSI-only input', () => {
    const parser = new ClaudeCodeParser();
    expect(parser.parse('')).toEqual([]);
  });
});
