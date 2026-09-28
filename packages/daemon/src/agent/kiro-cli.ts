import { execSync } from 'node:child_process';
import type { AgentConfig, ParsedEvent, SpawnConfig } from '@baton/shared';
import { BaseAgentAdapter } from './adapter.js';
import { stripAnsi } from '../parser/ansi.js';

export class KiroCliAdapter extends BaseAgentAdapter {
  readonly name = 'Kiro CLI';
  readonly agentType = 'kiro-cli' as const;

  detect(_projectPath: string): boolean {
    try {
      execSync('which kiro-cli', { stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }

  buildSpawnConfig(config: AgentConfig): SpawnConfig {
    return {
      command: 'kiro-cli',
      args: ['chat', ...(config.args ?? [])],
      env: { ...(process.env as Record<string, string>), ...(config.env ?? {}) },
      cwd: config.projectPath,
    };
  }

  parseOutput(raw: string): ParsedEvent[] {
    const events: ParsedEvent[] = [];
    const now = Date.now();
    const clean = stripAnsi(raw);
    if (!clean) return events;

    if (/Allow this action\?\s*\[y\/n\/t\]/i.test(clean)) {
      events.push({ type: 'status_change', status: 'waiting_input', timestamp: now });
      return events;
    }

    if (/thinking|processing|analyzing/i.test(clean)) {
      events.push({ type: 'thinking', content: clean, timestamp: now });
      events.push({ type: 'status_change', status: 'thinking', timestamp: now });
      return events;
    }

    // TUI response complete marker (▸ Credits: 0.24 • Time: 3s)
    if (/▸\s*Credits:/i.test(clean)) {
      events.push({ type: 'status_change', status: 'idle', timestamp: now });
      return events;
    }

    if (/ask a question, or describe a task/i.test(clean)) {
      events.push({ type: 'status_change', status: 'idle', timestamp: now });
      return events;
    }

    const fileMatch = clean.match(
      /(?:read|writ|edit|creat|delet|updat)\w*\s+[\s`"']*([^\s`"']+\.\w+)/i,
    );
    if (fileMatch) {
      events.push({
        type: 'file_change',
        path: fileMatch[1],
        changeType: /creat/i.test(clean) ? 'create' : /delet/i.test(clean) ? 'delete' : 'modify',
        timestamp: now,
      });
      events.push({
        type: 'tool_use',
        tool: 'file_operation',
        args: { path: fileMatch[1] },
        timestamp: now,
      });
      return events;
    }

    const cmdMatch = clean.match(/(?:Running|Executing|running):\s*(.+)/i);
    if (cmdMatch) {
      events.push({
        type: 'command_exec',
        command: cmdMatch[1].trim(),
        timestamp: now,
      });
      return events;
    }

    if (/Kiro is having trouble responding|error:/i.test(clean)) {
      events.push({ type: 'error', message: clean, timestamp: now });
      return events;
    }

    events.push({ type: 'raw_output', content: raw, timestamp: now });
    return events;
  }
}
