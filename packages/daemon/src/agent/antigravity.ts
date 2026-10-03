import { execSync } from 'node:child_process';
import type { AgentConfig, ParsedEvent, SpawnConfig } from '@baton/shared';
import { BaseAgentAdapter } from './adapter.js';
import { stripAnsi } from '../parser/ansi.js';

/**
 * Google Antigravity terminal agent (`agy`, Go binary shipped with the
 * Antigravity IDE). Interactive REPL by default — extra flags flow through
 * config.args (e.g. `--model`, `--effort`, `--mode plan`).
 */
export class AntigravityAdapter extends BaseAgentAdapter {
  readonly name = 'Antigravity';
  readonly agentType = 'antigravity' as const;

  detect(_projectPath: string): boolean {
    try {
      execSync('which agy', { stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }

  buildSpawnConfig(config: AgentConfig): SpawnConfig {
    return {
      command: 'agy',
      args: [...(config.args ?? [])],
      env: { ...(process.env as Record<string, string>), ...(config.env ?? {}) },
      cwd: config.projectPath,
    };
  }

  parseOutput(raw: string): ParsedEvent[] {
    const events: ParsedEvent[] = [];
    const now = Date.now();
    const clean = stripAnsi(raw);
    if (!clean) return events;

    if (/thinking|reasoning|analyzing/i.test(clean)) {
      events.push({ type: 'thinking', content: clean, timestamp: now });
      return events;
    }

    // Permission prompts must not deadlock a remote session — surface them
    // as waiting_input so the client shows the approve bar.
    if (/allow|approve|permission\??$/i.test(clean.trim())) {
      events.push({ type: 'status_change', status: 'waiting_input', timestamp: now });
      return events;
    }

    const cmdMatch = clean.match(/(?:Running|Executing)\s+(?:command|shell):\s*(.+)/i);
    if (cmdMatch) {
      events.push({ type: 'command_exec', command: cmdMatch[1].trim(), timestamp: now });
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
      return events;
    }

    events.push({ type: 'raw_output', content: raw, timestamp: now });
    return events;
  }
}
