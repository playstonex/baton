import type { ParsedEvent } from '@flowwhips/shared';
import { stripAnsi } from './ansi.js';

// Claude Code interactive mode output patterns
const PATTERNS = {
  // "● Thinking..." or "⏺ Thinking..."
  thinking: /[●⏺◉○]\s*(?:Thinking|Analyzing|Processing)/i,

  // Tool use indicators — Claude Code shows these as structured blocks
  // e.g., "⏺ Read file: src/index.ts" or "● Edit src/index.ts"
  toolUse: /(?:⏺|●|▸|→)\s*(Read|Write|Edit|Create|Bash|Glob|Grep|MultiEdit|TodoRead|TodoWrite|WebFetch|Task|LS| NotebookEdit|ServerStatus|Ask|ToolUse)\b/i,

  // File path in tool use
  filePath: /(?:Read|Write|Edit|Create|MultiEdit)\s+(?:file:\s*)?(`[^`]+`|["'[\s]([^\s"'`]+\.\w+))/i,

  // Command execution in Bash
  bashCommand: /(?:Bash|Command)\s*\n?\s*(?:`([^`]+)`|$ (.+)$)/m,

  // Permission request — "Allow this action?"
  permissionRequest: /(?:Allow|Deny|approve|reject)\s+(?:this\s+)?action/i,

  // Waiting for input — ">" prompt
  waitingInput: /(?:^|>)\s*$/m,

  // Error messages
  error: /(?:Error|error|ERROR)[:\s]/,

  // Completion — "Claude Code finished" or response text after tool use
  completion: /(?:completed|finished|done)/i,

  // Diff markers
  diffStart: /^[-+@]{1,3}\s/m,

  // File changes in tool output
  fileChange: /(?:Updating|Creating|Deleting|Modified)\s+([^\s]+)/i,
} as const;

export interface ParserState {
  inToolUse: boolean;
  currentTool: string | null;
  buffer: string;
  lastStatus: string;
}

export class ClaudeCodeParser {
  private state: ParserState = {
    inToolUse: false,
    currentTool: null,
    buffer: '',
    lastStatus: 'raw_output',
  };

  parse(rawChunk: string): ParsedEvent[] {
    const events: ParsedEvent[] = [];
    const now = Date.now();

    // Keep raw for terminal display, parse cleaned text
    const clean = stripAnsi(rawChunk);
    if (!clean) return events;

    // Buffer for multi-line pattern matching
    this.state.buffer += clean;
    if (this.state.buffer.length > 50000) {
      this.state.buffer = this.state.buffer.slice(-25000);
    }

    // 1. Thinking/Processing status
    if (PATTERNS.thinking.test(clean)) {
      this.state.inToolUse = false;
      events.push({ type: 'thinking', content: clean, timestamp: now });
      events.push({ type: 'status_change', status: 'thinking', timestamp: now });
      this.state.lastStatus = 'thinking';
      return events;
    }

    // 2. Tool use detection
    const toolMatch = clean.match(PATTERNS.toolUse);
    if (toolMatch) {
      const toolName = toolMatch[1];
      this.state.inToolUse = true;
      this.state.currentTool = toolName;
      events.push({
        type: 'tool_use',
        tool: toolName,
        args: this.extractToolArgs(clean, toolName),
        timestamp: now,
      });
      events.push({ type: 'status_change', status: 'executing', timestamp: now });
      this.state.lastStatus = 'executing';

      // Try to extract file path from tool use
      const fileMatch = clean.match(PATTERNS.filePath);
      if (fileMatch) {
        const filePath = fileMatch[1] || fileMatch[2];
        if (filePath) {
          const changeType =
            toolName === 'Create' ? 'create' : toolName === 'Write' ? 'modify' : 'modify';
          events.push({
            type: 'file_change',
            path: filePath.replace(/^`|`$/g, '').trim(),
            changeType,
            timestamp: now,
          });
        }
      }

      return events;
    }

    // 3. Bash command execution
    const bashMatch = clean.match(PATTERNS.bashCommand);
    if (bashMatch) {
      const command = bashMatch[1] || bashMatch[2];
      if (command) {
        events.push({
          type: 'command_exec',
          command: command.trim(),
          timestamp: now,
        });
      }
    }

    // 4. Permission request — waiting for user input
    if (PATTERNS.permissionRequest.test(clean)) {
      events.push({ type: 'status_change', status: 'waiting_input', timestamp: now });
      this.state.lastStatus = 'waiting_input';
      return events;
    }

    // 5. Error detection
    if (PATTERNS.error.test(clean)) {
      events.push({ type: 'error', message: clean, timestamp: now });
      return events;
    }

    // 6. Diff content
    if (PATTERNS.diffStart.test(clean)) {
      events.push({
        type: 'tool_use',
        tool: 'diff',
        args: { content: clean },
        timestamp: now,
      });
      return events;
    }

    // 7. Idle — response text (not tool use, not thinking)
    if (this.state.inToolUse && clean.length > 0 && !PATTERNS.toolUse.test(clean)) {
      // After tool use, if we see normal text, agent is in response/idle mode
      this.state.inToolUse = false;
      events.push({ type: 'status_change', status: 'idle', timestamp: now });
      this.state.lastStatus = 'raw_output';
    }

    // 8. Default: raw output
    if (events.length === 0) {
      events.push({ type: 'raw_output', content: rawChunk, timestamp: now });
    }

    return events;
  }

  private extractToolArgs(text: string, tool: string): Record<string, unknown> {
    const args: Record<string, unknown> = {};

    const fileMatch = text.match(PATTERNS.filePath);
    if (fileMatch) {
      args.filePath = (fileMatch[1] || fileMatch[2] || '').replace(/^`|`$/g, '').trim();
    }

    const bashMatch = text.match(PATTERNS.bashCommand);
    if (bashMatch) {
      args.command = (bashMatch[1] || bashMatch[2] || '').trim();
    }

    if (tool === 'Read') args.action = 'read';
    if (tool === 'Write' || tool === 'Edit' || tool === 'MultiEdit') args.action = 'write';
    if (tool === 'Create') args.action = 'create';
    if (tool === 'Bash') args.action = 'execute';

    return args;
  }

  reset(): void {
    this.state = {
      inToolUse: false,
      currentTool: null,
      buffer: '',
      lastStatus: 'raw_output',
    };
  }
}
