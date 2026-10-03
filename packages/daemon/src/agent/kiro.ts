import { execSync } from 'node:child_process';
import type { AgentConfig, ParsedEvent, SpawnConfig } from '@baton/shared';
import { BaseAgentAdapter, resumeArgs } from './adapter.js';
import { stripAnsi } from '../parser/ansi.js';

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
