import type { ParsedEvent } from '@baton/shared';
import { stripAnsi } from './ansi.js';

let _callIdCounter = 0;
function nextCallId(): string {
  return `call_${++_callIdCounter}_${Date.now().toString(36)}`;
}

let _turnIdCounter = 0;
function nextTurnId(): string {
  return `turn_${++_turnIdCounter}_${Date.now().toString(36)}`;
}

let _requestCounter = 0;
function nextRequestId(): string {
  return `perm_${++_requestCounter}_${Date.now().toString(36)}`;
}

// Claude Code interactive mode output patterns
const PATTERNS = {
  thinking: /[●⏺◉○]\s*(?:Thinking|Analyzing|Processing)/i,

  toolUse: /(?:⏺|●|▸|→)\s*(Read|Write|Edit|Create|Bash|Glob|Grep|MultiEdit|TodoRead|TodoWrite|WebFetch|Task|LS|NotebookEdit|ServerStatus|Ask|ToolUse)\b/i,

  filePath: /(?:Read|Write|Edit|Create|MultiEdit)\s+(?:file:\s*)?(`[^`]+`|["'[\s]([^\s"'`]+\.\w+))/i,

  bashCommand: /(?:Bash|Command)\s*\n?\s*(?:`([^`]+)`|$ (.+)$)/m,

  permissionRequest: /(?:Allow|approve)\s+(?:this\s+)?(?:action|tool use|command)\??/i,

  permissionPromptLine: /(?:\[[YyNn]\]|\(y\/n\)|→\s*(?:Yes|No|Allow|Deny)|Always allow|Allow (?:once|always)|Don't ask again)/i,

  waitingInput: /(?:^|>)\s*$/m,

  error: /(?:Error|error|ERROR)[:\s]/,

  completion: /(?:completed|finished|done)/i,

  diffStart: /^[-+@]{1,3}\s/m,

  fileChange: /(?:Updating|Creating|Deleting|Modified)\s+([^\s]+)/i,
} as const;

export interface ParserState {
  inToolUse: boolean;
  currentTool: string | null;
  currentCallId: string | null;
  toolStartTime: number | null;
  buffer: string;
  lastStatus: string;
  inTurn: boolean;
  currentTurnId: string | null;
}

export class ClaudeCodeParser {
  private state: ParserState = {
    inToolUse: false,
    currentTool: null,
    currentCallId: null,
    toolStartTime: null,
    buffer: '',
    lastStatus: 'raw_output',
    inTurn: false,
    currentTurnId: null,
  };

  parse(rawChunk: string): ParsedEvent[] {
    const events: ParsedEvent[] = [];
    const now = Date.now();

    const clean = stripAnsi(rawChunk);
    if (!clean) return events;

    this.state.buffer += clean;
    if (this.state.buffer.length > 50000) {
      this.state.buffer = this.state.buffer.slice(-25000);
    }

    // 1. Thinking/Processing — marks turn start
    if (PATTERNS.thinking.test(clean)) {
      this.closeToolUse(events, now);
      this.startTurn(events, now);
      this.state.inToolUse = false;
      events.push({ type: 'thinking', content: clean, timestamp: now });
      events.push({ type: 'status_change', status: 'thinking', timestamp: now });
      this.state.lastStatus = 'thinking';
      return events;
    }

    // 2. Tool use detection — emit tool_call_start alongside existing tool_use
    const toolMatch = clean.match(PATTERNS.toolUse);
    if (toolMatch) {
      this.closeToolUse(events, now);
      this.startTurn(events, now);

      const toolName = toolMatch[1];
      const callId = nextCallId();
      this.state.inToolUse = true;
      this.state.currentTool = toolName;
      this.state.currentCallId = callId;
      this.state.toolStartTime = now;

      const args = this.extractToolArgs(clean, toolName);

      events.push({
        type: 'tool_use',
        tool: toolName,
        args,
        timestamp: now,
      });

      events.push({
        type: 'tool_call_start',
        callId,
        tool: toolName,
        title: `${toolName} ${args.filePath ?? args.command ?? ''}`.trim(),
        args,
        timestamp: now,
      });

      events.push({ type: 'status_change', status: 'executing', timestamp: now });
      this.state.lastStatus = 'executing';

      const fileMatch = clean.match(PATTERNS.filePath);
      if (fileMatch) {
        const filePath = fileMatch[1] || fileMatch[2];
        if (filePath) {
          const changeType = toolName === 'Create' ? 'create' : 'modify';
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

    // 4. Permission request — emit permission_request event
    if (PATTERNS.permissionRequest.test(clean) || PATTERNS.permissionPromptLine.test(clean)) {
      this.closeToolUse(events, now);

      const toolName = this.state.currentTool ?? 'unknown';
      const requestId = nextRequestId();
      const promptText = clean.trim().split('\n')[0] ?? '';

      events.push({
        type: 'permission_request',
        requestId,
        tool: toolName,
        action: toolName,
        description: promptText,
        timestamp: now,
      });

      events.push({ type: 'status_change', status: 'waiting_input', timestamp: now });
      this.state.lastStatus = 'waiting_input';
      return events;
    }

    // 5. Error detection
    if (PATTERNS.error.test(clean)) {
      this.closeToolUse(events, now);
      this.endTurn(events, now, 'failed');
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

    // 7. Idle — response text (end of tool use and turn)
    if (this.state.inToolUse && clean.length > 0 && !PATTERNS.toolUse.test(clean)) {
      this.closeToolUse(events, now);
      this.endTurn(events, now, 'completed');
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

  private closeToolUse(events: ParsedEvent[], now: number): void {
    if (this.state.currentCallId && this.state.toolStartTime) {
      events.push({
        type: 'tool_call_end',
        callId: this.state.currentCallId,
        success: true,
        durationMs: now - this.state.toolStartTime,
        timestamp: now,
      });
    }
    this.state.currentCallId = null;
    this.state.toolStartTime = null;
  }

  private startTurn(events: ParsedEvent[], now: number): void {
    if (!this.state.inTurn) {
      this.state.inTurn = true;
      this.state.currentTurnId = nextTurnId();
      events.push({
        type: 'turn_boundary',
        turnId: this.state.currentTurnId,
        direction: 'start',
        timestamp: now,
      });
    }
  }

  private endTurn(events: ParsedEvent[], now: number, status: 'completed' | 'failed' | 'cancelled'): void {
    if (this.state.inTurn) {
      events.push({
        type: 'turn_boundary',
        turnId: this.state.currentTurnId!,
        direction: 'end',
        status,
        timestamp: now,
      });
      this.state.inTurn = false;
      this.state.currentTurnId = null;
    }
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
      currentCallId: null,
      toolStartTime: null,
      buffer: '',
      lastStatus: 'raw_output',
      inTurn: false,
      currentTurnId: null,
    };
  }
}
