import type { AgentConfig, ParsedEvent, SpawnConfig } from '@flowwhips/shared';
import { BaseAgentAdapter } from './adapter.js';
import { stripAnsi } from '../parser/ansi.js';

export class CodexAdapter extends BaseAgentAdapter {
  readonly name = 'Codex';
  readonly agentType = 'codex' as const;

  detect(_projectPath: string): boolean {
    return true;
  }

  buildSpawnConfig(config: AgentConfig): SpawnConfig {
    return {
      command: 'codex',
      args: config.args ?? [],
      env: { ...(process.env as Record<string, string>), ...(config.env ?? {}) },
      cwd: config.projectPath,
    };
  }

  parseOutput(raw: string): ParsedEvent[] {
    const events: ParsedEvent[] = [];
    const now = Date.now();
    const clean = stripAnsi(raw);
    if (!clean) return events;

    // Codex (Rust TUI) output patterns:
    // - "Creating" / "Editing" / "Reading" for file operations
    // - "Running" for command execution
    // - "Thinking" / "Reasoning" for processing
    // - Permission prompts: "Allow" / "Approve"

    if (/thinking|reasoning|analyzing/i.test(clean)) {
      events.push({ type: 'thinking', content: clean, timestamp: now });
      events.push({ type: 'status_change', status: 'thinking', timestamp: now });
      return events;
    }

    // File operations
    const fileMatch = clean.match(/(?:Creating|Editing|Reading|Writing|Deleting)\s+([^\s]+)/i);
    if (fileMatch) {
      const action = clean.match(/(Creating|Editing|Reading|Writing|Deleting)/i)?.[1] ?? '';
      events.push({
        type: 'file_change',
        path: fileMatch[1],
        changeType: action === 'Creating' ? 'create' : action === 'Deleting' ? 'delete' : 'modify',
        timestamp: now,
      });
      events.push({
        type: 'tool_use',
        tool: action,
        args: { filePath: fileMatch[1] },
        timestamp: now,
      });
      return events;
    }

    // Command execution
    const cmdMatch = clean.match(/(?:Running|Executing):\s*(.+)/i);
    if (cmdMatch) {
      events.push({
        type: 'command_exec',
        command: cmdMatch[1].trim(),
        timestamp: now,
      });
      return events;
    }

    // Permission prompt
    if (/allow|approve|permit/i.test(clean) && /\?/.test(clean)) {
      events.push({ type: 'status_change', status: 'waiting_input', timestamp: now });
      return events;
    }

    // Error
    if (/\berror\b/i.test(clean)) {
      events.push({ type: 'error', message: clean, timestamp: now });
      return events;
    }

    // Default: raw output
    if (events.length === 0) {
      events.push({ type: 'raw_output', content: raw, timestamp: now });
    }

    return events;
  }
}
