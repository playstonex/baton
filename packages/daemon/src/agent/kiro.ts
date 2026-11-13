import { execSync } from 'node:child_process';
import type { AgentConfig, ModelInfo, ParsedEvent, SpawnConfig } from '@baton/shared';
import { formatModelName } from '@baton/shared/utils';
import { BaseAgentAdapter, resumeArgs } from './adapter.js';
import { stripAnsi } from '../parser/ansi.js';

export const DEFAULT_KIRO_MODELS: ModelInfo[] = [
  {
    id: 'auto',
    name: 'Auto (Task Optimized)',
    description: 'Models chosen by task for optimal usage',
  },
  {
    id: 'claude-opus-5.5',
    name: 'Claude Opus 5.5',
    description: 'Claude Opus 5.5 model with 1M context',
  },
  {
    id: 'claude-sonnet-5.5',
    name: 'Claude Sonnet 5.5',
    description: 'Claude Sonnet 5.5 model with 1M context',
  },
  {
    id: 'claude-haiku-5.5',
    name: 'Claude Haiku 5.5',
    description: 'Claude Haiku 5.5 model with 1M context',
  },
  { id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol', description: 'OpenAI GPT 5.6 Sol with 1M context' },
  {
    id: 'gpt-5.6-terra',
    name: 'GPT-5.6 Terra',
    description: 'OpenAI GPT 5.6 Terra with 1M context',
  },
  { id: 'gpt-5.6-luna', name: 'GPT-5.6 Luna', description: 'OpenAI GPT 5.6 Luna with 1M context' },
  { id: 'grok-4.7', name: 'Grok 4.7', description: 'xAI Grok 4.7' },
  { id: 'deepseek-3.2', name: 'DeepSeek V3.2', description: 'DeepSeek V3.2 preview' },
  { id: 'minimax-m2.5', name: 'MiniMax M2.5', description: 'MiniMax M2.5 model' },
  { id: 'glm-5', name: 'GLM-5', description: 'GLM-5 model' },
  { id: 'qwen3-coder-next', name: 'Qwen3 Coder Next', description: 'Qwen3 Coder Next preview' },
];

/**
 * Unified Kiro adapter. There used to be two entries — "Kiro CLI" (PTY
 * `kiro-cli chat`) and "Kiro ACP" (`kiro-cli acp`) — and both were broken:
 * the current kiro-cli (2.x) no longer has an `acp` subcommand, so the ACP
 * variants died instantly, and neither entry matched what users wanted to
 * pick. One "Kiro" entry now spawns the only supported interactive surface:
 * `kiro-cli chat`.
 *
 * `--trust-all-tools` mirrors the old ACP intent: Baton drives Kiro remotely
 * (web/mobile/CLI), where an interactive y/n permission prompt can't be
 * answered reliably, so tools must not block. Pass config.args to override.
 */
export class KiroAdapter extends BaseAgentAdapter {
  readonly name = 'Kiro';
  readonly agentType = 'kiro' as const;
  selectedModel: string | null = null;

  detect(_projectPath: string): boolean {
    try {
      execSync('which kiro-cli', { stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }

  listModels(): string[] {
    try {
      const raw = execSync('kiro-cli chat --list-models --format json 2>/dev/null', {
        encoding: 'utf-8',
        timeout: 5000,
      });
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed?.models)) {
        return (parsed.models as Array<{ model_id?: string; model_name?: string }>)
          .map((m) => m.model_id || m.model_name)
          .filter((id): id is string => Boolean(id));
      }
    } catch {
      // fallback
    }
    return DEFAULT_KIRO_MODELS.map((m) => m.id);
  }

  listModelDetails(): ModelInfo[] {
    try {
      const raw = execSync('kiro-cli chat --list-models --format json 2>/dev/null', {
        encoding: 'utf-8',
        timeout: 5000,
      });
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed?.models)) {
        return (
          parsed.models as Array<{ model_id?: string; model_name?: string; description?: string }>
        )
          .map((m) => ({
            id: m.model_id || m.model_name || '',
            name: formatModelName(m.model_id || m.model_name),
            description: m.description,
          }))
          .filter((m) => Boolean(m.id));
      }
    } catch {
      // fallback
    }
    return DEFAULT_KIRO_MODELS;
  }

  buildSpawnConfig(config: AgentConfig): SpawnConfig {
    return {
      command: 'kiro-cli',
      args: [
        'chat',
        // kiro-cli chat: `--resume-id <id>` continues an exact conversation,
        // `-r` the most recent one in this directory.
        ...resumeArgs({ idFlag: '--resume-id', latest: ['-r'] }, config.resume),
        '--trust-all-tools',
        ...(config.args ?? []),
      ],
      env: { ...(process.env as Record<string, string>), ...(config.env ?? {}) },
      cwd: config.projectPath,
    };
  }

  override extractSessionId(clean: string): string | null {
    return clean.match(/session[ _-]?id[^0-9a-f]{0,8}([0-9a-zA-Z-]{12,})/i)?.[1] ?? null;
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
