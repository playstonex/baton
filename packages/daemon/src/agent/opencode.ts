import type { AgentConfig, ParsedEvent, SpawnConfig } from '@baton/shared';
import { BaseAgentAdapter } from './adapter.js';
import { stripAnsi } from '../parser/ansi.js';
import { execSync } from 'node:child_process';

export class OpenCodeAdapter extends BaseAgentAdapter {
  readonly name = 'OpenCode';
  readonly agentType = 'opencode' as const;

  detect(): boolean {
    try {
      execSync('which opencode', { stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }

  buildSpawnConfig(config: AgentConfig): SpawnConfig {
    return {
      command: 'opencode',
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

    if (/thinking|processing/i.test(clean)) {
      events.push({ type: 'thinking', content: clean, timestamp: now });
      return events;
    }

    const fileMatch = clean.match(/(?:read|write|edit|create|delete|update)\s+[\s`"]*([^\s`"']+\.\w+)/i);
    if (fileMatch) {
      events.push({
        type: 'file_change',
        path: fileMatch[1],
        changeType: /create/i.test(clean) ? 'create' : /delete/i.test(clean) ? 'delete' : 'modify',
        timestamp: now,
      });
    }

    events.push({ type: 'raw_output', content: raw, timestamp: now });

    return events;
  }
}
