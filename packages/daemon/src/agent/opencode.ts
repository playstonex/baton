import type { AgentConfig, ModelInfo, ParsedEvent, SpawnConfig } from '@baton/shared';
import { formatModelName } from '@baton/shared/utils';
import { BaseAgentAdapter } from './adapter.js';
import { DEFAULT_OPENCODE_MODELS } from './opencode-sdk.js';
import { stripAnsi } from '../parser/ansi.js';
import { execSync } from 'node:child_process';

export class OpenCodeAdapter extends BaseAgentAdapter {
  readonly name = 'OpenCode';
  readonly agentType = 'opencode' as const;
  selectedModel: string | null = null;

  detect(): boolean {
    try {
      execSync('which opencode', { stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }

  listModels(): string[] {
    try {
      const raw = execSync('opencode models 2>/dev/null', {
        encoding: 'utf-8',
        timeout: 5000,
      });
      const list = raw.split('\n').map((l) => l.trim()).filter(Boolean);
      return list.length > 0 ? list : DEFAULT_OPENCODE_MODELS.map((m) => m.id);
    } catch {
      return DEFAULT_OPENCODE_MODELS.map((m) => m.id);
    }
  }

  listModelDetails(): ModelInfo[] {
    const models = this.listModels();
    return models.map((m) => {
      const defaultMatch = DEFAULT_OPENCODE_MODELS.find((d) => d.id === m);
      return {
        id: m,
        name: defaultMatch?.name ?? formatModelName(m),
        description: defaultMatch?.description,
      };
    });
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

    // OpenCode uses similar patterns to Claude Code
    if (/thinking|processing/i.test(clean)) {
      events.push({ type: 'thinking', content: clean, timestamp: now });
      return events;
    }

    const fileMatch = clean.match(
      /(?:read|write|edit|create|delete|update)\s+[\s`"]*([^\s`"']+\.\w+)/i,
    );
    if (fileMatch) {
      events.push({
        type: 'file_change',
        path: fileMatch[1],
        changeType: /create/i.test(clean) ? 'create' : /delete/i.test(clean) ? 'delete' : 'modify',
        timestamp: now,
      });
      return events;
    }

    if (events.length === 0) {
      events.push({ type: 'raw_output', content: raw, timestamp: now });
    }

    return events;
  }
}
